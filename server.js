// sourdough-backend/server.js
require('dotenv').config(); // Load .env file variables

// === Global Error Handlers (Place these very early) ===
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
// === End of Global Error Handlers ===

// Environment variable checks and setup
if (!process.env.DATABASE_URL) {
  console.error('🔴 FATAL ERROR: DATABASE_URL is not defined. Check .env file.');
  // process.exit(1); // Optionally exit
} else {
  console.log('🟢 DOTENV: DATABASE_URL seems loaded.');
}
if (process.env.CLIENT_ORIGIN_URL) {
  console.log('🟢 DOTENV: CLIENT_ORIGIN_URL loaded:', process.env.CLIENT_ORIGIN_URL);
} else {
  console.warn('🟠 DOTENV Warning: CLIENT_ORIGIN_URL not defined, CORS might default.');
}
if (!process.env.JWT_SECRET) {
  console.error('🔴 FATAL ERROR: JWT_SECRET is not defined. Check .env file.');
  // process.exit(1); // Optionally exit
} else {
  console.log('🟢 DOTENV: JWT_SECRET seems loaded.');
}
const JWT_SECRET = process.env.JWT_SECRET;

// Module requires
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 3001;

// PostgreSQL Connection Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// PG Pool Error Handler
pool.on('error', (err, client) => {
  console.error('🔴 UNEXPECTED ERROR ON IDLE PG CLIENT:', err);
  // Consider graceful shutdown: process.exit(1);
});

// Initial Database Connection Check (Removed the duplicate)
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('🔴 Error checking PostgreSQL database connection:', err.stack);
  } else {
    console.log('🟢 Successfully connected to PostgreSQL database. Server time:', res.rows[0].now);
  }
});

// CORS Configuration
const clientOrigin = process.env.CLIENT_ORIGIN_URL || 'http://localhost:3000';
app.use(cors({ origin: clientOrigin, optionsSuccessStatus: 200 }));
console.log(`CORS enabled for origin: ${clientOrigin}`);

// Middleware
app.use(express.json()); // Parse JSON request bodies

// === AUTHENTICATION MIDDLEWARE ===
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization']; // Express headers are lowercased
    const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer TOKEN"

    if (token == null) {
        console.log('Auth middleware: No token provided.');
        return res.status(401).json({ message: 'Access token is required.' }); // Unauthorized
    }

    jwt.verify(token, JWT_SECRET, (err, decodedTokenPayload) => {
        if (err) {
            console.log('Auth middleware: Token verification failed.', err.message);
            // err could be TokenExpiredError, JsonWebTokenError, etc.
            return res.status(403).json({ message: 'Token is invalid or expired.' }); // Forbidden
        }
        
        // Token is valid, decodedTokenPayload contains { userId, username, iat, exp }
        // We attach it to the request object so subsequent route handlers can access it
        req.user = decodedTokenPayload; 
        console.log('Auth middleware: Token verified successfully for user:', req.user.username, '(ID:', req.user.userId, ')');
        next(); // Proceed to the next middleware or route handler
    });
};
// === END OF AUTHENTICATION MIDDLEWARE ===
// === ROUTES ===

// Simple root route
app.get('/', (req, res) => {
  res.send('Hello from the Sourdough Backend!');
});



