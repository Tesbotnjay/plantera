let batches = [];

// Helper function to check if user is authenticated
function isAuthenticated() {
    const token = localStorage.getItem('token');
    return !!(token && currentUser);
}

// Helper function to get auth headers
function getAuthHeaders(additionalHeaders = {}) {
    const token = localStorage.getItem('token');

    if (!token) {
        console.error('Authentication required. Please login.');
        // Show login section if not already shown
        document.getElementById('login-section').style.display = 'block';
        document.getElementById('nav-tabs').style.display = 'none';
        throw new Error('Authentication required. Please login.');
    }

    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...additionalHeaders
    };
}

async function loadBatches() {
    try {
        // Add cache-busting parameter to prevent browser caching issues
        const cacheBust = Date.now();

        // For non-authenticated users, don't send auth headers
        const headers = isAuthenticated() ? getAuthHeaders({
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        }) : {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        };

        const response = await fetch(`https://leafy-production.up.railway.app/batches?_t=${cacheBust}`, {
            method: 'GET',
            headers: headers
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        console.log('Batches loaded:', data.length, 'batches');
        batches = data;

        // Force refresh of available stock display
        if (document.getElementById('beranda-section').classList.contains('active')) {
            displayAvailableStock();
        }

    } catch (error) {
        console.error('Error loading batches:', error);
        batches = [];
    }
}

async function saveBatches() {
    try {
        const cacheBust = Date.now();
        const response = await fetch(`https://leafy-production.up.railway.app/batches?_t=${cacheBust}`, {
            method: 'POST',
            headers: getAuthHeaders({
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }),
            body: JSON.stringify(batches)
        });

        if (response.status === 401) {
            console.log('401 error, token might be expired...');
            localStorage.removeItem('token');
            alert('Session expired. Please login again.');
            // Redirect to login
            document.getElementById('login-section').style.display = 'block';
            document.getElementById('nav-tabs').style.display = 'none';
            return;
        }

        if (response.ok) {
            const result = await response.json();
            console.log('Batches saved successfully:', result);
            // Immediately refresh batches after saving to ensure consistency
            await loadBatches();
        } else {
            const errorText = await response.text();
            console.error('Save failed:', response.status, errorText);
            alert('Gagal menyimpan data batch. Silakan coba lagi.');
        }
    } catch (error) {
        if (error.message === 'Authentication required. Please login.') {
            alert('Authentication required. Please login.');
            document.getElementById('login-section').style.display = 'block';
            document.getElementById('nav-tabs').style.display = 'none';
        } else {
            console.error('Error saving batches:', error);
            alert('Error saat menyimpan batch. Periksa koneksi internet Anda.');
        }
    }
}

function calculateDays(plantDate) {
    const now = new Date();
    const plant = new Date(plantDate);
    const diffTime = now - plant;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)); // Day 0 on planting day
    return diffDays;
}

function getBatchName(batchId) {
    const batch = batches.find(b => b.id === batchId);
    return batch ? batch.name : null;
}

function displayBatches() {
    const batchList = document.getElementById('batch-list');
    batchList.innerHTML = '';
    batches.forEach(batch => {
        const days = calculateDays(batch.plantDate);
        const div = document.createElement('div');
        div.className = 'batch-item';
        div.innerHTML = `
            <h3>${batch.name || `Batch ${batch.id}`}</h3>
            <p><strong>ID:</strong> Batch ${batch.id}</p>
            <p><strong>Tanggal Tanam:</strong> ${batch.plantDate}</p>
            <p><strong>Hari Ke:</strong> ${days}</p>
            <p><strong>Stok:</strong> ${batch.stock}/${batch.quantity}</p>
            <p><strong>Siap Dijual:</strong> ${batch.readyForSale ? 'Ya ✅' : 'Tidak 🚧'}</p>
            <div class="stock-update">
                <input type="number" id="stock-${batch.id}" min="0" value="${batch.stock}" placeholder="Update stok">
                <button onclick="updateStock(${batch.id})">📝 Update Stok</button>
                <button onclick="markReady(${batch.id})">${batch.readyForSale ? '❌ Batal Siap' : '✅ Siap Dijual'}</button>
                <button onclick="deleteBatch(${batch.id})" style="background-color: red;">🗑️ Hapus Batch</button>
            </div>
        `;
        batchList.appendChild(div);
    });
}

