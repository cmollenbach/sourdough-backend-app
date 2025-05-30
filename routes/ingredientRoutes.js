// routes/ingredientRoutes.js
const express = require('express');
const router = express.Router();
const ingredientController = require('../controllers/ingredientController');
const authenticateToken = require('../middleware/authenticateToken'); // Or remove if this endpoint is public

// GET /api/ingredients - Fetch all available ingredients
// Decide if this route needs authentication.
// If it's just a list of names for dropdowns, it could be public.
// If it contains sensitive info or you want to restrict access, use authenticateToken.
router.get('/', authenticateToken, ingredientController.getAllIngredients);
// If public:
// router.get('/', ingredientController.getAllIngredients);


module.exports = router;