// DELETE /api/recipes/:recipeId - Delete a specific recipe for the authenticated user
app.delete('/api/recipes/:recipeId', authenticateToken, async (req, res) => {
    const loggedInUserId = req.user.userId;
    const username = req.user.username; // For logging
    const { recipeId } = req.params;

    console.log(`DELETE /api/recipes/${recipeId} - User [${username}, ID: ${loggedInUserId}] attempting to delete recipe.`);

    if (isNaN(parseInt(recipeId))) {
        return res.status(400).json({ message: 'Invalid recipe ID format.' });
    }

    const client = await pool.connect(); // Use a client for potential transaction, though simple delete might not strictly need it if no pre-checks beyond ownership are done.
                                        // However, good practice for consistency and if pre-checks become complex.
    try {
        await client.query('BEGIN');

        // 1. Verify recipe ownership before deleting
        const ownershipCheckQuery = 'SELECT user_id FROM Recipe WHERE recipe_id = $1;';
        const ownershipResult = await client.query(ownershipCheckQuery, [recipeId]);

        if (ownershipResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Recipe not found.' });
        }

        if (ownershipResult.rows[0].user_id !== loggedInUserId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ message: 'You are not authorized to delete this recipe.' });
        }

        // 2. Delete the recipe
        // ON DELETE CASCADE in your schema should handle RecipeStep and StageIngredient
        const deleteRecipeQuery = 'DELETE FROM Recipe WHERE recipe_id = $1 AND user_id = $2 RETURNING recipe_name;';
        const deleteResult = await client.query(deleteRecipeQuery, [recipeId, loggedInUserId]);

        if (deleteResult.rowCount === 0) {
            // This means the recipe wasn't deleted, which shouldn't happen if the ownership check passed
            // and the recipe_id was valid. Could be a concurrent modification or an issue.
            // Or if the user_id check was not also in the DELETE statement itself (it is here, which is good).
            await client.query('ROLLBACK');
            console.log(`  Recipe ID ${recipeId} was not deleted for user ID ${loggedInUserId}, though ownership was confirmed. Might indicate an issue or concurrent modification.`);
            return res.status(404).json({ message: 'Recipe not found or already deleted.' });
        }
        
        await client.query('COMMIT');
        
        const deletedRecipeName = deleteResult.rows[0].recipe_name;
        console.log(`  Recipe "${deletedRecipeName}" (ID: ${recipeId}) deleted successfully for user ID ${loggedInUserId}.`);
        res.status(200).json({ message: `Recipe "${deletedRecipeName}" deleted successfully.` });
        // Alternatively, for 204 No Content:
        // res.status(204).send();

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error(`🔴 Error in DELETE /api/recipes/${recipeId} for user ID ${loggedInUserId}:`, error.stack);
        res.status(500).json({ message: 'Failed to delete recipe due to server error.' });
    } finally {
        if (client) client.release();
    }
});


