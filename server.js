const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
const https = require('https');
const { Pool } = require('pg');
const PgSession = require('connect-pg-simple')(session);

const app = express();
const PORT = process.env.PORT || 8080;

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client:', err);
  // Don't exit process immediately - let the server try to recover
});

// Test database connectivity
async function testDatabaseConnection() {
  try {
    const client = await pool.connect();
    console.log('✅ Database connection test successful');
    client.release();
    return true;
  } catch (error) {
    console.error('❌ Database connection test failed:', error);
    return false;
  }
}

// Initialize database tables
async function initializeDatabase() {
  try {
    console.log('Starting database initialization...');

    // Create users table
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          username VARCHAR(50) PRIMARY KEY,
          password VARCHAR(255) NOT NULL,
          role VARCHAR(20) NOT NULL DEFAULT 'customer',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('Users table ready');
    } catch (error) {
      console.error('Error creating users table:', error);
      throw error;
    }

    // Create batches table
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS batches (
          id SERIAL PRIMARY KEY,
          plant_date DATE NOT NULL,
          quantity INTEGER NOT NULL,
          stock INTEGER NOT NULL,
          ready_for_sale BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('Batches table ready');
    } catch (error) {
      console.error('Error creating batches table:', error);
      throw error;
    }

    // Create orders table
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS orders (
          id VARCHAR(50) PRIMARY KEY,
          user_id VARCHAR(50) NOT NULL,
          batch_id INTEGER NOT NULL,
          quantity INTEGER NOT NULL,
          phone VARCHAR(20),
          address TEXT,
          delivery VARCHAR(20),
          payment VARCHAR(50),
          status VARCHAR(20) DEFAULT 'pending',
          order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          total_price INTEGER NOT NULL,
          last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('Orders table ready');
    } catch (error) {
      console.error('Error creating orders table:', error);
      throw error;
    }

    // Create session table for connect-pg-simple
    try {
      // First, create the table if it doesn't exist
      await pool.query(`
        CREATE TABLE IF NOT EXISTS session (
          sid VARCHAR NOT NULL COLLATE "default",
          sess JSON NOT NULL,
          expire TIMESTAMP(6) NOT NULL
        ) WITH (OIDS=FALSE);
      `);
      console.log('Session table created');

      // Create index if it doesn't exist
      await pool.query(`
        CREATE INDEX IF NOT EXISTS IDX_session_expire ON session(expire);
      `);
      console.log('Session index created');

      // Add primary key constraint only if it doesn't exist
      const constraintExists = await pool.query(`
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'session_pkey' AND table_name = 'session';
      `);

      if (constraintExists.rows.length === 0) {
        await pool.query(`
          ALTER TABLE session ADD CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE;
        `);
        console.log('Session primary key constraint added');
      } else {
        console.log('Session primary key constraint already exists');
      }

    } catch (error) {
      console.error('Error creating session table:', error);
      // Don't throw error for session table - continue with server startup
      console.log('Continuing without session table - using memory store');
    }

    // Insert default users
    try {
      // Insert default admin user if not exists
      await pool.query(`
        INSERT INTO users (username, password, role)
        VALUES ('sulvianti', 'wongirengjembuten69', 'admin')
        ON CONFLICT (username) DO NOTHING
      `);

      // Insert default customer user if not exists
      await pool.query(`
        INSERT INTO users (username, password, role)
        VALUES ('customer', 'customer123', 'customer')
        ON CONFLICT (username) DO NOTHING
      `);

      console.log('Default users created');
    } catch (error) {
      console.error('Error creating default users:', error);
      throw error;
    }

    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Critical error initializing database:', error);
    // Don't exit the process - let the server start with limited functionality
    console.log('⚠️ Server will start with limited database functionality');
  }
}