function displayAvailableStock(filteredBatches = null) {
    const availableStock = document.getElementById('available-stock');
    const select = document.getElementById('order-batch');
    const batchesToDisplay = filteredBatches || batches;

    console.log('Displaying available stock:', batchesToDisplay.length, 'batches');

    availableStock.innerHTML = '';
    select.innerHTML = '<option value="">Pilih Batch</option>';

    let visibleCount = 0;
    let readyCount = 0;

    batchesToDisplay.forEach(batch => {
        console.log('Processing batch:', batch.id, 'stock:', batch.stock, 'ready:', batch.readyForSale);

        // Show ALL batches with stock > 0, regardless of readyForSale status
        if (batch.stock > 0) {
            const days = calculateDays(batch.plantDate);
            const div = document.createElement('div');
            div.className = `batch-item ${!batch.readyForSale ? 'batch-not-ready' : 'batch-ready'}`;
            let content = `<h3>${batch.name || `Batch ${batch.id}`}</h3><p><strong>Jenis:</strong> ${batch.name || 'Bibit Cabai'}</p><p><strong>Jumlah Bibit:</strong> ${batch.quantity}</p><p><strong>Hari Ke:</strong> ${days}</p>`;

            if (!batch.readyForSale) {
                const progressPercent = Math.min(days, 14) / 14 * 100;
                const daysToReady = Math.max(0, 14 - days);
                content += `
                    <div class="progress-bar">
                        <div class="progress" style="width: ${progressPercent}%"></div>
                    </div>
                    <p class="status-info">🚧 Dalam Proses - Siap dalam ${daysToReady} hari lagi</p>
                    <p class="status-note">Batch ini belum bisa dipesan. Silakan tunggu hingga siap.</p>
                `;
            } else {
                content += `<p>✅ Stok Tersedia: ${batch.stock}</p><p class="status-ready">🎯 Siap Dijual - Bisa dipesan sekarang!</p>`;
                const option = document.createElement('option');
                option.value = batch.id;
                option.textContent = `${batch.name || `Batch ${batch.id}`} (Stok: ${batch.stock})`;
                select.appendChild(option);
                readyCount++;
            }

            div.innerHTML = content;
            availableStock.appendChild(div);
            visibleCount++;
        }
    });

    console.log('Display complete: visible batches:', visibleCount, 'ready batches:', readyCount);

    // Update results info
    updateResultsInfo(visibleCount, batchesToDisplay.length);

    // Apply current search/filter if active
    if (document.getElementById('batch-search').value || document.getElementById('status-filter').value !== 'all') {
        filterAndSearchBatches();
    }
}

function updateResultsInfo(visible, total) {
    let resultsInfo = document.querySelector('.batch-results-info');
    if (!resultsInfo) {
        resultsInfo = document.createElement('div');
        resultsInfo.className = 'batch-results-info';
        document.getElementById('available-stock').parentNode.insertBefore(resultsInfo, document.getElementById('available-stock'));
    }

    if (total === 0) {
        resultsInfo.textContent = 'Tidak ada batch yang ditemukan';
    } else if (visible === total) {
        resultsInfo.textContent = `Menampilkan ${visible} batch`;
    } else {
        resultsInfo.textContent = `Menampilkan ${visible} dari ${total} batch`;
    }
}

function filterAndSearchBatches() {
    const searchTerm = document.getElementById('batch-search').value.toLowerCase();
    const statusFilter = document.getElementById('status-filter').value;
    const sortFilter = document.getElementById('sort-filter').value;

    let filteredBatches = batches.filter(batch => {
        // Search filter
        const matchesSearch = searchTerm === '' ||
            batch.id.toString().toLowerCase().includes(searchTerm) ||
            batch.plantDate.toLowerCase().includes(searchTerm) ||
            batch.quantity.toString().includes(searchTerm);

        // Status filter
        let matchesStatus = true;
        if (statusFilter !== 'all') {
            const days = calculateDays(batch.plantDate);
            switch (statusFilter) {
                case 'available':
                    matchesStatus = batch.stock > 0;
                    break;
                case 'growing':
                    matchesStatus = batch.stock > 0 && !batch.readyForSale && days < 14;
                    break;
                case 'ready':
                    matchesStatus = batch.readyForSale && batch.stock > 0;
                    break;
            }
        }

        return matchesSearch && matchesStatus;
    });

    // Sort batches
    filteredBatches.sort((a, b) => {
        switch (sortFilter) {
            case 'newest':
                return new Date(b.plantDate) - new Date(a.plantDate);
            case 'oldest':
                return new Date(a.plantDate) - new Date(b.plantDate);
            case 'stock-high':
                return b.stock - a.stock;
            case 'stock-low':
                return a.stock - b.stock;
            default:
                return 0;
        }
    });

    displayAvailableStock(filteredBatches);

    // Show/hide clear button
    const clearBtn = document.getElementById('clear-search');
    clearBtn.style.display = searchTerm ? 'flex' : 'none';
}

function clearSearch() {
    document.getElementById('batch-search').value = '';
    filterAndSearchBatches();
}

// Force refresh data across all browsers
async function forceRefreshData() {
    console.log('Force refreshing all data...');

    try {
        // Clear any cached data
        batches = [];

        // Force reload from server with fresh request
        await loadBatches();

        // Refresh all displays
        if (document.getElementById('beranda-section').classList.contains('active')) {
            displayAvailableStock();
        }

        if (document.getElementById('kelola-section').classList.contains('active') && currentUser && currentUser.role === 'admin') {
            displayBatches();
            loadAdminOrders();
        } else if (document.getElementById('kelola-section').classList.contains('active') && (!currentUser || currentUser.role !== 'admin')) {
            // If management section is active but user is not admin, switch to dashboard
            console.log('Management section active for non-admin user, switching to dashboard');
            document.getElementById('kelola-section').classList.remove('active');
            document.getElementById('dashboard-btn').click();
        }

        if (document.getElementById('dashboard-section').classList.contains('active')) {
            loadDashboard();
        }

        showNotification('Data berhasil diperbarui dari server');
        console.log('Data refresh complete');
    } catch (error) {
        console.error('Error during force refresh:', error);
        alert('Gagal memperbarui data. Silakan refresh halaman.');
    }
}

