// sourdough-backend/server.js
const express = require('express');
const cors = require('cors');
const app = express();

// Use port from environment variable provided by Render, or 3001 for local development
const port = process.env.PORT || 3001;

// Configure CORS to allow requests from your Netlify frontend
// We'll set CLIENT_ORIGIN_URL as an environment variable in Render
const clientOrigin = process.env.CLIENT_ORIGIN_URL || 'http://localhost:3000'; // Default for local

const corsOptions = {
  origin: clientOrigin,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
console.log(`CORS enabled for origin: ${clientOrigin}`);


app.use(express.json()); // Middleware to parse JSON bodies

app.get('/', (req, res) => {
  res.send('Hello from the Sourdough Backend on Render!');
});

// Placeholder for user data (in-memory for now - will be lost on Render restarts/redeploys)
let userDataStore = {};

app.get('/api/recipe/:userId', (req, res) => {
  const userId = req.params.userId;
  const savedInputs = userDataStore[userId];
  console.log(`GET /api/recipe/${userId} from ${req.ip} - User-Agent: ${req.headers['user-agent']}`);
  console.log(`  Found data:`, savedInputs);

  if (savedInputs) {
    res.json(savedInputs);
  } else {
    // Send back the initial defaults if no data is found for the user
    res.json({
        targetDoughWeight: '1500',
        hydrationPercentage: '65',
        starterPercentage: '15',
        starterHydration: '100',
        saltPercentage: '2',
    });
  }
});

app.post('/api/recipe/:userId', (req, res) => {
  const userId = req.params.userId;
  const recipeInputs = req.body;
  console.log(`POST /api/recipe/${userId} from ${req.ip} - User-Agent: ${req.headers['user-agent']}`);
  console.log(`  Received data:`, recipeInputs);


  if (!recipeInputs || Object.keys(recipeInputs).length === 0) { // Check if body is empty
    console.log('  Error: Recipe inputs are missing or empty.');
    return res.status(400).json({ message: 'Recipe inputs are required and cannot be empty.' });
  }

  userDataStore[userId] = recipeInputs;
  console.log('  Saved data for user:', userId, userDataStore[userId]);
  res.status(200).json({ message: 'Recipe saved successfully!', data: recipeInputs });
});

// Listen on 0.0.0.0 for Render and the assigned port
app.listen(port, '0.0.0.0', () => {
  console.log(`Sourdough backend server listening on host 0.0.0.0, port ${port}`);
});