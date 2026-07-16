const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 4000;
const DATA_FILE = path.join(__dirname, 'services.json');

app.use(express.json());
app.use(express.static(__dirname));

// Initialize Database connection if DATABASE_URL is present
let pool = null;
let useDb = false;

if (process.env.DATABASE_URL) {
  console.log("DATABASE_URL found. Initializing PostgreSQL client pool...");
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false // Required for many hosting providers like Supabase/Neon
    },
    connectionTimeoutMillis: 4000, // Timeout connection after 4 seconds
    query_timeout: 4000 // Timeout query after 4 seconds
  });
  useDb = true;

  // Initialize table and seed default data
  initializeDatabase();
} else {
  console.log("No DATABASE_URL found. Using local services.json for persistence.");
}

async function initializeDatabase() {
  try {
    // Create menu table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS menu_config (
        id INT PRIMARY KEY,
        data JSONB NOT NULL
      );
    `);
    console.log("Database table 'menu_config' checked/created successfully.");

    // Check if we need to seed the default data
    const res = await pool.query('SELECT COUNT(*) FROM menu_config WHERE id = 1');
    if (parseInt(res.rows[0].count) === 0) {
      console.log("Table is empty. Seeding default data from services.json...");
      if (fs.existsSync(DATA_FILE)) {
        const fileData = fs.readFileSync(DATA_FILE, 'utf8');
        await pool.query('INSERT INTO menu_config (id, data) VALUES (1, $1)', [fileData]);
        console.log("Default menu data successfully seeded into PostgreSQL database.");
      } else {
        console.warn("services.json not found for seeding database.");
      }
    }
  } catch (err) {
    console.error("Database initialization error:", err);
  }
}


// Helper to read local menu file
function readLocalMenu(res) {
  fs.readFile(DATA_FILE, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read menu data.' });
    }
    res.json(JSON.parse(data));
  });
}

// Helper to save local menu file
function saveLocalMenu(newData, res) {
  fs.writeFile(DATA_FILE, JSON.stringify(newData, null, 2), 'utf8', (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to save menu data.' });
    }
    res.json({ success: true, message: 'Menuja u ruajt me sukses!' });
  });
}

// API to get menu
app.get('/api/menu', async (req, res) => {
  if (useDb) {
    try {
      const result = await pool.query('SELECT data FROM menu_config WHERE id = 1');
      if (result.rows.length === 0) {
        console.warn("Menu data not found in database. Trying local file fallback...");
        return readLocalMenu(res);
      }
      res.json(result.rows[0].data);
    } catch (err) {
      console.error("Error fetching menu from DB, falling back to local file:", err);
      readLocalMenu(res);
    }
  } else {
    readLocalMenu(res);
  }
});

// API to update menu
app.post('/api/menu', async (req, res) => {
  const newData = req.body;
  if (!newData || !newData.shop || !newData.categories) {
    return res.status(400).json({ error: 'Format i pasaktë i të dhënave.' });
  }

  if (useDb) {
    try {
      await pool.query(
        'INSERT INTO menu_config (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
        [JSON.stringify(newData)]
      );
      res.json({ success: true, message: 'Menuja u përditësua me sukses në databazë!' });
    } catch (err) {
      console.error("Error updating menu in DB:", err);
      res.status(500).json({ error: 'Gabim në databazë: ' + err.message });
    }
  } else {
    saveLocalMenu(newData, res);
  }
});

// API to get local network IP address (for QR Code scanning on local WiFi)
app.get('/api/ip', (req, res) => {
  const nets = os.networkInterfaces();
  const results = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push(net.address);
      }
    }
  }

  const localIp = results.length > 0 ? results[0] : 'localhost';
  res.json({ ip: localIp, port: PORT, url: `http://${localIp}:${PORT}` });
});

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

if (require.main === module || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;