async function addBatch(name, quantity, plantDate) {
    const maxId = batches.length > 0 ? Math.max(...batches.map(b => b.id)) : 0;
    const id = maxId + 1;
    const newBatch = {
        id: id,
        name: name,
        plantDate: plantDate,
        quantity: quantity,
        stock: quantity,
        readyForSale: false
    };
    batches.push(newBatch);
    await saveBatches();
    displayBatches();
    displayAvailableStock();
}

async function updateStock(id) {
    const input = document.getElementById(`stock-${id}`);
    const newStock = parseInt(input.value);
    const batch = batches.find(b => b.id === id);
    if (batch) {
        batch.stock = newStock;
        await saveBatches();
        displayBatches();
        displayAvailableStock();
    }
}

async function markReady(id) {
    const batch = batches.find(b => b.id === id);
    if (batch) {
        const wasReady = batch.readyForSale;
        batch.readyForSale = !batch.readyForSale;

        await saveBatches();

        // Refresh displays
        displayBatches();
        displayAvailableStock();

        // Show notification about the change
        const statusText = batch.readyForSale ? 'Siap Dijual' : 'Dalam Proses';
        showNotification(`Batch ${id} status diubah ke: ${statusText}`);

        // If this was marked as ready, inform about customer visibility
        if (!wasReady && batch.readyForSale) {
            setTimeout(() => {
                showNotification('✅ Batch sekarang terlihat oleh customer dan bisa dipesan!');
            }, 2000);
        }
    }
}

async function deleteBatch(id) {
    if (confirm('Apakah Anda yakin ingin menghapus batch ini?')) {
        batches = batches.filter(b => b.id !== id);
        await saveBatches();
        displayBatches();
        displayAvailableStock();
    }
}

let currentUser = null;

async function login() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    console.log('Attempting login for:', username);

    try {
        const response = await fetch('https://leafy-production.up.railway.app/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        console.log('Login response status:', response.status);
        console.log('Login response headers:', [...response.headers.entries()]);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Login failed:', errorText);
            alert('Login gagal! Server error.');
            return;
        }

        const result = await response.json();
        console.log('Login result:', result);

        if (result.success) {
            currentUser = { username, role: result.role };

            // Store token in localStorage
            if (result.token) {
                localStorage.setItem('token', result.token);
                console.log('Login successful for:', username);

                updateUI();

                // Load data after login
                try {
                    await loadBatches();
                    displayBatches();
                    displayAvailableStock();
                    showNotification(`Selamat datang, ${username}!`);
                } catch (error) {
                    console.error('Error loading data after login:', error);
                    showNotification(`Selamat datang, ${username}!`);
                }
            } else {
                console.error('No token received from server');
                alert('Login gagal! Token tidak diterima dari server.');
            }
        } else {
            alert('Login gagal! Periksa username dan password Anda.');
        }
    } catch (error) {
        console.error('Login error:', error);
        alert('Error saat login: ' + error.message);
    }
}

async function register() {
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value;
    const confirmPassword = document.getElementById('reg-confirm-password').value;

    console.log('Registration attempt:', { username, passwordLength: password.length });

    if (!username || !password) {
        alert('Username dan password harus diisi!');
        return;
    }

    if (username.length < 3) {
        alert('Username minimal 3 karakter!');
        return;
    }

    if (password !== confirmPassword) {
        alert('Password dan konfirmasi password tidak cocok!');
        return;
    }

    if (password.length < 6) {
        alert('Password minimal 6 karakter!');
        return;
    }

    try {
        console.log('Sending registration request...');
        const response = await fetch('https://leafy-production.up.railway.app/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        console.log('Registration response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Registration failed:', errorText);
            alert('Registrasi gagal: ' + errorText);
            return;
        }

        const result = await response.json();
        console.log('Registration result:', result);

        if (result.success) {
            currentUser = result.user;
            updateUI();
            await loadBatches();
            displayBatches();
            displayAvailableStock();
            showNotification('Registrasi berhasil! Selamat datang di Plantera.');
        } else {
            alert('Registrasi gagal: ' + result.message);
        }
    } catch (error) {
        console.error('Registration error:', error);
        alert('Error saat registrasi: ' + error.message);
    }
}

function showRegisterForm() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'block';
}

function showLoginForm() {
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
}

async function logout() {
    try {
        await fetch('https://leafy-production.up.railway.app/logout', {
            method: 'POST',
            headers: getAuthHeaders()
        });
    } catch (error) {
        console.error('Logout error:', error);
    }
    // Clear token and user data
    localStorage.removeItem('token');
    currentUser = null;
    updateUI();
}

