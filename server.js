const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
const https = require('https');
const { Pool } = require('pg');
const PgSession = require('connect-pg-simple')(session);
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'leafy-jwt-secret-key-2024';

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
          name VARCHAR(100) NOT NULL DEFAULT 'Bibit Cabai',
          plant_date DATE NOT NULL,
          quantity INTEGER NOT NULL,
          stock INTEGER NOT NULL,
          ready_for_sale BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Add name column if it doesn't exist (for existing databases)
      try {
        await pool.query(`
          ALTER TABLE batches ADD COLUMN IF NOT EXISTS name VARCHAR(100) DEFAULT 'Bibit Cabai'
        `);
      } catch (alterError) {
        console.log('Name column already exists or alter failed (this is normal for new databases)');
      }

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
            'https://leafyweb.vercel.app',
            'https://leafy-web.vercel.app',
            'https://leafy-gamma.vercel.app',
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

// Handle favicon.ico requests
app.get('/favicon.ico', (req, res) => {
    res.status(204).end(); // No content response to prevent 404
});

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
    secret: process.env.SESSION_SECRET || 'leafy-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to false for Railway (internal communication)
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax' // Changed to lax for Railway
    },
    name: 'leafy.sid'
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

// JWT Token-based authentication (database-first with file fallback)
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    console.log('Login attempt for:', username);

    try {
        // First try to authenticate from database
        const dbConnected = await testDatabaseConnection();
        if (dbConnected) {
            try {
                const result = await pool.query(
                    'SELECT username, password, role FROM users WHERE username = $1',
                    [username]
                );

                if (result.rows.length > 0) {
                    const user = result.rows[0];

                    // Check password
                    if (user.password === password) {
                        // Generate JWT token
                        const token = jwt.sign(
                            { username: user.username, role: user.role },
                            JWT_SECRET,
                            { expiresIn: '24h' }
                        );

                        console.log('Login successful from database, token generated for:', user.username);
                        return res.json({
                            success: true,
                            role: user.role,
                            token: token
                        });
                    } else {
                        console.log('Login failed: Invalid password for user from database');
                        return res.json({ success: false });
                    }
                }
                // If user not found in database, continue to file system check
                console.log('User not found in database, checking file system...');
            } catch (dbError) {
                console.error('Database query error during login:', dbError);
                console.log('Falling back to file system...');
            }
        }

        // Fallback to file system if database is not available or user not found
        try {
            const usersData = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
            const user = usersData.find(u => u.username === username && u.password === password);

            if (user) {
                // Generate JWT token
                const token = jwt.sign(
                    { username: user.username, role: user.role },
                    JWT_SECRET,
                    { expiresIn: '24h' }
                );

                console.log('Login successful from file system, token generated for:', user.username);
                res.json({
                    success: true,
                    role: user.role,
                    token: token
                });
            } else {
                console.log('Login failed: Invalid credentials');
                res.json({ success: false });
            }
        } catch (fileError) {
            console.error('File system error during login:', fileError);
            res.status(500).json({ success: false, error: 'Login failed' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, error: 'Login failed' });
    }
});

// Logout
app.post('/logout', verifyToken, (req, res) => {
    console.log('User logged out:', req.user.username);
    res.json({ success: true, message: 'Logged out successfully' });
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
app.get('/user', verifyToken, (req, res) => {
    console.log('User check - Token verified for:', req.user.username);
    res.json(req.user);
});

// Test session endpoint (now tests token)
app.get('/test-session', verifyToken, (req, res) => {
    res.json({
        user: req.user,
        isAuthenticated: true
    });
});

// Get user orders (supports both authenticated and guest users)
app.get('/orders', async (req, res) => {
    // Add cache control headers
    res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });

    // Check if user is authenticated
    let authenticatedUser = null;
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            authenticatedUser = decoded;
        } catch (err) {
            console.log('Token verification failed for orders request');
        }
    }

    // Check for guest order lookup by phone
    const phone = req.query.phone;
    const orderId = req.query.orderId;

    console.log('Orders request:', {
        authenticated: !!authenticatedUser,
        user: authenticatedUser ? authenticatedUser.username : 'guest',
        phone: phone || 'not provided',
        orderId: orderId || 'not provided'
    });

    try {
        // First try to get data from database
        const dbConnected = await testDatabaseConnection();
        if (dbConnected) {
            try {
                let query = 'SELECT * FROM orders WHERE 1=1';
                let params = [];

                if (authenticatedUser) {
                    if (authenticatedUser.role === 'admin') {
                        // Admin sees all orders
                        query += ' ORDER BY order_date DESC';
                    } else {
                        // Regular user sees their orders
                        query += ' AND user_id = $1 ORDER BY order_date DESC';
                        params = [authenticatedUser.username];
                    }
                } else if (phone) {
                    // Guest lookup by phone
                    query += ' AND phone = $1 ORDER BY order_date DESC';
                    params = [phone];
                } else if (orderId) {
                    // Guest lookup by order ID
                    query += ' AND id = $1 ORDER BY order_date DESC';
                    params = [orderId];
                } else {
                    // No valid lookup method
                    return res.json([]);
                }

                const result = await pool.query(query, params);
                const ordersData = result.rows.map(row => ({
                    id: row.id,
                    userId: row.user_id,
                    batchId: row.batch_id,
                    quantity: row.quantity,
                    phone: row.phone,
                    address: row.address,
                    delivery: row.delivery,
                    payment: row.payment,
                    status: row.status,
                    orderDate: row.order_date,
                    totalPrice: row.total_price,
                    lastUpdated: row.last_updated
                }));

                console.log('Orders retrieved from database:', ordersData.length);
                return res.json(ordersData);
            } catch (dbError) {
                console.error('Database query error:', dbError);
                console.log('Falling back to file system...');
            }
        }

        // Fallback to file system if database is not available
        try {
            const ordersData = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));

            let filteredOrders = [];
            if (authenticatedUser) {
                if (authenticatedUser.role === 'admin') {
                    filteredOrders = ordersData;
                } else {
                    filteredOrders = ordersData.filter(order => order.userId === authenticatedUser.username);
                }
            } else if (phone) {
                filteredOrders = ordersData.filter(order => order.phone === phone);
            } else if (orderId) {
                filteredOrders = ordersData.filter(order => order.id === orderId);
            }

            console.log('Orders retrieved from file system:', filteredOrders.length);
            res.json(filteredOrders);
        } catch (fileError) {
            console.error('File system error:', fileError);
            // Return empty array if both database and file fail
            console.log('Returning empty orders array');
            res.json([]);
        }
    } catch (error) {
        console.error('Orders error:', error);
        res.status(500).json({ error: 'Unable to fetch orders data' });
    }
});