// For backward compatibility, keep file paths (but won't be used)
const DATA_FILE = path.join(__dirname, 'batches.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const ORDERS_FILE = path.join(__dirname, 'orders.json');

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests from localhost and common development ports
        const allowedOrigins = [
            'http://localhost:3000',
            'http://localhost:5500',
            'http://127.0.0.1:3000',
            'http://127.0.0.1:5500',
            'http://localhost:8080',
            'http://127.0.0.1:8080',
            // Add production domains
            'https://planteraweb.vercel.app',
            'https://plantera-web.vercel.app',
            'https://plantera-gamma.vercel.app'
        ];

        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(null, true); // Allow all for development
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Pragma']
}));
app.use(express.json());
app.use(express.static(__dirname));

// PostgreSQL session store with error handling
let sessionStore;
try {
    sessionStore = new PgSession({
        pool: pool,
        tableName: 'session',
        createTableIfMissing: false // We create it manually above
    });
    console.log('PostgreSQL session store initialized');
} catch (error) {
    console.error('Failed to initialize PostgreSQL session store:', error);
    console.log('Falling back to memory session store');
    sessionStore = null; // Will use default memory store
}

// Enhanced session configuration with fallback
app.use(session({
    store: sessionStore || undefined, // Use PostgreSQL store if available, otherwise memory store
    secret: process.env.SESSION_SECRET || 'plantera-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to false for Railway (internal communication)
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax' // Changed to lax for Railway
    },
    name: 'plantera.sid'
}));

// Ensure files exist
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([]));
}
if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([
        { username: 'sulvianti', password: 'wongirengjembuten69', role: 'admin' },
        { username: 'customer', password: 'customer123', role: 'customer' }
    ]));
}
if (!fs.existsSync(ORDERS_FILE)) {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify([]));
}