function updateUI() {
    if (currentUser) {
        document.getElementById('login-section').style.display = 'none';
        document.getElementById('nav-tabs').style.display = 'block';
        document.getElementById('logout-btn').style.display = 'inline';
        document.getElementById('user-info').textContent = `Selamat datang, ${currentUser.username} (${currentUser.role})`;

        // Show/hide tabs based on user role
        if (currentUser.role === 'admin') {
            document.getElementById('kelola-btn').style.display = 'inline';
            document.getElementById('dashboard-btn').style.display = 'inline';
            // Show batch form for admin
            document.getElementById('batch-form').style.display = 'block';
        } else if (currentUser.role === 'customer') {
            document.getElementById('kelola-btn').style.display = 'none';
            document.getElementById('dashboard-btn').style.display = 'inline';
            // Ensure management section is never accessible to customers
            document.getElementById('kelola-section').style.display = 'none';
            // Hide batch form for customers
            document.getElementById('batch-form').style.display = 'none';
        }

        // Auto-switch to appropriate default tab
        if (currentUser.role === 'admin' && !document.querySelector('.tab-btn.active')) {
            document.getElementById('beranda-btn').click();
        } else if (currentUser.role === 'customer' && !document.querySelector('.tab-btn.active')) {
            document.getElementById('beranda-btn').click();
        }
    } else {
        document.getElementById('login-section').style.display = 'block';
        document.getElementById('nav-tabs').style.display = 'none';
        document.getElementById('logout-btn').style.display = 'none';
        document.getElementById('user-info').textContent = '';
        // Hide batch form when not logged in
        document.getElementById('batch-form').style.display = 'none';
        // Reset to login form
        showLoginForm();
    }
}
async function checkSession() {
    // Check if there's a token before attempting to verify session
    const token = localStorage.getItem('token');
    if (!token) {
        console.log('No token found, user needs to login');
        currentUser = null;
        updateUI();
        // Load batches for non-authenticated users
        await loadBatches();
        displayAvailableStock();
        return;
    }

    try {
        console.log('Checking session...');
        const response = await fetch('https://leafy-production.up.railway.app/user', {
            method: 'GET',
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            console.log('Session check failed:', response.status);
            currentUser = null;
            localStorage.removeItem('token'); // Clear invalid token
        } else {
            currentUser = await response.json();
            console.log('Session check successful, user:', currentUser);
        }

        updateUI();

        // Load data regardless of authentication status
        await loadBatches();
        if (currentUser) {
            displayBatches(); // Only show admin batches if authenticated
        }
        displayAvailableStock();
    } catch (error) {
        if (error.message === 'Authentication required. Please login.') {
            console.log('No token found, user needs to login');
            currentUser = null;
            localStorage.removeItem('token');
        } else {
            console.error('Session check error:', error);
            currentUser = null;
            localStorage.removeItem('token');
        }
        updateUI();
        // Load batches even if authentication failed
        await loadBatches();
        displayAvailableStock();
    }
}

function toggleMenu() {
    const menu = document.getElementById('menu');
    menu.classList.toggle('open');
}

function showNotification(message) {
    const notification = document.getElementById('notification');
    const messageEl = document.getElementById('notification-message');
    messageEl.textContent = message;
    notification.style.display = 'block';
    setTimeout(() => {
        notification.style.display = 'none';
    }, 5000);
}

function closeNotification() {
    document.getElementById('notification').style.display = 'none';
}

// Dashboard functions
async function loadDashboard() {
    if (!isAuthenticated() || !currentUser) {
        console.log('Not authenticated or no current user, cannot load dashboard');
        return;
    }

    console.log('Loading dashboard for user:', currentUser.username);

    try {
        const response = await fetch('https://leafy-production.up.railway.app/orders', {
            method: 'GET',
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            console.error('Failed to fetch orders:', response.status);
            return;
        }

        const orders = await response.json();
        console.log('Orders loaded:', orders.length, 'orders for user', currentUser.username);

        displayOrderStats(orders);
        displayOrderHistory(orders);
    } catch (error) {
        if (error.message === 'Authentication required. Please login.') {
            console.error('Authentication required for dashboard');
        } else {
            console.error('Error loading dashboard:', error);
        }
    }
}

function displayOrderStats(orders) {
    const totalOrders = orders.length;
    const totalSpent = orders.reduce((sum, order) => sum + order.totalPrice, 0);
    const pendingOrders = orders.filter(order => order.status === 'pending').length;

    document.getElementById('total-orders').textContent = totalOrders;
    document.getElementById('total-spent').textContent = `Rp ${totalSpent.toLocaleString('id-ID')}`;
    document.getElementById('pending-orders').textContent = pendingOrders;
}

function displayOrderHistory(orders) {
    const orderHistory = document.getElementById('order-history');

    if (orders.length === 0) {
        orderHistory.innerHTML = `
            <div class="no-orders">
                <p>Belum ada pesanan. <a href="#beranda-section" onclick="switchToBeranda()">Pesan sekarang</a></p>
            </div>
        `;
        return;
    }

    orderHistory.innerHTML = '';

    // Sort orders by date (newest first)
    orders.sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate));

    orders.forEach(order => {
        const orderDiv = document.createElement('div');
        orderDiv.className = 'order-item';

        const orderDate = new Date(order.orderDate).toLocaleDateString('id-ID', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        orderDiv.innerHTML = `
            <div class="order-header">
                <div class="order-id">Order #${order.id}</div>
                <div class="order-status ${order.status}">${order.status}</div>
            </div>
            <div class="order-details">
                <div class="order-detail">
                    <div class="order-detail-label">Tanggal Pesan</div>
                    <div class="order-detail-value">${orderDate}</div>
                </div>
                <div class="order-detail">
                    <div class="order-detail-label">Bibit</div>
                    <div class="order-detail-value">${getBatchName(order.batchId) || `Batch ${order.batchId}`}</div>
                </div>
                <div class="order-detail">
                    <div class="order-detail-label">Jumlah</div>
                    <div class="order-detail-value">${order.quantity} bibit</div>
                </div>
                <div class="order-detail">
                    <div class="order-detail-label">Pengiriman</div>
                    <div class="order-detail-value">${order.delivery === 'pickup' ? 'Ambil di Tempat' : 'Antar ke Alamat'}</div>
                </div>
                <div class="order-detail">
                    <div class="order-detail-label">Pembayaran</div>
                    <div class="order-detail-value">${order.payment}</div>
                </div>
                <div class="order-detail">
                    <div class="order-detail-label">Telepon</div>
                    <div class="order-detail-value">${order.phone}</div>
                </div>
            </div>
            <div class="order-total">Total: Rp ${order.totalPrice.toLocaleString('id-ID')}</div>
        `;

        orderHistory.appendChild(orderDiv);
    });
}

function switchToBeranda() {
    document.getElementById('beranda-btn').click();
}

// Test session function for debugging
async function testSession() {
    if (!isAuthenticated()) {
        console.log('Not authenticated, cannot test session');
        return null;
    }

    try {
        console.log('Testing session...');
        const response = await fetch('https://leafy-production.up.railway.app/test-session', {
            method: 'GET',
            headers: getAuthHeaders({
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            })
        });
        const result = await response.json();
        console.log('Session test result:', result);
        return result;
    } catch (error) {
        if (error.message === 'Authentication required. Please login.') {
            console.error('Authentication required for session test');
        } else {
            console.error('Session test error:', error);
        }
        return null;
    }
}

// Force session refresh
async function refreshSession() {
    if (!isAuthenticated() || !currentUser) {
        console.log('Not authenticated, cannot refresh session');
        return false;
    }

    console.log('Forcing session refresh...');
    try {
        // Test current session
        const sessionTest = await testSession();
        console.log('Current session status:', sessionTest);

        if (!sessionTest || !sessionTest.isAuthenticated) {
            console.log('Session invalid, attempting to re-authenticate...');
            // If we have stored credentials, try to login again
            if (currentUser && currentUser.username) {
                const response = await fetch('https://leafy-production.up.railway.app/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: currentUser.username,
                        password: 'wongirengjembuten69' // This is a fallback, ideally we'd store this securely
                    })
                });

                if (response.ok) {
                    const result = await response.json();
                    if (result.success) {
                        console.log('Session refreshed successfully');
                        currentUser = { username: currentUser.username, role: result.role };
                        // Store new token if provided
                        if (result.token) {
                            localStorage.setItem('token', result.token);
                        }
                        updateUI();
                        return true;
                    }
                }
            }
        } else {
            console.log('Session is still valid');
            return true;
        }
    } catch (error) {
        console.error('Session refresh failed:', error);
    }
    return false;
}