// Update order status (admin only)
app.put('/orders/:orderId', verifyToken, requireAdmin, async (req, res) => {
    const { orderId } = req.params;
    const { status } = req.body;

    console.log('Updating order', orderId, 'to status:', status);

    try {
        const dbConnected = await testDatabaseConnection();

        if (dbConnected) {
            const result = await pool.query(
                'UPDATE orders SET status = $1, last_updated = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
                [status, orderId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Order not found' });
            }

            console.log('Order', orderId, 'updated successfully to', status);
            res.json({ success: true, order: result.rows[0] });
        } else {
            console.log('Database not available, updating order in file system');

            // Update in file system
            try {
                const ordersData = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
                const orderIndex = ordersData.findIndex(order => order.id === orderId);

                if (orderIndex === -1) {
                    return res.status(404).json({ error: 'Order not found' });
                }

                ordersData[orderIndex].status = status;
                ordersData[orderIndex].lastUpdated = new Date().toISOString();

                fs.writeFileSync(ORDERS_FILE, JSON.stringify(ordersData, null, 2));

                console.log('Order', orderId, 'updated in file system to', status);
                res.json({ success: true, order: ordersData[orderIndex] });
            } catch (fileError) {
                console.error('Error updating order in file system:', fileError);
                res.status(500).json({ error: 'Failed to update order' });
            }
        }
    } catch (error) {
        console.error('Error updating order:', error);
        res.status(500).json({ error: 'Failed to update order' });
    }
});

// Middleware to verify JWT token
function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        console.log('Token verification failed: No token provided');
        return res.status(401).json({ error: 'Authentication required.' });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            console.log('Token verification failed:', err.message);
            return res.status(403).json({ error: 'Invalid or expired token.' });
        }

        req.user = decoded;
        console.log('Token verified for user:', decoded.username);
        next();
    });
}

// Middleware to check admin role (updated to use token)
function requireAdmin(req, res, next) {
    if (!req.user) {
        console.log('Admin access denied: No user in request');
        return res.status(401).json({ error: 'Authentication required.' });
    }

    if (req.user.role !== 'admin') {
        console.log('Admin access denied: User role is', req.user.role);
        return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }

    console.log('Admin access granted for user:', req.user.username);
    next();
}

// Get batches (database-first with file fallback)
app.get('/batches', async (req, res) => {
    // Add cache control headers to prevent browser caching
    res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });

    try {
        // First try to get data from database
        const dbConnected = await testDatabaseConnection();
        if (dbConnected) {
            try {
                const result = await pool.query('SELECT * FROM batches ORDER BY id');
                const batchesData = result.rows.map(row => ({
                    id: row.id,
                    name: row.name,
                    plantDate: row.plant_date,
                    quantity: row.quantity,
                    stock: row.stock,
                    readyForSale: row.ready_for_sale
                }));

                console.log('Serving batches from database:', batchesData.length, 'batches');
                return res.json(batchesData);
            } catch (dbError) {
                console.error('Database query error:', dbError);
                console.log('Falling back to file system...');
            }
        }

        // Fallback to file system if database is not available
        try {
            const batchesData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            console.log('Serving batches from file system:', batchesData.length, 'batches');
            res.json(batchesData);
        } catch (fileError) {
            console.error('File system error:', fileError);
            // Return empty array if both database and file fail
            console.log('Returning empty batches array');
            res.json([]);
        }
    } catch (error) {
        console.error('Batches error:', error);
        res.status(500).json({ error: 'Unable to fetch batches data' });
    }
});