// Login
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    console.log('Login attempt:', username);
    console.log('Session ID:', req.sessionID);

    try {
        const result = await pool.query(
            'SELECT username, password, role FROM users WHERE username = $1 AND password = $2',
            [username, password]
        );

        if (result.rows.length > 0) {
            const user = result.rows[0];
            req.session.user = {
                username: user.username,
                role: user.role
            };
            console.log('Login successful for:', user.username, 'role:', user.role);
            console.log('Session user set:', req.session.user);
            res.json({ success: true, role: user.role });
        } else {
            console.log('Login failed: Invalid credentials');
            res.json({ success: false });
        }
    } catch (error) {
        console.error('Database error during login:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// Logout
app.post('/logout', (req, res) => {
    req.session.destroy();
    res.send('Logged out');
});

// Register new user
app.post('/register', async (req, res) => {
    const { username, password, role = 'customer' } = req.body;

    if (!username || !password) {
        return res.json({ success: false, message: 'Username dan password diperlukan' });
    }

    try {
        // Check if user already exists
        const existingUser = await pool.query(
            'SELECT username FROM users WHERE username = $1',
            [username]
        );

        if (existingUser.rows.length > 0) {
            return res.json({ success: false, message: 'Username sudah digunakan' });
        }

        // Insert new user
        await pool.query(
            'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
            [username, password, role]
        );

        // Auto login after registration
        req.session.user = { username, role };
        res.json({
            success: true,
            message: 'Registrasi berhasil',
            user: { username, role }
        });
    } catch (error) {
        console.error('Database error during registration:', error);
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

// Get user
app.get('/user', (req, res) => {
    console.log('User check - Session ID:', req.sessionID);
    console.log('User check - Session user:', req.session ? req.session.user : 'No session');
    res.json(req.session.user || null);
});

// Test session endpoint
app.get('/test-session', (req, res) => {
    res.json({
        sessionID: req.sessionID,
        hasSession: !!req.session,
        user: req.session.user || null,
        isAuthenticated: !!(req.session && req.session.user)
    });
});

// Get user orders
app.get('/orders', async (req, res) => {
    // Add cache control headers
    res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });

    console.log('Orders request - Session ID:', req.sessionID);
    console.log('Orders request - Session exists:', !!req.session);
    console.log('Orders request - Session user:', req.session ? req.session.user : 'No session');

    if (!req.session || !req.session.user) {
        console.log('Orders request: No authenticated user');
        return res.status(401).json({ error: 'Not authenticated' });
    }

    console.log('Orders request for user:', req.session.user.username, 'role:', req.session.user.role);

    try {
        let result;
        if (req.session.user.role === 'admin') {
            result = await pool.query(
                'SELECT * FROM orders ORDER BY order_date DESC'
            );
            console.log('Admin requesting all orders:', result.rows.length);
        } else {
            result = await pool.query(
                'SELECT * FROM orders WHERE user_id = $1 ORDER BY order_date DESC',
                [req.session.user.username]
            );
            console.log('Orders for user', req.session.user.username + ':', result.rows.length);
        }

        res.json(result.rows);
    } catch (error) {
        console.error('Database error fetching orders:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Update order status (admin only)
app.put('/orders/:orderId', requireAdmin, async (req, res) => {
    const { orderId } = req.params;
    const { status } = req.body;

    console.log('Updating order', orderId, 'to status:', status);

    try {
        const result = await pool.query(
            'UPDATE orders SET status = $1, last_updated = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
            [status, orderId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        console.log('Order', orderId, 'updated successfully to', status);
        res.json({ success: true, order: result.rows[0] });
    } catch (error) {
        console.error('Database error updating order:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Middleware to check admin role
function requireAdmin(req, res, next) {
    console.log('Admin check - Session ID:', req.sessionID);
    console.log('Admin check - Session user:', req.session.user);

    if (!req.session || !req.session.user) {
        console.log('Admin access denied: No session or user');
        return res.status(401).json({ error: 'Authentication required.' });
    }

    if (req.session.user.role !== 'admin') {
        console.log('Admin access denied: User role is', req.session.user.role);
        return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }

    console.log('Admin access granted for user:', req.session.user.username);
    next();
}

// Get batches (public)
app.get('/batches', async (req, res) => {
    // Add cache control headers to prevent browser caching
    res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });

    try {
        const result = await pool.query(
            'SELECT id, plant_date, quantity, stock, ready_for_sale FROM batches ORDER BY id'
        );

        console.log('Serving batches to client:', result.rows.length, 'batches');
        res.json(result.rows);
    } catch (error) {
        console.error('Database error fetching batches:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Save batches (admin only)
app.post('/batches', requireAdmin, async (req, res) => {
    const batches = req.body;
    console.log('Saving batches:', batches.length, 'batches');

    // Add cache control headers
    res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });

    try {
        // Clear existing batches
        await pool.query('DELETE FROM batches');

        // Insert new batches
        for (const batch of batches) {
            await pool.query(
                'INSERT INTO batches (id, plant_date, quantity, stock, ready_for_sale) VALUES ($1, $2, $3, $4, $5)',
                [batch.id, batch.plantDate, batch.quantity, batch.stock, batch.readyForSale]
            );
        }

        console.log('Data saved successfully to database');
        res.json({ success: true, message: 'Data saved successfully', count: batches.length });
    } catch (error) {
        console.error('Database error saving batches:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Submit order
app.post('/order', async (req, res) => {
    const { batchId, quantity, phone, address, delivery, payment } = req.body;
    const user = req.session.user;

    console.log('Order submission:', { user: user ? user.username : 'guest', batchId, quantity });

    // Create order object
    const order = {
        id: Date.now().toString(),
        userId: user ? user.username : 'guest',
        batchId: parseInt(batchId),
        quantity: parseInt(quantity),
        phone,
        address,
        delivery,
        payment,
        status: 'pending',
        orderDate: new Date().toISOString(),
        totalPrice: parseInt(quantity) * 5000
    };

    console.log('Created order object:', order);

    try {
        // Insert order into database
        await pool.query(
            'INSERT INTO orders (id, user_id, batch_id, quantity, phone, address, delivery, payment, status, order_date, total_price) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
            [order.id, order.userId, order.batchId, order.quantity, order.phone, order.address, order.delivery, order.payment, order.status, order.orderDate, order.totalPrice]
        );

        // Update batch stock
        await pool.query(
            'UPDATE batches SET stock = stock - $1 WHERE id = $2',
            [order.quantity, order.batchId]
        );

        console.log('Order saved successfully for user:', order.userId);

        // Send to Telegram
        const message = `Pesanan Baru #${order.id}:\nUser: ${order.userId}\nBatch: ${batchId}\nJumlah: ${quantity}\nTelepon: ${phone}\nAlamat: ${address}\nPengiriman: ${delivery}\nPembayaran: ${payment}\nTotal: Rp ${order.totalPrice.toLocaleString('id-ID')}`;
        sendToTelegram(message);

        res.json({ success: true, orderId: order.id });
    } catch (error) {
        console.error('Database error saving order:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

function sendToTelegram(message) {
    const botToken = '8404581110:AAHbrXCEOpkuPMtnuZNkhgtmgbxZtsd_TSs';
    const chatId = '-4942084134';
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    const data = JSON.stringify({
        chat_id: chatId,
        text: message
    });

    const options = {
        hostname: 'api.telegram.org',
        path: `/bot${botToken}/sendMessage`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    };

    const req = https.request(options, (res) => {
        console.log(`Telegram status: ${res.statusCode}`);
    });

    req.on('error', (e) => {
        console.error(`Telegram error: ${e.message}`);
    });

    req.write(data);
    req.end();
}

// Health check endpoint for Railway
app.get('/health', async (req, res) => {
    try {
        const dbConnected = await testDatabaseConnection();
        if (dbConnected) {
            res.status(200).json({
                status: 'healthy',
                database: 'connected',
                timestamp: new Date().toISOString(),
                uptime: process.uptime()
            });
        } else {
            res.status(503).json({
                status: 'degraded',
                database: 'disconnected',
                timestamp: new Date().toISOString(),
                uptime: process.uptime()
            });
        }
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    }
});

// Additional health check endpoints that Railway might expect
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'home.html'));
});

app.get('/status', async (req, res) => {
    try {
        const dbConnected = await testDatabaseConnection();
        res.status(200).json({
            status: dbConnected ? 'healthy' : 'degraded',
            database: dbConnected ? 'connected' : 'disconnected',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            version: process.version
        });
    } catch (error) {
        res.status(200).json({
            status: 'degraded',
            database: 'error',
            error: error.message,
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            version: process.version
        });
    }
});

// Initialize database and start server
async function startServer() {
  try {
    console.log('🚀 Starting Plantera server...');

    // Test database connection first
    const dbConnected = await testDatabaseConnection();
    if (dbConnected) {
      console.log('📊 Initializing database...');
      await initializeDatabase();
    } else {
      console.log('⚠️ Database not available - starting server with limited functionality');
      console.log('📊 Database will be initialized when connection is restored');
    }

    // Start the server
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`🏥 Health check available at http://localhost:${PORT}/health`);
      console.log(`📊 Status check available at http://localhost:${PORT}/status`);
      console.log(`🌐 Frontend available at http://localhost:${PORT}/`);
      console.log('🎉 Plantera server is ready!');
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    console.log('🔄 Attempting to start server with minimal functionality...');

    // Try to start server even if database initialization fails
    try {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`⚠️ Server running on port ${PORT} with limited functionality`);
        console.log(`🏥 Health check available at http://localhost:${PORT}/health`);
        console.log('📊 Database functionality may be limited');
      });
    } catch (serverError) {
      console.error('❌ Failed to start server completely:', serverError);
      process.exit(1);
    }
  }
}

// Handle uncaught exceptions gracefully
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  // Don't exit process - let Railway restart the container
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit process - let Railway restart the container
});

startServer();