// Prevent multiple simultaneous admin order loads
let isLoadingAdminOrders = false;
let lastAdminOrdersLoad = 0;
const ADMIN_ORDERS_COOLDOWN = 5000; // 5 seconds cooldown

// Admin Order Management Functions
async function loadAdminOrders() {
    if (!isAuthenticated() || !currentUser || currentUser.role !== 'admin') {
        console.log('Not authenticated or not admin, skipping admin orders load');
        return;
    }

    // Prevent multiple simultaneous calls and enforce cooldown
    const now = Date.now();
    if (isLoadingAdminOrders || (now - lastAdminOrdersLoad) < ADMIN_ORDERS_COOLDOWN) {
        console.log('Admin orders already loading or in cooldown, skipping...');
        return;
    }

    isLoadingAdminOrders = true;
    lastAdminOrdersLoad = now;

    try {
        const response = await fetch('https://leafy-production.up.railway.app/orders', {
            method: 'GET',
            headers: getAuthHeaders({
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            })
        });

        if (response.status === 401) {
            console.log('401 error, token might be expired...');
            localStorage.removeItem('token');
            alert('Session expired. Please login again.');
            document.getElementById('login-section').style.display = 'block';
            document.getElementById('nav-tabs').style.display = 'none';
            return;
        }

        if (!response.ok) {
            console.error('Failed to fetch orders:', response.status, response.statusText);
            return;
        }

        const orders = await response.json();
        console.log('Admin orders loaded:', orders);

        // Ensure orders is an array
        const ordersArray = Array.isArray(orders) ? orders : [];
        displayAdminOrders(ordersArray);
    } catch (error) {
        if (error.message === 'Authentication required. Please login.') {
            console.error('Authentication required for admin orders');
            alert('Authentication required. Please login.');
            document.getElementById('login-section').style.display = 'block';
            document.getElementById('nav-tabs').style.display = 'none';
        } else {
            console.error('Error loading admin orders:', error);
        }
    } finally {
        isLoadingAdminOrders = false;
    }
}