// PUT /api/recipes/:recipeId - Update an existing recipe for the authenticated user
app.put('/api/recipes/:recipeId', authenticateToken, async (req, res) => {
    const loggedInUserId = req.user.userId;
    const username = req.user.username; // For logging
    const { recipeId } = req.params;

    // Extract potential fields to update from req.body
    const {
        recipe_name,
        description,
        targetDoughWeight,
        target_weight_unit_id,
        hydrationPercentage,
        starterPercentage,
        starterHydration,
        saltPercentage
    } = req.body;

    console.log(`PUT /api/recipes/${recipeId} - User [${username}, ID: ${loggedInUserId}] attempting to update recipe.`);
    console.log(`  Update data received:`, req.body);

    if (isNaN(parseInt(recipeId))) {
        return res.status(400).json({ message: 'Invalid recipe ID format.' });
    }

    // Ensure at least one updatable field is provided
    if (Object.keys(req.body).length === 0) {
        return res.status(400).json({ message: 'No update data provided.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Verify recipe ownership and get current recipe details (including the 'Levain Build' recipe_step_id)
        const ownershipCheckQuery = `
            SELECT r.user_id, rs.recipe_step_id
            FROM Recipe r
            LEFT JOIN RecipeStep rs ON r.recipe_id = rs.recipe_id
            LEFT JOIN Step s ON rs.step_id = s.step_id AND s.step_name = 'Levain Build'
            WHERE r.recipe_id = $1;
        `;
        const ownershipResult = await client.query(ownershipCheckQuery, [recipeId]);

        if (ownershipResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Recipe not found.' });
        }
        if (ownershipResult.rows[0].user_id !== loggedInUserId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ message: 'You are not authorized to update this recipe.' });
        }
        
        // Get the recipe_step_id for the 'Levain Build' step if it exists
        const levainRecipeStepId = ownershipResult.rows[0].recipe_step_id;


        // 2. Update Recipe table
        // Construct the SET clause dynamically based on provided fields
        const recipeUpdateFields = [];
        const recipeUpdateValues = [];
        let recipeParamCount = 1;

        if (recipe_name !== undefined) {
            recipeUpdateFields.push(`recipe_name = $${recipeParamCount++}`);
            recipeUpdateValues.push(recipe_name.trim());
        }
        if (description !== undefined) {
            recipeUpdateFields.push(`description = $${recipeParamCount++}`);
            recipeUpdateValues.push(description);
        }
        if (targetDoughWeight !== undefined) {
            recipeUpdateFields.push(`target_weight = $${recipeParamCount++}`);
            recipeUpdateValues.push(parseFloat(targetDoughWeight));
        }
        if (target_weight_unit_id !== undefined) {
            recipeUpdateFields.push(`target_weight_unit_id = $${recipeParamCount++}`);
            recipeUpdateValues.push(parseInt(target_weight_unit_id));
        }
        if (hydrationPercentage !== undefined) {
            recipeUpdateFields.push(`target_hydration = $${recipeParamCount++}`);
            recipeUpdateValues.push(parseFloat(hydrationPercentage));
        }
        if (saltPercentage !== undefined) {
            recipeUpdateFields.push(`target_salt_pct = $${recipeParamCount++}`);
            recipeUpdateValues.push(parseFloat(saltPercentage));
        }
        
        if (recipeUpdateFields.length > 0) {
            recipeUpdateFields.push(`updated_at = CURRENT_TIMESTAMP`); // Always update timestamp
            const updateRecipeQuery = `
                UPDATE Recipe SET ${recipeUpdateFields.join(', ')}
                WHERE recipe_id = $${recipeParamCount} AND user_id = $${recipeParamCount + 1}
                RETURNING *;
            `;
            recipeUpdateValues.push(recipeId, loggedInUserId);
            const updatedRecipeResult = await client.query(updateRecipeQuery, recipeUpdateValues);
            if (updatedRecipeResult.rows.length === 0) {
                // Should not happen if ownership check passed, but as a safeguard
                throw new Error('Failed to update recipe or recipe not found for user.');
            }
            console.log(`  Recipe table updated for recipe ID: ${recipeId}`);
        }


        // 3. Update RecipeStep table (for 'Levain Build' step if starter details provided)
        const stepUpdateFields = [];
        const stepUpdateValues = [];
        let stepParamCount = 1;

        if (starterPercentage !== undefined) {
            stepUpdateFields.push(`contribution_pct = $${stepParamCount++}`);
            stepUpdateValues.push(parseFloat(starterPercentage));
        }
        if (starterHydration !== undefined) {
            stepUpdateFields.push(`target_hydration = $${stepParamCount++}`);
            stepUpdateValues.push(parseFloat(starterHydration));
        }

        let needsStageIngredientUpdate = false;
        if (stepUpdateFields.length > 0) {
            if (!levainRecipeStepId) {
                // This case should ideally not happen if POST always creates a 'Levain Build' step
                throw new Error("Cannot update starter details: 'Levain Build' step not found for this recipe.");
            }
            needsStageIngredientUpdate = true; // If starter % or hydration changes, ingredients change
            stepUpdateFields.push(`updated_at = CURRENT_TIMESTAMP`);
            const updateRecipeStepQuery = `
                UPDATE RecipeStep SET ${stepUpdateFields.join(', ')}
                WHERE recipe_step_id = $${stepParamCount}
                RETURNING *;
            `;
            stepUpdateValues.push(levainRecipeStepId);
            await client.query(updateRecipeStepQuery, stepUpdateValues);
            console.log(`  RecipeStep table updated for recipe_step_id: ${levainRecipeStepId}`);
        }
        
        // If targetDoughWeight changed, stage ingredients also need an update,
        // even if starterPercentage or starterHydration didn't.
        if (targetDoughWeight !== undefined) {
            needsStageIngredientUpdate = true;
        }

        // 4. Update StageIngredient if necessary
        if (needsStageIngredientUpdate && levainRecipeStepId) {
            // Fetch the latest recipe values (especially target_weight) and starter step values
            // as they might have been updated in this transaction or be different from req.body
            // For simplicity, we'll use values from req.body if provided, or fetch current.
            // A more robust way is to re-fetch the just-updated recipe and starter step values.

            const currentRecipeValues = await client.query('SELECT target_weight FROM Recipe WHERE recipe_id = $1', [recipeId]);
            const currentStepValues = await client.query('SELECT contribution_pct, target_hydration FROM RecipeStep WHERE recipe_step_id = $1', [levainRecipeStepId]);

            const effectiveTDW = parseFloat(targetDoughWeight !== undefined ? targetDoughWeight : currentRecipeValues.rows[0].target_weight);
            const effectiveSP = parseFloat(starterPercentage !== undefined ? starterPercentage : currentStepValues.rows[0].contribution_pct) / 100;
            const effectiveSH = parseFloat(starterHydration !== undefined ? starterHydration : currentStepValues.rows[0].target_hydration) / 100;

            const starterWeight = effectiveTDW * effectiveSP;
            const flourInStarter = starterWeight / (1 + effectiveSH);
            const waterInStarter = starterWeight - flourInStarter;

            console.log(`  Recalculating StageIngredients for Levain Step (ID ${levainRecipeStepId}): SW=${starterWeight.toFixed(1)}, F=${flourInStarter.toFixed(1)}, W=${waterInStarter.toFixed(1)}`);

            // Delete old StageIngredients for this step
            await client.query('DELETE FROM StageIngredient WHERE recipe_step_id = $1', [levainRecipeStepId]);

            // Insert new StageIngredients
            const flourIngResult = await client.query("SELECT ingredient_id FROM Ingredient WHERE ingredient_name = 'Bread Flour';");
            const waterIngResult = await client.query("SELECT ingredient_id FROM Ingredient WHERE ingredient_name = 'Water';");
            const flourIngredientId = flourIngResult.rows[0].ingredient_id;
            const waterIngredientId = waterIngResult.rows[0].ingredient_id;

            const stageIngredientQuery = `
                INSERT INTO StageIngredient (recipe_step_id, ingredient_id, calculated_weight, is_wet)
                VALUES ($1, $2, $3, $4);
            `;
            await client.query(stageIngredientQuery, [levainRecipeStepId, flourIngredientId, flourInStarter, false]);
            await client.query(stageIngredientQuery, [levainRecipeStepId, waterIngredientId, waterInStarter, true]);
            console.log(`  StageIngredient table updated for recipe_step_id: ${levainRecipeStepId}`);
        }

        await client.query('COMMIT');
        
        // Fetch the fully updated recipe to return it
        const updatedRecipeQuery = `
            SELECT r.*, rs.contribution_pct AS "starterPercentage", rs.target_hydration AS "starterHydration"
            FROM Recipe r
            LEFT JOIN RecipeStep rs ON r.recipe_id = rs.recipe_id AND rs.recipe_step_id = $2
            WHERE r.recipe_id = $1 AND r.user_id = $3;
        `;
        const finalResult = await client.query(updatedRecipeQuery, [recipeId, levainRecipeStepId, loggedInUserId]);


        console.log(`  Recipe ID ${recipeId} updated successfully for user ID ${loggedInUserId}.`);
        res.status(200).json({ 
            message: 'Recipe updated successfully!',
            recipe: finalResult.rows[0] // Return the updated recipe details
        });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error(`🔴 Error in PUT /api/recipes/${recipeId} for user ID ${loggedInUserId}:`, error.stack);
        res.status(500).json({ message: 'Failed to update recipe due to server error.' });
    } finally {
        if (client) client.release();
    }
});

