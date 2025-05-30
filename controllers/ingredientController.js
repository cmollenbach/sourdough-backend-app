// controllers/ingredientController.js
const pool = require('../config/db');

// GET /api/ingredients - Fetch all available ingredients
exports.getAllIngredients = async (req, res) => {
  console.log(`GET /api/ingredients - Fetching all available ingredients.`);
  try {
    // Selecting columns relevant for the frontend's StepEditor ingredient selection
    const query = `
      SELECT 
        ingredient_id, 
        ingredient_name, 
        is_wet -- Assuming you added this to your Ingredient table as discussed
               -- If not, you might need to infer it or add it.
               -- For now, let's assume it's in the table based on schema discussions.
               -- If 'is_wet' is not in 'Ingredient', you might fetch all and let frontend decide,
               -- or add logic here based on ingredient_name (less reliable).
      FROM "Ingredient" 
      ORDER BY ingredient_name ASC;
    `;
    const { rows } = await pool.query(query);
    
    // Ensure is_wet is a boolean, defaulting if necessary
    const ingredients = rows.map(ing => ({
        ...ing,
        is_wet: typeof ing.is_wet === 'boolean' ? ing.is_wet : false // Default to false if not set
    }));

    console.log(`   Found ${ingredients.length} available ingredients.`);
    res.json(ingredients);
  } catch (error) {
    console.error(`閥 Error in GET /api/ingredients:`, error.stack);
    res.status(500).json({ message: 'Failed to fetch available ingredients.' });
  }
};