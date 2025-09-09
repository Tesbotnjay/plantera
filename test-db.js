require("dotenv").config();

const http = require("http");
const { neon } = require("@neondatabase/serverless");

const sql = neon(process.env.DATABASE_URL);

const requestHandler = async (req, res) => {
  if (req.url === '/' && req.method === 'GET') {
    try {
      // Test koneksi dan query sederhana
      const result = await sql`SELECT version()`;
      const { version } = result[0];
      
      // Test query tabel users (dari kode server.js)
      const usersResult = await sql`SELECT * FROM users LIMIT 1`;
      
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: true,
        dbVersion: version,
        sampleUser: usersResult[0] || 'No users yet',
        message: 'Koneksi database berhasil!'
      }));
    } catch (error) {
      console.error('Error koneksi DB:', error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: false,
        error: error.message
      }));
    }
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
};

http.createServer(requestHandler).listen(3000, () => {
  console.log("Test server running at http://localhost:3000");
  console.log("Buka browser ke http://localhost:3000 untuk test");
});