// GET /api/recipes - Fetch all recipes for the authenticated user
app.get('/api/recipes', authenticateToken, async (req, res) => {
    const loggedInUserId = req.user.userId;
    const username = req.user.username; // For logging

    console.log(`GET /api/recipes - Fetching all recipes for user [${username}, ID: ${loggedInUserId}]`);

    try {
        // This query joins Recipe with RecipeStep and Step to get all necessary details
        // including the starter's contribution_pct and target_hydration from the 'Levain Build' step.
        const query = `
            SELECT
                r.recipe_id,
                r.recipe_name,
                r.description,
                r.target_weight, 
                r.target_weight_unit_id, 
                r.target_hydration,
                r.target_salt_pct,
                r.is_base_recipe,
                r.created_at,
                r.updated_at,
                rs.contribution_pct AS "starterPercentage",      -- From RecipeStep
                rs.target_hydration AS "starterHydration"     -- From RecipeStep
            FROM
                Recipe r
            INNER JOIN
                RecipeStep rs ON r.recipe_id = rs.recipe_id
            INNER JOIN
                Step s ON rs.step_id = s.step_id
            WHERE
                r.user_id = $1 AND s.step_name = 'Levain Build' -- Filter by user and specific step name
            ORDER BY
                r.created_at DESC;
        `;
        // Note: Using INNER JOIN assumes every recipe will have a 'Levain Build' step.
        // If that's not guaranteed, a LEFT JOIN might be more appropriate,
        // and you'd need to handle potential nulls for starterPercentage/starterHydration.
        // Given your current POST /api/recipes, an INNER JOIN should be fine.

        const { rows } = await pool.query(query, [loggedInUserId]);

        // Map to the frontend-expected field names (e.g., targetDoughWeight)
        // and ensure values are strings as the frontend component might expect.
        const recipesResponse = rows.map(recipe => ({
            recipe_id: recipe.recipe_id,
            recipe_name: recipe.recipe_name,
            description: recipe.description,
            targetDoughWeight: String(recipe.target_weight),
            // target_weight_unit_id: recipe.target_weight_unit_id, // You can include this if needed
            hydrationPercentage: String(recipe.target_hydration),
            saltPercentage: String(recipe.target_salt_pct),
            // is_base_recipe: recipe.is_base_recipe, // Include if needed
            starterPercentage: String(recipe.starterPercentage),
            starterHydration: String(recipe.starterHydration),
            created_at: recipe.created_at,
            updated_at: recipe.updated_at
        }));

        console.log(`  Found ${recipesResponse.length} recipes for user ID: ${loggedInUserId}`);
        res.json(recipesResponse);

    } catch (error) {
        console.error(`🔴 Error in GET /api/recipes for user ID ${loggedInUserId}:`, error.stack);
        res.status(500).json({ message: 'Failed to fetch recipes due to server error.' });
    }
});

