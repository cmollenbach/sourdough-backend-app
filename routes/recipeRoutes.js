// routes/recipeRoutes.js
const express = require('express');
const router = express.Router();
const recipeController = require('../controllers/recipeController');
const authenticateToken = require('../middleware/authenticateToken');

// Base Recipes (Templates) - Publicly accessible
// Mounted at /api/recipes, so this becomes GET /api/recipes/templates
router.get('/templates', recipeController.getRecipeTemplates);

// Predefined Steps - Requires authentication
// Mounted at /api/recipes, so this becomes GET /api/recipes/steps
router.get('/steps', authenticateToken, recipeController.getPredefinedSteps);

// User-specific Recipes - All require authentication
// Mounted at /api/recipes, paths are relative to this
router.post('/', authenticateToken, recipeController.createRecipe);         // POST /api/recipes
router.get('/', authenticateToken, recipeController.getAllUserRecipes);     // GET /api/recipes
router.get('/:recipeId', authenticateToken, recipeController.getRecipeById); // GET /api/recipes/:recipeId
router.put('/:recipeId', authenticateToken, recipeController.updateRecipe);  // PUT /api/recipes/:recipeId
router.delete('/:recipeId', authenticateToken, recipeController.deleteRecipe); // DELETE /api/recipes/:recipeId

module.exports = router;