function displayAdminOrders(orders) {
    const adminOrders = document.getElementById('admin-orders');

    if (!orders || orders.length === 0) {
        adminOrders.innerHTML = '<p>Tidak ada pesanan untuk dikelola.</p>';
        return;
    }

    adminOrders.innerHTML = '';

    orders.forEach(order => {
        const orderDiv = document.createElement('div');
        orderDiv.className = 'admin-order-item';

        const orderDate = new Date(order.orderDate).toLocaleDateString('id-ID', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        orderDiv.innerHTML = `
            <div class="admin-order-header">
                <div class="admin-order-info">
                    <h4>Order #${order.id}</h4>
                    <p><strong>User:</strong> ${order.userId}</p>
                    <p><strong>Tanggal:</strong> ${orderDate}</p>
                </div>
                <div class="admin-order-status">
                    <select onchange="updateOrderStatus('${order.id}', this.value)" class="status-select">
                        <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>Pending</option>
                        <option value="processing" ${order.status === 'processing' ? 'selected' : ''}>Processing</option>
                        <option value="completed" ${order.status === 'completed' ? 'selected' : ''}>Completed</option>
                        <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                    </select>
                </div>
            </div>
            <div class="admin-order-details">
                <div class="admin-order-detail">
                    <span class="admin-detail-label">Bibit:</span>
                    <span class="admin-detail-value">${getBatchName(order.batchId) || `Batch ${order.batchId}`}</span>
                </div>
                <div class="admin-order-detail">
                    <span class="admin-detail-label">Jumlah:</span>
                    <span class="admin-detail-value">${order.quantity} bibit</span>
                </div>
                <div class="admin-order-detail">
                    <span class="admin-detail-label">Total:</span>
                    <span class="admin-detail-value">Rp ${order.totalPrice.toLocaleString('id-ID')}</span>
                </div>
                <div class="admin-order-detail">
                    <span class="admin-detail-label">Pengiriman:</span>
                    <span class="admin-detail-value">${order.delivery === 'pickup' ? 'Ambil di Tempat' : 'Antar ke Alamat'}</span>
                </div>
                <div class="admin-order-detail">
                    <span class="admin-detail-label">Pembayaran:</span>
                    <span class="admin-detail-value">${order.payment}</span>
                </div>
                <div class="admin-order-detail">
                    <span class="admin-detail-label">Telepon:</span>
                    <span class="admin-detail-value">${order.phone}</span>
                </div>
                <div class="admin-order-detail">
                    <span class="admin-detail-label">Alamat:</span>
                    <span class="admin-detail-value">${order.address}</span>
                </div>
            </div>
        `;

        adminOrders.appendChild(orderDiv);
    });
}

async function updateOrderStatus(orderId, newStatus) {
    try {
        const response = await fetch(`https://leafy-production.up.railway.app/orders/${orderId}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ status: newStatus })
        });

        if (response.status === 401) {
            console.log('401 error, token might be expired...');
            localStorage.removeItem('token');
            alert('Session expired. Please login again.');
            document.getElementById('login-section').style.display = 'block';
            document.getElementById('nav-tabs').style.display = 'none';
            return;
        }

        if (response.ok) {
            showNotification(`Status pesanan #${orderId} berhasil diupdate ke ${newStatus}`);
            // Refresh both admin orders and dashboard if it's open
            loadAdminOrders();
            if (document.getElementById('dashboard-section').classList.contains('active')) {
                loadDashboard();
            }
        } else {
            const error = await response.json();
            alert('Gagal update status: ' + error.error);
        }
    } catch (error) {
        if (error.message === 'Authentication required. Please login.') {
            alert('Authentication required. Please login.');
            document.getElementById('login-section').style.display = 'block';
            document.getElementById('nav-tabs').style.display = 'none';
        } else {
            console.error('Error updating order status:', error);
            alert('Error saat update status pesanan');
        }
    }
}

document.getElementById('batch-form').addEventListener('submit', function(e) {
    e.preventDefault();

    // Check if user is admin before allowing batch creation
    if (!currentUser || currentUser.role !== 'admin') {
        alert('Akses ditolak! Hanya admin yang bisa menambah batch.');
        return;
    }

    const name = document.getElementById('batch-name').value.trim();
    const quantity = parseInt(document.getElementById('quantity').value);
    const plantDate = document.getElementById('plant-date').value;

    if (!name) {
        alert('Nama batch harus diisi!');
        return;
    }

    addBatch(name, quantity, plantDate);
    this.reset();
    showNotification(`✅ Batch "${name}" berhasil ditambahkan!`);
});

function updateTotal() {
    const quantity = parseInt(document.getElementById('order-quantity').value) || 0;
    const total = quantity * 5000;
    document.getElementById('total-price').textContent = `Total: Rp ${total.toLocaleString('id-ID')}`;
}

document.getElementById('order-quantity').addEventListener('input', updateTotal);

document.getElementById('delivery').addEventListener('change', function() {
    const addressField = document.getElementById('address');
    if (this.value === 'pickup') {
        // Store current address before changing to pickup
        if (addressField.value !== '' && addressField.value !== 'Ambil di Tempat') {
            addressField.dataset.previousAddress = addressField.value;
        }
        addressField.value = 'Ambil di Tempat';
        addressField.disabled = true;
    } else {
        // Restore previous address if it exists, otherwise clear
        if (addressField.dataset.previousAddress) {
            addressField.value = addressField.dataset.previousAddress;
            delete addressField.dataset.previousAddress;
        } else {
            addressField.value = '';
        }
        addressField.disabled = false;
    }
});

// Search and Filter Event Listeners
document.getElementById('batch-search').addEventListener('input', filterAndSearchBatches);
document.getElementById('status-filter').addEventListener('change', filterAndSearchBatches);
document.getElementById('sort-filter').addEventListener('change', filterAndSearchBatches);

document.getElementById('order-form-element').addEventListener('submit', async function(e) {
    e.preventDefault();
    const loading = document.getElementById('loading');
    loading.style.display = 'block';
    const batchId = parseInt(document.getElementById('order-batch').value);
    const quantity = parseInt(document.getElementById('order-quantity').value);
    const phone = document.getElementById('phone').value;
    let address = document.getElementById('address').value;
    const delivery = document.getElementById('delivery').value;
    const payment = document.getElementById('payment').value;
    if (delivery === 'pickup') {
        address = 'Ambil di Tempat';
    }
    const batch = batches.find(b => b.id === batchId);
    if (batch && quantity <= batch.stock) {
        batch.stock -= quantity;
        await saveBatches();
        displayBatches();
        displayAvailableStock();
        // Send order to server - allow guest orders
        try {
            // Prepare headers - use auth if available, otherwise send as guest
            let headers = { 'Content-Type': 'application/json' };
            let orderData = { batchId, quantity, phone, address, delivery, payment };

            if (isAuthenticated()) {
                // Add auth headers for logged-in users
                headers = getAuthHeaders();
                orderData.userId = currentUser.username;
            } else {
                // Guest order - no auth required
                orderData.userId = 'guest';
            }

            const response = await fetch('https://leafy-production.up.railway.app/order', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(orderData)
            });

            if (response.status === 401) {
                loading.style.display = 'none';
                console.log('401 error, token might be expired...');
                localStorage.removeItem('token');
                alert('Session expired. Please login again.');
                document.getElementById('login-section').style.display = 'block';
                document.getElementById('nav-tabs').style.display = 'none';
                return;
            }

            const result = await response.json();

            if (result.success) {
                setTimeout(() => {
                    loading.style.display = 'none';

                    // Show prominent Order ID notification
                    const orderIdMessage = `
                        <div style="text-align: center; padding: 20px; background: #e8f5e8; border: 3px solid #4caf50; border-radius: 10px; margin: 10px 0;">
                            <h3 style="color: #2e7d32; margin: 0 0 10px 0;">✅ PESANAN BERHASIL!</h3>
                            <p style="font-size: 18px; font-weight: bold; color: #1b5e20; margin: 5px 0;">
                                Order ID: <span style="font-size: 24px; color: #d32f2f;">#${result.orderId}</span>
                            </p>
                            <p style="color: #388e3c; margin: 5px 0;">
                                📝 <strong>SIMPAN ORDER ID INI!</strong><br>
                                Gunakan untuk cek status pesanan nanti
                            </p>
                        </div>
                    `;

                    // Create a custom notification element
                    const customNotification = document.createElement('div');
                    customNotification.style.cssText = `
                        position: fixed;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        background: white;
                        padding: 20px;
                        border-radius: 15px;
                        box-shadow: 0 10px 40px rgba(0,0,0,0.3);
                        z-index: 10000;
                        max-width: 400px;
                        text-align: center;
                    `;
                    customNotification.innerHTML = orderIdMessage + '<button onclick="this.parentElement.remove()" style="margin-top: 15px; padding: 10px 20px; background: #4caf50; color: white; border: none; border-radius: 5px; cursor: pointer;">OK</button>';

                    document.body.appendChild(customNotification);

                    if (isAuthenticated()) {
                        showNotification(`Order ID: #${result.orderId} - Cek Dashboard untuk status lengkap`);
                        // Refresh dashboard data if user is currently viewing dashboard
                        if (document.getElementById('dashboard-section').classList.contains('active')) {
                            loadDashboard();
                        }
                    } else {
                        showNotification(`Order ID: #${result.orderId} - Gunakan untuk tracking pesanan`);
                    }

                    // Reset form without causing scroll/focus issues
                    this.reset();
                    updateTotal();

                    // Prevent any unwanted scrolling by maintaining current scroll position
                    const currentScroll = window.pageYOffset;
                    setTimeout(() => {
                        window.scrollTo(0, currentScroll);
                    }, 100);
                }, 2000);
            } else {
                loading.style.display = 'none';
                alert('Gagal menyimpan pesanan. Silakan coba lagi.');
            }
        } catch (error) {
            loading.style.display = 'none';
            if (error.message === 'Authentication required. Please login.') {
                alert('Authentication required. Please login.');
                document.getElementById('login-section').style.display = 'block';
                document.getElementById('nav-tabs').style.display = 'none';
            } else {
                console.error('Order submission error:', error);
                alert('Terjadi kesalahan saat mengirim pesanan.');
            }
        }
    } else {
        loading.style.display = 'none';
        alert('Stok tidak mencukupi atau batch tidak valid.');
    }
});

