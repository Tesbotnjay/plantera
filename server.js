const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
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

// Enhanced session configuration
app.use(session({
    secret: 'plantera-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: true, // HTTPS required for production
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'none' // Allow cross-origin cookies
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
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    console.log('Login attempt:', username);
    console.log('Session ID:', req.sessionID);

    fs.readFile(USERS_FILE, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading users file:', err);
            return res.status(500).send('Error');
        }

        const users = JSON.parse(data);
        const user = users.find(u => u.username === username && u.password === password);

        if (user) {
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
    });
});

// Logout
app.post('/logout', (req, res) => {
    req.session.destroy();
    res.send('Logged out');
});

// Register new user
app.post('/register', (req, res) => {
    const { username, password, role = 'customer' } = req.body;

    if (!username || !password) {
        return res.json({ success: false, message: 'Username dan password diperlukan' });
    }

    fs.readFile(USERS_FILE, 'utf8', (err, data) => {
        if (err) return res.status(500).send('Error reading users file');

        const users = JSON.parse(data);
        const existingUser = users.find(u => u.username === username);

        if (existingUser) {
            return res.json({ success: false, message: 'Username sudah digunakan' });
        }

        const newUser = { username, password, role };
        users.push(newUser);

        fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), (err) => {
            if (err) {
                console.error('Error saving user:', err);
                return res.status(500).send('Error saving user');
            }

            // Auto login after registration
            req.session.user = { username: newUser.username, role: newUser.role };
            res.json({ success: true, message: 'Registrasi berhasil', user: { username: newUser.username, role: newUser.role } });
        });
    });
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
app.get('/orders', (req, res) => {
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

    fs.readFile(ORDERS_FILE, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading orders file:', err);
            return res.status(500).json({ error: 'Error reading orders' });
        }

        let orders;
        try {
            orders = JSON.parse(data);
            // Ensure orders is always an array
            if (!Array.isArray(orders)) {
                orders = [];
            }
        } catch (parseError) {
            console.error('Error parsing orders JSON:', parseError);
            orders = [];
        }

        // If admin, return all orders; if customer, return only their orders
        let userOrders;
        if (req.session.user.role === 'admin') {
            userOrders = orders;
            console.log('Admin requesting all orders:', orders.length);
        } else {
            userOrders = orders.filter(order => order.userId === req.session.user.username);
            console.log('Orders for user', req.session.user.username + ':', userOrders.length);
        }

        res.json(userOrders);
    });
});

// Update order status (admin only)
app.put('/orders/:orderId', requireAdmin, (req, res) => {
    const { orderId } = req.params;
    const { status } = req.body;

    console.log('Updating order', orderId, 'to status:', status);

    fs.readFile(ORDERS_FILE, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading orders file:', err);
            return res.status(500).json({ error: 'Error reading orders' });
        }

        const orders = JSON.parse(data);
        const orderIndex = orders.findIndex(order => order.id === orderId);

        if (orderIndex === -1) {
            return res.status(404).json({ error: 'Order not found' });
        }

        orders[orderIndex].status = status;
        orders[orderIndex].lastUpdated = new Date().toISOString();

        fs.writeFile(ORDERS_FILE, JSON.stringify(orders, null, 2), (err) => {
            if (err) {
                console.error('Error updating order:', err);
                return res.status(500).json({ error: 'Error updating order' });
            }

            console.log('Order', orderId, 'updated successfully to', status);
            res.json({ success: true, order: orders[orderIndex] });
        });
    });
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
app.get('/batches', (req, res) => {
    // Add cache control headers to prevent browser caching
    res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });

    fs.readFile(DATA_FILE, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading batches file:', err);
            return res.status(500).send('Error reading data');
        }

        const batches = JSON.parse(data);
        console.log('Serving batches to client:', batches.length, 'batches');
        res.json(batches);
    });
});

// Save batches (admin only)
app.post('/batches', requireAdmin, (req, res) => {
    const batches = req.body;
    console.log('Saving batches:', batches.length, 'batches');

    // Add cache control headers
    res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });

    fs.writeFile(DATA_FILE, JSON.stringify(batches, null, 2), (err) => {
        if (err) {
            console.error('Error saving data:', err);
            return res.status(500).send('Error saving data');
        }
        console.log('Data saved successfully to', DATA_FILE);
        res.json({ success: true, message: 'Data saved successfully', count: batches.length });
    });
});

// Submit order
app.post('/order', (req, res) => {
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

    // Save order to file
    fs.readFile(ORDERS_FILE, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading orders file:', err);
            return res.status(500).send('Error saving order');
        }

        const orders = JSON.parse(data);
        orders.push(order);

        console.log('Saving order to file. Total orders now:', orders.length);

        fs.writeFile(ORDERS_FILE, JSON.stringify(orders, null, 2), (err) => {
            if (err) {
                console.error('Error saving order:', err);
                return res.status(500).send('Error saving order');
            }

            console.log('Order saved successfully for user:', order.userId);

            // Send to Telegram
            const message = `Pesanan Baru #${order.id}:\nUser: ${order.userId}\nBatch: ${batchId}\nJumlah: ${quantity}\nTelepon: ${phone}\nAlamat: ${address}\nPengiriman: ${delivery}\nPembayaran: ${payment}\nTotal: Rp ${order.totalPrice.toLocaleString('id-ID')}`;
            sendToTelegram(message);

            res.json({ success: true, orderId: order.id });
        });
    });
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

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});