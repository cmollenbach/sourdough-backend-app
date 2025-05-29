// config/db.js
const { Pool } = require('pg');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') }); // Ensure .env is loaded relative to project root

if (!process.env.DATABASE_URL) {
  console.error("🔴 FATAL ERROR: DATABASE_URL is not defined. Check .env file.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('connect', () => {
  console.log('🟢 New client connected to the database');
});

pool.on('error', (err, client) => {
  console.error('🔴 UNEXPECTED ERROR ON IDLE PG CLIENT:', err);
});

// Initial Database Connection Check - Optional, but good to have
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('🔴 Error checking PostgreSQL database connection on startup:', err.stack);
  } else {
    console.log('🟢 Successfully connected to PostgreSQL database. Server time:', res.rows[0].now);
  }
});

module.exports = pool;