document.getElementById('beranda-btn').addEventListener('click', function() {
    document.getElementById('beranda-section').classList.add('active');
    document.getElementById('kelola-section').classList.remove('active');
    document.getElementById('beranda-btn').classList.add('active');
    document.getElementById('kelola-btn').classList.remove('active');
});

document.getElementById('kelola-btn').addEventListener('click', function() {
    // Check if user is admin before allowing access to management
    if (currentUser && currentUser.role === 'admin') {
        document.getElementById('kelola-section').classList.add('active');
        document.getElementById('beranda-section').classList.remove('active');
        document.getElementById('dashboard-section').classList.remove('active');
        document.getElementById('kelola-btn').classList.add('active');
        document.getElementById('beranda-btn').classList.remove('active');
        document.getElementById('dashboard-btn').classList.remove('active');

        // Load admin orders when management tab is opened
        loadAdminOrders();
    } else {
        // If customer tries to access management, redirect to dashboard
        alert('Akses ditolak! Hanya admin yang bisa mengakses fitur management.');
        // Make sure management section is not active
        document.getElementById('kelola-section').classList.remove('active');
        document.getElementById('dashboard-btn').click();
    }
});

document.getElementById('dashboard-btn').addEventListener('click', function() {
    document.getElementById('dashboard-section').classList.add('active');
    document.getElementById('beranda-section').classList.remove('active');
    document.getElementById('kelola-section').classList.remove('active');
    document.getElementById('dashboard-btn').classList.add('active');
    document.getElementById('beranda-btn').classList.remove('active');
    document.getElementById('kelola-btn').classList.remove('active');

    // Always refresh dashboard data when switching to dashboard tab
    loadDashboard();
});


