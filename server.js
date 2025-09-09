const express = require('express');
const cors = require('cors');
const session = require('express-session');
const https = require('https');
const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'leafy-jwt-secret-key-2024';

console.log('PORT env:', process.env.PORT);

// Neon connection
const sql = neon(process.env.DATABASE_URL);

// Test database connection

// Test database connectivity
async function testDatabaseConnection() {
  try {
    const result = await sql`SELECT version()`;
    console.log('✅ Database connection test successful');
    return true;
  } catch (error) {
    console.error('❌ Database connection test failed:', error);
    return false;
  }
}

let initPromise = null;

async function ensureDbInitialized() {
  if (!initPromise) {
    initPromise = testDatabaseConnection()
      .then(connected => {
        if (connected) {
          return initializeDatabase();
        } else {
          throw new Error('Database connection test failed');
        }
      })
      .catch(err => {
        console.error('DB init failed:', err);
        initPromise = null; // Allow retry on next invocation
        throw err;
      });
  }
  try {
    await initPromise;
  } catch (err) {
    console.error('Awaiting DB init failed:', err);
    throw err;
  }
}

// Initialize database tables
async function initializeDatabase() {
  try {
    console.log('Starting database initialization...');

    // Create users table
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS users (
          username VARCHAR(50) PRIMARY KEY,
          password VARCHAR(255) NOT NULL,
          role VARCHAR(20) NOT NULL DEFAULT 'customer',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;
      console.log('Users table ready');
    } catch (error) {
      console.error('Error creating users table:', error);
      throw error;
    }

    // Create batches table
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS batches (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL DEFAULT 'Bibit Cabai',
          plant_date DATE NOT NULL,
          quantity INTEGER NOT NULL,
          stock INTEGER NOT NULL,
          ready_for_sale BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;

      // Add name column if it doesn't exist (for existing databases)
      try {
        await sql`
          ALTER TABLE batches ADD COLUMN IF NOT EXISTS name VARCHAR(100) DEFAULT 'Bibit Cabai'
        `;
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
      await sql`
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
      `;
      console.log('Orders table ready');
    } catch (error) {
      console.error('Error creating orders table:', error);
      throw error;
    }

    // Session table not supported well with Neon serverless; skip and use memory store
    console.log('Skipping session table - using memory store for Neon');

    // Insert default users
    try {
      // Insert default admin user if not exists
      await sql`
        INSERT INTO users (username, password, role)
        VALUES ('sulvianti', 'wongirengjembuten69', 'admin')
        ON CONFLICT (username) DO NOTHING
      `;

      // Insert default customer user if not exists
      await sql`
        INSERT INTO users (username, password, role)
        VALUES ('customer', 'customer123', 'customer')
        ON CONFLICT (username) DO NOTHING
      `;

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

// Database-only operations - no file system fallbacks

// DB initialization middleware for serverless
app.use(async (req, res, next) => {
 if (req.path.startsWith('/_next') || req.path === '/favicon.ico') {
   return next(); // Skip init for static/internal paths
 }
 try {
   await ensureDbInitialized();
   next();
 } catch (err) {
   console.error('Failed to initialize DB for request:', err);
   if (!res.headersSent) {
     res.status(503).json({
       error: 'Service temporarily unavailable',
       details: 'Database initialization failed - please try again later'
     });
   }
 }
});

app.use(cors({
    origin: true, // Allow all origins for Vercel deployment
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Pragma']
}));
app.use(express.json());

// Logging middleware for debugging
app.use((req, res, next) => {
    console.log('Request:', req.method, req.url, 'from', req.headers.origin || 'no origin');
    next();
});

// Handle favicon.ico requests
app.get('/favicon.ico', (req, res) => {
    res.status(204).end(); // No content response to prevent 404
});

// Use memory session store for Neon (connect-pg-simple not compatible with serverless)
app.use(session({
    store: undefined, // Default to memory store
    secret: process.env.SESSION_SECRET || 'leafy-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to false for local/Vercel
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax'
    },
    name: 'leafy.sid'
}));

// Database-only operations - no file system initialization needed

// JWT Token-based authentication (database only)
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    console.log('Login attempt for:', username);

    try {
        const result = await sql`SELECT username, password, role FROM users WHERE username = ${username}`;

        if (result.length > 0) {
            const user = result[0];

            if (user.password === password) {
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
        } else {
            console.log('Login failed: User not found in database');
            return res.json({ success: false });
        }
    } catch (dbError) {
        console.error('❌ Database error for login:', dbError.message || dbError);
        res.status(500).json({ success: false, error: 'Login failed' });
    }
});

// Logout
app.post('/logout', verifyToken, (req, res) => {
    console.log('User logged out:', req.user.username);
    res.json({ success: true, message: 'Logged out successfully' });
});

// Register new user (database only)
app.post('/register', async (req, res) => {
    const { username, password, role = 'customer' } = req.body;

    if (!username || !password) {
        return res.json({ success: false, message: 'Username dan password diperlukan' });
    }

    try {
        // Check if user already exists
        const existingUser = await sql`SELECT username FROM users WHERE username = ${username}`;

        if (existingUser.length > 0) {
            return res.json({ success: false, message: 'Username sudah digunakan' });
        }

        // Insert new user
        await sql`INSERT INTO users (username, password, role) VALUES (${username}, ${password}, ${role})`;

        console.log('User registered successfully in database:', username);

        // Auto login after registration (session-based, not JWT for registration)
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

// Get user orders (supports both authenticated and guest users, database only)
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

    let ordersData = [];

    try {
        let result;
        if (authenticatedUser) {
            if (authenticatedUser.role === 'admin') {
                // Admin sees all orders
                result = await sql`SELECT * FROM orders ORDER BY order_date DESC`;
            } else {
                // Regular user sees their orders
                result = await sql`SELECT * FROM orders WHERE user_id = ${authenticatedUser.username} ORDER BY order_date DESC`;
            }
        } else if (phone) {
            // Guest lookup by phone
            result = await sql`SELECT * FROM orders WHERE phone = ${phone} ORDER BY order_date DESC`;
        } else if (orderId) {
            // Guest lookup by order ID
            result = await sql`SELECT * FROM orders WHERE id = ${orderId} ORDER BY order_date DESC`;
        } else {
            // No valid lookup method
            return res.json([]);
        }

        ordersData = result.map(row => ({
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
        res.json(ordersData);
    } catch (dbError) {
        console.error('❌ Database error for orders:', dbError.message || dbError);
        res.status(503).json({
            error: 'Service temporarily unavailable',
            details: 'Database connection failed - please try again later'
        });
    }
});

// Update order status (admin only, database only)
app.put('/orders/:orderId', verifyToken, requireAdmin, async (req, res) => {
    const { orderId } = req.params;
    const { status } = req.body;

    console.log('Updating order', orderId, 'to status:', status);

    try {
        const result = await sql`UPDATE orders SET status = ${status}, last_updated = CURRENT_TIMESTAMP WHERE id = ${orderId} RETURNING *`;

        if (result.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        console.log('Order', orderId, 'updated successfully to', status);
        res.json({ success: true, order: result[0] });

    } catch (error) {
        console.error('❌ Database error updating order:', error.message || error);
        res.status(503).json({
            error: 'Service temporarily unavailable',
            details: 'Database connection failed - please try again later'
        });
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

// Get batches (database only)
app.get('/batches', async (req, res) => {
    // Add cache control headers to prevent browser caching
    res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });

    console.log('🔍 Batches endpoint called from:', req.headers.origin || 'unknown origin');

    try {
        const result = await sql`SELECT * FROM batches ORDER BY id`;
        const batchesData = result.map(row => ({
            id: row.id,
            name: row.name,
            plantDate: row.plant_date,
            quantity: row.quantity,
            stock: row.stock,
            readyForSale: row.ready_for_sale
        }));

        console.log('✅ Serving batches from database:', batchesData.length, 'batches');
        res.json(batchesData);
    } catch (dbError) {
        console.error('❌ Database error for batches:', dbError.message || dbError);
        res.status(503).json({
            error: 'Service temporarily unavailable',
            details: 'Database connection failed - please try again later'
        });
    }
});

// Delete batch (admin only, database only)
app.delete('/batches/:id', verifyToken, requireAdmin, async (req, res) => {
    const batchId = parseInt(req.params.id);

    console.log('🗑️ Delete batch request for ID:', batchId);

    if (!batchId || isNaN(batchId)) {
        console.log('❌ Invalid batch ID provided');
        return res.status(400).json({ error: 'Invalid batch ID' });
    }

    try {
        // Delete from database
        const result = await sql`DELETE FROM batches WHERE id = ${batchId} RETURNING *`;
        console.log('✅ Database delete result:', result.length, 'rows affected');

        if (result.length === 0) {
            console.log('⚠️ Batch not found in database');
            return res.status(404).json({ error: 'Batch not found' });
        }

        console.log('✅ Batch deleted from database successfully');
        res.json({
            success: true,
            message: 'Batch deleted successfully',
            deletedBatch: result[0]
        });

    } catch (error) {
        console.error('❌ Database error deleting batch:', error.message || error);
        res.status(503).json({
            error: 'Service temporarily unavailable',
            details: 'Database connection failed - please try again later'
        });
    }
});

// Save batches (admin only, database only)
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
        // Clear existing batches
        await sql`DELETE FROM batches`;
        console.log('🗑️ Cleared existing batches from database');

        // Insert new batches
        for (const batch of batches) {
            await sql`INSERT INTO batches (id, name, plant_date, quantity, stock, ready_for_sale) VALUES (${batch.id}, ${batch.name || 'Bibit Cabai'}, ${batch.plantDate}, ${batch.quantity}, ${batch.stock}, ${batch.readyForSale})`;
        }

        console.log('✅ Data saved successfully to database');
        res.json({
            success: true,
            message: 'Data saved successfully',
            count: batches.length
        });

    } catch (error) {
        console.error('❌ Database error saving batches:', error.message || error);
        res.status(503).json({
            error: 'Service temporarily unavailable',
            details: 'Database connection failed - please try again later'
        });
    }
});

// Submit order (supports both authenticated and guest users, database only)
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
        // Insert order into database
        await sql`INSERT INTO orders (id, user_id, batch_id, quantity, phone, address, delivery, payment, status, order_date, total_price) VALUES (${order.id}, ${order.userId}, ${order.batchId}, ${order.quantity}, ${order.phone}, ${order.address}, ${order.delivery}, ${order.payment}, ${order.status}, ${order.orderDate}, ${order.totalPrice})`;

        // Update batch stock
        await sql`UPDATE batches SET stock = stock - ${order.quantity} WHERE id = ${order.batchId}`;

        console.log('Order saved successfully to database for user:', order.userId);

        // Send to Telegram with guest/authenticated indicator (always try this)
        try {
            const userType = authenticatedUser ? 'User Terdaftar' : 'Guest Order';
            const message = `🛒 Pesanan Baru #${order.id}:\n👤 ${userType}: ${order.userId}\n🌱 Batch: ${batchId}\n📦 Jumlah: ${quantity} bibit\n📞 Telepon: ${phone}\n🏠 Alamat: ${address}\n🚚 Pengiriman: ${delivery}\n💰 Pembayaran: ${payment}\n💵 Total: Rp ${order.totalPrice.toLocaleString('id-ID')}`;
            sendToTelegram(message);
        } catch (telegramError) {
            console.error('Telegram notification failed:', telegramError);
            // Don't fail the order because of Telegram
        }

        res.json({
            success: true,
            orderId: order.id,
            userType: authenticatedUser ? 'authenticated' : 'guest'
        });
    } catch (error) {
        console.error('❌ Database error saving order:', error.message || error);
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
app.get('/health', (req, res) => {
    // Simple health check without database test to ensure fast response
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
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

// Static file serving (placed after API routes to avoid conflicts)
app.use(express.static(__dirname));

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
    console.log(`Using port: ${PORT}`);
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

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

module.exports = app;

// Only start server if this file is run directly (not imported)
if (require.main === module) {
  startServer();
}