// GET /api/recipes/:recipeId - Fetch a specific recipe by its ID for the authenticated user
app.get('/api/recipes/:recipeId', authenticateToken, async (req, res) => {
    const loggedInUserId = req.user.userId;
    const username = req.user.username; // For logging
    const { recipeId } = req.params;

    console.log(`GET /api/recipes/${recipeId} - Attempting to fetch for user [${username}, ID: ${loggedInUserId}]`);

    if (isNaN(parseInt(recipeId))) {
        return res.status(400).json({ message: 'Invalid recipe ID format.' });
    }

    try {
        const query = `
            SELECT
                r.recipe_id,
                r.recipe_name,
                r.description,
                r.target_weight,
                r.target_weight_unit_id,
                r.target_hydration,
                r.target_salt_pct,
                r.is_base_recipe,
                r.created_at,
                r.updated_at,
                rs.contribution_pct AS "starterPercentage",
                rs.target_hydration AS "starterHydration"
            FROM
                Recipe r
            INNER JOIN
                RecipeStep rs ON r.recipe_id = rs.recipe_id
            INNER JOIN
                Step s ON rs.step_id = s.step_id
            WHERE
                r.recipe_id = $1 AND r.user_id = $2 AND s.step_name = 'Levain Build';
        `;
        // This query ensures we only get the recipe if it belongs to the logged-in user
        // and also fetches the 'Levain Build' step details.

        const { rows } = await pool.query(query, [recipeId, loggedInUserId]);

        if (rows.length === 0) {
            // Recipe not found OR it doesn't belong to this user OR it doesn't have a 'Levain Build' step.
            // For security, it's often better to return 404 in all these cases
            // rather than distinguishing between "not found" and "forbidden".
            console.log(`  Recipe ID ${recipeId} not found for user ID ${loggedInUserId}, or 'Levain Build' step missing.`);
            return res.status(404).json({ message: 'Recipe not found.' });
        }

        const recipe = rows[0];

        // Map to the frontend-expected field names and stringify numbers
        const recipeResponse = {
            recipe_id: recipe.recipe_id,
            recipe_name: recipe.recipe_name,
            description: recipe.description,
            targetDoughWeight: String(recipe.target_weight),
            // target_weight_unit_id: recipe.target_weight_unit_id, // Include if frontend needs it
            hydrationPercentage: String(recipe.target_hydration),
            saltPercentage: String(recipe.target_salt_pct),
            // is_base_recipe: recipe.is_base_recipe, // Include if frontend needs it
            starterPercentage: String(recipe.starterPercentage),
            starterHydration: String(recipe.starterHydration),
            created_at: recipe.created_at,
            updated_at: recipe.updated_at
        };

        console.log(`  Successfully fetched recipe ID ${recipeId} for user ID ${loggedInUserId}:`, recipeResponse.recipe_name);
        res.json(recipeResponse);

    } catch (error) {
        console.error(`🔴 Error in GET /api/recipes/${recipeId} for user ID ${loggedInUserId}:`, error.stack);
        res.status(500).json({ message: 'Failed to fetch recipe due to server error.' });
    }
});