// Guest Order Tracking Function
async function trackGuestOrder() {
    const phone = document.getElementById('tracking-phone').value.trim();
    const orderId = document.getElementById('tracking-order-id').value.trim();
    const resultsDiv = document.getElementById('tracking-results');

    if (!phone && !orderId) {
        showNotification('❌ Silakan masukkan nomor telepon atau Order ID');
        return;
    }

    try {
        // Build query parameters
        let queryParams = [];
        if (phone) queryParams.push(`phone=${encodeURIComponent(phone)}`);
        if (orderId) queryParams.push(`orderId=${encodeURIComponent(orderId)}`);
        const queryString = queryParams.join('&');

        const response = await fetch(`https://leafy-production.up.railway.app/orders?${queryString}`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const orders = await response.json();

        if (orders.length === 0) {
            resultsDiv.innerHTML = `
                <div class="no-orders-found">
                    <h4>🔍 Tidak ada pesanan ditemukan</h4>
                    <p>Pastikan nomor telepon atau Order ID yang Anda masukkan sudah benar.</p>
                    <p>Jika masih bermasalah, hubungi kami di: <strong>0858-2185-8088</strong></p>
                </div>
            `;
        } else {
            resultsDiv.innerHTML = `
            <h4>📋 Status Pesanan Anda</h4>
            <div class="guest-orders-list">
                ${orders.map(order => `
                    <div class="guest-order-item">
                        <div class="guest-order-header">
                            <div class="guest-order-id">
                                <span style="font-size: 14px; color: #666;">Order ID:</span><br>
                                <span style="font-size: 20px; font-weight: bold; color: #d32f2f;">#${order.id}</span>
                            </div>
                            <div class="guest-order-status ${order.status}">${order.status}</div>
                        </div>
                        <div class="guest-order-details">
                            <div class="guest-order-detail">
                                <span class="guest-detail-label">📦 Bibit:</span>
                                <span class="guest-detail-value">${getBatchName(order.batchId) || `Batch ${order.batchId}`}</span>
                            </div>
                            <div class="guest-order-detail">
                                <span class="guest-detail-label">🔢 Jumlah:</span>
                                <span class="guest-detail-value">${order.quantity} bibit</span>
                            </div>
                            <div class="guest-order-detail">
                                <span class="guest-detail-label">💰 Total:</span>
                                <span class="guest-detail-value">Rp ${order.totalPrice.toLocaleString('id-ID')}</span>
                            </div>
                            <div class="guest-order-detail">
                                <span class="guest-detail-label">📅 Tanggal:</span>
                                <span class="guest-detail-value">${new Date(order.orderDate).toLocaleDateString('id-ID')}</span>
                            </div>
                            <div class="guest-order-detail">
                                <span class="guest-detail-label">🚚 Pengiriman:</span>
                                <span class="guest-detail-value">${order.delivery === 'pickup' ? 'Ambil di Tempat' : 'Antar ke Alamat'}</span>
                            </div>
                            <div class="guest-order-detail">
                                <span class="guest-detail-label">💳 Pembayaran:</span>
                                <span class="guest-detail-value">${order.payment}</span>
                            </div>
                        </div>
                        <div class="order-tracking-note">
                            <p style="margin: 10px 0; padding: 10px; background: #fff3cd; border: 2px solid #ffc107; border-radius: 5px; font-weight: bold; color: #856404;">
                                💡 <strong>PENTING:</strong> Simpan Order ID <strong style="color: #d32f2f;">#${order.id}</strong> untuk referensi selanjutnya
                            </p>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        }

        resultsDiv.style.display = 'block';
        showNotification(`✅ Ditemukan ${orders.length} pesanan`);

    } catch (error) {
        console.error('Error tracking order:', error);
        resultsDiv.innerHTML = `
            <div class="tracking-error">
                <h4>❌ Terjadi Kesalahan</h4>
                <p>Gagal memuat status pesanan. Silakan coba lagi atau hubungi kami.</p>
            </div>
        `;
        resultsDiv.style.display = 'block';
        showNotification('❌ Gagal memuat status pesanan');
    }
}

window.onload = async function() {
    setTimeout(async () => {
        await checkSession();

        // Always load batches for display, regardless of authentication status
        await loadBatches();
        displayAvailableStock();

        document.getElementById('loading-screen').style.display = 'none';

        // Initialize search and filter functionality
        if (document.getElementById('batch-search')) {
            filterAndSearchBatches();
        }

        // Start periodic session check every 5 minutes
        setInterval(async () => {
            if (currentUser) {
                console.log('Periodic session check...');
                const sessionTest = await testSession();
                if (!sessionTest || !sessionTest.isAuthenticated) {
                    console.log('Session expired, attempting refresh...');
                    await refreshSession();
                }
            }
        }, 5 * 60 * 1000); // 5 minutes
    }, 2000); // Show loading for 2 seconds
};