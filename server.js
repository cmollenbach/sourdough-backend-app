// server.js
require('dotenv').config(); // Load .env file variables first

// === Global Process Error Handlers (Place these very early) ===
process.on('unhandledRejection', (reason, promise) => {
  console.error('🔴 UNHANDLED REJECTION:', reason);
  // Consider graceful shutdown in production: process.exit(1);
});
process.on('uncaughtException', (error) => {
  console.error('🔴 UNCAUGHT EXCEPTION:', error);
  // Critical error, consider graceful shutdown: process.exit(1);
});
process.on('exit', (code) => {
  console.log(`🔴 Node.js process is exiting with code: ${code}`);
});
// === End of Global Process Error Handlers ===


// Module requires
const express = require('express');
const cors = require('cors');
const path = require('path'); // For path.resolve if not already used

// Import configurations and routes
const pool = require('./config/db'); // Initializes DB connection pool
const authenticateToken = require('./middleware/authenticateToken'); // Though it's used within routes, good to be aware
const authRoutes = require('./routes/authRoutes');
const recipeRoutes = require('./routes/recipeRoutes'); // This will now handle /recipes, /templates, /steps based on its internal structure
const bakeRoutes = require('./routes/bakeRoutes');

// Environment variable checks (can be centralized in a config/environment.js if preferred)
if (!process.env.DATABASE_URL) {
  console.error("🔴 FATAL ERROR: DATABASE_URL is not defined. Check .env file.");
  process.exit(1);
} else {
  console.log("🟢 DOTENV: DATABASE_URL seems loaded from server.js perspective.");
}
if (process.env.CLIENT_ORIGIN_URL) {
  console.log("🟢 DOTENV: CLIENT_ORIGIN_URL loaded:", process.env.CLIENT_ORIGIN_URL);
} else {
  console.warn("🟠 DOTENV Warning: CLIENT_ORIGIN_URL not defined, CORS might default.");
}
if (!process.env.JWT_SECRET) {
  console.error("🔴 FATAL ERROR: JWT_SECRET is not defined for the main server. Check .env file.");
  process.exit(1);
} else {
  console.log("🟢 DOTENV: JWT_SECRET seems loaded from server.js perspective.");
}


const app = express();
const port = process.env.PORT || 3001;

// CORS Configuration
const clientOrigin = process.env.CLIENT_ORIGIN_URL || 'http://localhost:3000';
app.use(cors({ origin: clientOrigin, optionsSuccessStatus: 200 }));
console.log(`CORS enabled for origin: ${clientOrigin}`);

// Core Middleware
app.use(express.json()); // Parse JSON request bodies

// === MOUNT ROUTES ===
app.use('/auth', authRoutes);
// The recipeRoutes module now contains handlers for recipes, templates, and steps.
// We need to mount them according to their original paths or the new paths in recipeRoutes.js
// Option 1: Mount recipeRoutes multiple times for specific sub-paths if they were distinct
// app.use('/api/recipes', recipeRoutes); // if recipeRoutes only handles '/api/recipes/*'
// app.use('/api/templates', templateRoutes); // if you make a separate templateRoutes.js
// app.use('/api/steps', stepRoutes); // if you make a separate stepRoutes.js

// Option 2: Adjust recipeRoutes.js to handle sub-paths internally and mount it once,
// or use specific router files for each. For simplicity with the provided recipeController:
// We will assume recipeRoutes.js handles paths like '/', '/:recipeId', '/templates/all', '/steps/predefined'
// relative to its mount point.
app.use('/api/recipes', recipeRoutes); // All recipe related things under /api/recipes
                                      // This means /api/recipes/templates/all and /api/recipes/steps/predefined

app.use('/api/bakes', bakeRoutes);

// Simple root route
app.get('/', (req, res) => {
  res.send('Hello from the Sourdough Backend! (Refactored)');
});

// === GLOBAL ROUTE ERROR HANDLER ===
// This must be defined after all other app.use() and routes calls
app.use((err, req, res, next) => {
  console.error('🔴 GLOBAL ROUTE ERROR HANDLER:', err.stack);
  // More detailed error response for development
  if (process.env.NODE_ENV === 'development') {
    res.status(err.status || 500).json({
      message: err.message || 'Something broke!',
      error: err, // include stack in dev
    });
  } else {
    // Generic error response for production
    res.status(err.status || 500).json({
        message: err.message || 'Something broke!',
    });
  }
});


// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`Sourdough backend server (refactored) listening on host 0.0.0.0, port ${port}`);
});