// POST /api/recipes - Create a new recipe for the authenticated user
app.post('/api/recipes', authenticateToken, async (req, res) => {
    // req.user is populated by authenticateToken middleware
    const dbUserId = req.user.userId; 
    const username = req.user.username; // For logging or other purposes

    const {
        recipe_name, // <<<< NEW: Expect recipe_name from client
        targetDoughWeight,
        target_weight_unit_id, // <<<< NEW: Expect unit_id from client (or default it)
        hydrationPercentage,
        starterPercentage,
        starterHydration,
        saltPercentage,
        description // Optional: if you want to save a description
    } = req.body;

    console.log(`POST /api/recipes - User [${username}, ID: ${dbUserId}] creating new recipe: "${recipe_name}"`);
    console.log(`  Received data:`, req.body);

    // Validation
    if (!recipe_name || recipe_name.trim() === "") {
        return res.status(400).json({ message: 'Recipe name is required.' });
    }
    if ([targetDoughWeight, hydrationPercentage, starterPercentage, starterHydration, saltPercentage].some(val => val == null)) {
        return res.status(400).json({ message: 'Missing one or more core recipe calculation inputs.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Use the target_weight_unit_id from request, or default to grams
        let final_target_weight_unit_id = target_weight_unit_id;
        if (final_target_weight_unit_id == null) {
            const unitResult = await client.query("SELECT unit_id FROM Unit WHERE unit_abbreviation = 'g';");
            if (unitResult.rows.length === 0) throw new Error("Default unit 'g' (grams) not found in Unit table.");
            final_target_weight_unit_id = unitResult.rows[0].unit_id;
            console.log(`  Defaulted target_weight_unit_id to 'grams' (ID: ${final_target_weight_unit_id})`);
        }

        const recipeQuery = `
            INSERT INTO Recipe (user_id, recipe_name, description, target_weight, target_weight_unit_id, target_hydration, target_salt_pct, is_base_recipe)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING recipe_id, recipe_name, created_at;
        `;
        const recipeParams = [
            dbUserId,
            recipe_name.trim(),
            description || null, // Handle optional description
            parseFloat(targetDoughWeight),
            final_target_weight_unit_id,
            parseFloat(hydrationPercentage),
            parseFloat(saltPercentage),
            false // is_base_recipe
        ];
        const recipeResult = await client.query(recipeQuery, recipeParams);
        const newRecipe = recipeResult.rows[0];
        const recipeId = newRecipe.recipe_id;

        // --- Create the 'Levain Build' RecipeStep ---
        // (This logic is similar to your previous POST, but now associated with the authenticated user's recipe)
        const stepResult = await client.query("SELECT step_id FROM Step WHERE step_name = 'Levain Build' AND is_predefined = TRUE;");
        if (stepResult.rows.length === 0) throw new Error("Predefined step 'Levain Build' not found in Step table.");
        const levainStepId = stepResult.rows[0].step_id;

        const recipeStepQuery = `
            INSERT INTO RecipeStep (recipe_id, step_id, step_order, contribution_pct, target_hydration)
            VALUES ($1, $2, $3, $4, $5) RETURNING recipe_step_id;
        `;
        const recipeStepParams = [
            recipeId, levainStepId, 1, // step_order is 1 for the main starter step
            parseFloat(starterPercentage), parseFloat(starterHydration)
        ];
        const recipeStepResult = await client.query(recipeStepQuery, recipeStepParams);
        const recipeStepId = recipeStepResult.rows[0].recipe_step_id;

        // --- StageIngredient for the 'Levain Build' step ---
        // IMPORTANT: Review these calculations based on your Sourdough logic.
        // The original calculation for flourInStarter/waterInStarter based on targetDoughWeight might not be what you intend
        // if starterPercentage is meant to be % of *total flour in the final dough*, not % of *targetDoughWeight*.
        // This is a common point of complexity in sourdough calculators.
        // For now, I'm keeping your existing calculation structure but highlighting it.
        const tempTotalDoughWeight = parseFloat(targetDoughWeight); // Using a temp variable for clarity
        const tempStarterPercentage = parseFloat(starterPercentage) / 100;
        const tempStarterHydration = parseFloat(starterHydration) / 100;

        // This calculation assumes starterWeight is tempStarterPercentage of tempTotalDoughWeight
        const starterWeight = tempTotalDoughWeight * tempStarterPercentage; 
        const flourInStarter = starterWeight / (1 + tempStarterHydration);
        const waterInStarter = starterWeight - flourInStarter;

        console.log(`  Calculated for Levain Step (ID ${recipeStepId}): StarterWeight=${starterWeight.toFixed(1)}, Flour=${flourInStarter.toFixed(1)}, Water=${waterInStarter.toFixed(1)}`);

        const flourIngResult = await client.query("SELECT ingredient_id FROM Ingredient WHERE ingredient_name = 'Bread Flour';"); // Or a more generic 'Flour' if preferred for starter
        const waterIngResult = await client.query("SELECT ingredient_id FROM Ingredient WHERE ingredient_name = 'Water';");
        if (flourIngResult.rows.length === 0) throw new Error("'Bread Flour' not found in Ingredient table.");
        if (waterIngResult.rows.length === 0) throw new Error("'Water' not found in Ingredient table.");
        const flourIngredientId = flourIngResult.rows[0].ingredient_id;
        const waterIngredientId = waterIngResult.rows[0].ingredient_id;

        const stageIngredientQuery = `
            INSERT INTO StageIngredient (recipe_step_id, ingredient_id, calculated_weight, is_wet)
            VALUES ($1, $2, $3, $4);
        `;
        await client.query(stageIngredientQuery, [recipeStepId, flourIngredientId, flourInStarter, false]);
        await client.query(stageIngredientQuery, [recipeStepId, waterIngredientId, waterInStarter, true]);
        // --- End of StageIngredient logic ---

        await client.query('COMMIT');
        console.log(`  Recipe "${newRecipe.recipe_name}" (ID: ${recipeId}) saved successfully for user ID: ${dbUserId}.`);
        res.status(201).json({ 
            message: 'Recipe created successfully!', 
            recipe: newRecipe // Return the created recipe header
        });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error(`🔴 Error in POST /api/recipes for user ID ${dbUserId}:`, error.stack);
        res.status(500).json({ message: 'Failed to create recipe due to server error.' });
    } finally {
        if (client) client.release();
    }
});

// --- Auth Routes ---
app.post('/auth/register', async (req, res) => {
  const { email, password } = req.body;
  const username = email; // Using email as username for simplicity with 'email' auth_provider

  console.log(`POST /auth/register - Attempting to register: ${username}`);
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }
  // Consider adding more robust email (format) and password (strength) validation.

  try {
    const userExistsQuery = 'SELECT * FROM "User" WHERE username = $1 OR email = $2';
    const existingUser = await pool.query(userExistsQuery, [username, email]);
    if (existingUser.rows.length > 0) {
      console.log(`  Registration failed: User already exists - ${username}`);
      return res.status(409).json({ message: 'User already exists with this email.' });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    console.log(`  Password hashed for: ${username}`);

    const insertUserQuery = `
      INSERT INTO "User" (username, email, password_hash, auth_provider)
      VALUES ($1, $2, $3, $4)
      RETURNING user_id, username, email, created_at;
    `;
    const newUserResult = await pool.query(insertUserQuery, [username, email, passwordHash, 'email']);
    const newUser = newUserResult.rows[0];

    console.log(`  User registered: ${JSON.stringify(newUser)}`);
    res.status(201).json({
      message: 'User registered successfully!',
      user: { userId: newUser.user_id, username: newUser.username, email: newUser.email, createdAt: newUser.created_at }
    });
  } catch (error) {
    console.error('🔴 Error in POST /auth/register:', error.stack);
    res.status(500).json({ message: 'Server error during registration.' });
  }
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const username = email; // Login with email, which is used as username for 'email' auth_provider

  console.log(`POST /auth/login - Attempting login: ${username}`);
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  try {
    const findUserQuery = 'SELECT * FROM "User" WHERE username = $1 AND auth_provider = $2';
    const userResult = await pool.query(findUserQuery, [username, 'email']);
    if (userResult.rows.length === 0) {
      console.log(`  Login failed: User not found - ${username}`);
      return res.status(401).json({ message: 'Invalid credentials.' }); // Generic message
    }
    const user = userResult.rows[0];

    const isPasswordMatch = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordMatch) {
      console.log(`  Login failed: Password incorrect for user - ${username}`);
      return res.status(401).json({ message: 'Invalid credentials.' }); // Generic message
    }

    const expiresIn = '1h'; // Token expiry time
    const token = jwt.sign(
      { userId: user.user_id, username: user.username },
      JWT_SECRET,
      { expiresIn }
    );

    console.log(`  Login successful, token generated for: ${username}`);
    res.status(200).json({
      message: 'Login successful!', token,
      user: { userId: user.user_id, username: user.username, email: user.email },
      expiresIn
    });
  } catch (error) {
    console.error('🔴 Error in POST /auth/login:', error.stack);
    res.status(500).json({ message: 'Server error during login.' });
  }
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`Sourdough backend server listening on host 0.0.0.0, port ${port}`);
});