// Save batches (admin only)
app.post('/batches', verifyToken, requireAdmin, async (req, res) => {
    const batches = req.body;
    console.log('Saving batches:', batches.length, 'batches');

    // Add cache control headers
    res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });

    try {
        // Try to save to database first
        const dbConnected = await testDatabaseConnection();
        if (dbConnected) {
            // Clear existing batches
            await pool.query('DELETE FROM batches');

            // Insert new batches
            for (const batch of batches) {
                await pool.query(
                    'INSERT INTO batches (id, name, plant_date, quantity, stock, ready_for_sale) VALUES ($1, $2, $3, $4, $5, $6)',
                    [batch.id, batch.name || 'Bibit Cabai', batch.plantDate, batch.quantity, batch.stock, batch.readyForSale]
                );
            }

            console.log('Data saved successfully to database');
        } else {
            console.log('Database not available, saving to file system');
        }

        // Always save to file system as backup
        try {
            fs.writeFileSync(DATA_FILE, JSON.stringify(batches, null, 2));
            console.log('Data saved to file system backup');
        } catch (fileError) {
            console.error('Error saving to file system:', fileError);
        }

        res.json({ success: true, message: 'Data saved successfully', count: batches.length });
    } catch (error) {
        console.error('Database error saving batches:', error);

        // Fallback: try to save to file system only
        try {
            fs.writeFileSync(DATA_FILE, JSON.stringify(batches, null, 2));
            console.log('Data saved to file system as fallback');
            res.json({ success: true, message: 'Data saved to file system', count: batches.length });
        } catch (fileError) {
            console.error('Error saving to file system:', fileError);
            res.status(500).json({ error: 'Failed to save data' });
        }
    }
});

// Submit order (supports both authenticated and guest users)
app.post('/order', async (req, res) => {
    const { batchId, quantity, phone, address, delivery, payment, userId } = req.body;

    // Check if user is authenticated via token
    let authenticatedUser = null;
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            authenticatedUser = decoded;
        } catch (err) {
            console.log('Token verification failed for order, proceeding as guest');
        }
    }

    // Determine user ID (authenticated user or guest)
    const finalUserId = authenticatedUser ? authenticatedUser.username : (userId || 'guest');

    console.log('Order submission:', {
        user: finalUserId,
        authenticated: !!authenticatedUser,
        batchId,
        quantity
    });

    // Validate required fields
    if (!batchId || !quantity || !phone || !address || !delivery || !payment) {
        return res.status(400).json({
            success: false,
            error: 'Semua field harus diisi (batch, jumlah, telepon, alamat, pengiriman, pembayaran)'
        });
    }

    // Create order object
    const order = {
        id: Date.now().toString(),
        userId: finalUserId,
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
        const dbConnected = await testDatabaseConnection();

        if (dbConnected) {
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

            console.log('Order saved successfully to database for user:', order.userId);
        } else {
            console.log('Database not available, saving order to file system');

            // Save to file system
            try {
                const ordersData = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
                ordersData.push(order);
                fs.writeFileSync(ORDERS_FILE, JSON.stringify(ordersData, null, 2));

                // Update batch stock in file system
                const batchesData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
                const batch = batchesData.find(b => b.id === order.batchId);
                if (batch) {
                    batch.stock -= order.quantity;
                    fs.writeFileSync(DATA_FILE, JSON.stringify(batchesData, null, 2));
                }

                console.log('Order saved to file system for user:', order.userId);
            } catch (fileError) {
                console.error('Error saving order to file system:', fileError);
                return res.status(500).json({ success: false, error: 'Failed to save order' });
            }
        }

        // Send to Telegram with guest/authenticated indicator
        const userType = authenticatedUser ? 'User Terdaftar' : 'Guest Order';
        const message = `🛒 Pesanan Baru #${order.id}:\n👤 ${userType}: ${order.userId}\n🌱 Batch: ${batchId}\n📦 Jumlah: ${quantity} bibit\n📞 Telepon: ${phone}\n🏠 Alamat: ${address}\n🚚 Pengiriman: ${delivery}\n💰 Pembayaran: ${payment}\n💵 Total: Rp ${order.totalPrice.toLocaleString('id-ID')}`;
        sendToTelegram(message);

        res.json({
            success: true,
            orderId: order.id,
            userType: authenticatedUser ? 'authenticated' : 'guest'
        });
    } catch (error) {
        console.error('Error saving order:', error);
        res.status(500).json({ success: false, error: 'Failed to save order' });
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
    console.log('🚀 Starting Leafy server...');

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
      console.log('🎉 Leafy server is ready!');
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