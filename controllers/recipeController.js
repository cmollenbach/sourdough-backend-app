// controllers/recipeController.js
const pool = require('../config/db');
// Removed: const { getLevainBuildStepId, getIngredientIds } = require('../utils/dbHelpers');
// These specific helpers might be less relevant if client sends full stage ingredient details.
// However, getIngredientIds might still be useful if you need to look up IDs based on names for base recipes.

// POST /api/recipes - Create a new recipe with steps and stage ingredients
exports.createRecipe = async (req, res) => {
  const dbUserId = req.user.userId;
  const username = req.user.username;
  const {
    recipe_name,
    description,
    targetDoughWeight, // Frontend should send as number
    hydrationPercentage, // Frontend should send as number (e.g., 75 for 75%)
    saltPercentage,    // Frontend should send as number (e.g., 2.0 for 2.0%)
    steps, // Array of step objects, each can contain 'stageIngredients' array
  } = req.body;

  console.log(`User [${username}, ID: ${dbUserId}] creating new recipe: "${recipe_name}"`);

  // Basic Validations
  if (!recipe_name || recipe_name.trim() === "") {
    return res.status(400).json({ message: "Recipe name is required." });
  }
  if ([targetDoughWeight, hydrationPercentage, saltPercentage].some(val => val == null || isNaN(parseFloat(val)))) {
    return res.status(400).json({ message: "Missing or invalid core recipe parameters (targetDoughWeight, hydrationPercentage, saltPercentage)." });
  }
  if (!steps || !Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({ message: "At least one step is required." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const unitResult = await client.query('SELECT unit_id FROM "Unit" WHERE unit_abbreviation = \'g\';');
    if (unitResult.rows.length === 0) throw new Error("Default unit 'g' (grams) not found.");
    const gramsUnitId = unitResult.rows[0].unit_id;

    const recipeQuery = `
      INSERT INTO "Recipe" (user_id, recipe_name, description, target_weight, target_weight_unit_id, target_hydration, target_salt_pct, is_base_recipe, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING recipe_id, recipe_name;
    `;
    const recipeParams = [
        dbUserId, recipe_name.trim(), description || null,
        parseFloat(targetDoughWeight), gramsUnitId,
        parseFloat(hydrationPercentage), parseFloat(saltPercentage), false
    ];
    const recipeResult = await client.query(recipeQuery, recipeParams);
    const newRecipe = recipeResult.rows[0];
    const recipeId = newRecipe.recipe_id;

    for (const step of steps) {
      if (step.step_id == null || step.step_order == null) {
        throw new Error("Each step must have a step_id and step_order.");
      }
      // Validate step specific percentages if it's a preferment or main dough mixing step involving flours
      // For example, if step_type is 'Preferment' or 'Mixing' (for main dough) and stageIngredients defining flours exist, their sum should be 100.
      // This validation can be more complex and might be better handled by a dedicated validation function.

      const recipeStepQuery = `
        INSERT INTO "RecipeStep" (recipe_id, step_id, step_order, duration_override, notes, target_temperature_celsius, contribution_pct, target_hydration, stretch_fold_interval_minutes, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()) RETURNING recipe_step_id;
      `;
      const recipeStepValues = [
        recipeId, step.step_id, step.step_order,
        step.duration_override != null ? parseInt(step.duration_override, 10) : null,
        step.notes || null,
        step.target_temperature_celsius != null ? parseFloat(step.target_temperature_celsius) : null,
        step.contribution_pct != null ? parseFloat(step.contribution_pct) : null, // e.g., 20 for 20%
        step.target_hydration != null ? parseFloat(step.target_hydration) : null, // e.g., 100 for 100%
        step.stretch_fold_interval_minutes != null ? parseInt(step.stretch_fold_interval_minutes, 10) : null,
      ];
      const recipeStepResult = await client.query(recipeStepQuery, recipeStepValues);
      const newRecipeStepId = recipeStepResult.rows[0].recipe_step_id;

      // Insert StageIngredients if provided for the step
      if (step.stageIngredients && Array.isArray(step.stageIngredients)) {
        for (const stageIng of step.stageIngredients) {
          if (stageIng.ingredient_id == null || stageIng.percentage == null) { // calculated_weight is set by app, not taken from client here
            console.warn(`Skipping stage ingredient for step_order ${step.step_order} due to missing ingredient_id or percentage.`);
            continue;
          }
          const stageIngredientQuery = `
            INSERT INTO "StageIngredient" (recipe_step_id, ingredient_id, percentage, is_wet, created_at, updated_at)
            VALUES ($1, $2, $3, $4, NOW(), NOW());
          `;
          // calculated_weight will be handled by the frontend calculation logic, backend just stores the definition
          await client.query(stageIngredientQuery, [
            newRecipeStepId,
            stageIng.ingredient_id,
            parseFloat(stageIng.percentage), // e.g., 100 for 100%, 2.0 for 2.0%
            typeof stageIng.is_wet === 'boolean' ? stageIng.is_wet : false,
          ]);
        }
      }
    }

    await client.query("COMMIT");
    console.log(`   Recipe "${newRecipe.recipe_name}" (ID: ${recipeId}) and its steps/ingredients saved for user ID: ${dbUserId}.`);

    // Fetch the newly created recipe with all details to return
    const finalNewRecipeResult = await getFullRecipeDetails(client, recipeId, dbUserId);
    if (!finalNewRecipeResult) { // Should not happen if commit was successful
        throw new Error("Failed to retrieve the newly created recipe after commit.");
    }

    res.status(201).json({
      message: "Recipe created successfully!",
      recipe: finalNewRecipeResult,
    });

  } catch (error) {
    if (client) await client.query("ROLLBACK");
    console.error(`閥 Error in POST /api/recipes for user ID ${dbUserId}:`, error.stack);
    res.status(500).json({ message: `Failed to create recipe: ${error.message}` });
  } finally {
    if (client) client.release();
  }
};

// PUT /api/recipes/:recipeId - Update an existing recipe
exports.updateRecipe = async (req, res) => {
  const loggedInUserId = req.user.userId;
  const { recipeId } = req.params;
  const {
    recipe_name,
    description,
    targetDoughWeight,
    hydrationPercentage,
    saltPercentage,
    steps,
  } = req.body;

  console.log(`PUT /api/recipes/${recipeId} - User ID ${loggedInUserId} attempting update.`);
  if (isNaN(parseInt(recipeId))) {
    return res.status(400).json({ message: "Invalid recipe ID format." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Check ownership
    const ownershipResult = await client.query('SELECT user_id FROM "Recipe" WHERE recipe_id = $1;', [recipeId]);
    if (ownershipResult.rows.length === 0) {
      await client.query("ROLLBACK"); return res.status(404).json({ message: "Recipe not found." });
    }
    if (ownershipResult.rows[0].user_id !== loggedInUserId) {
      await client.query("ROLLBACK"); return res.status(403).json({ message: "Not authorized to update this recipe." });
    }

    // Update Recipe table
    const recipeUpdateFields = [];
    const recipeUpdateValues = [];
    let recipeParamCount = 1;

    if (recipe_name !== undefined) { recipeUpdateFields.push(`recipe_name = $${recipeParamCount++}`); recipeUpdateValues.push(recipe_name.trim()); }
    if (description !== undefined) { recipeUpdateFields.push(`description = $${recipeParamCount++}`); recipeUpdateValues.push(description); }
    if (targetDoughWeight !== undefined) { recipeUpdateFields.push(`target_weight = $${recipeParamCount++}`); recipeUpdateValues.push(parseFloat(targetDoughWeight));}
    if (hydrationPercentage !== undefined) { recipeUpdateFields.push(`target_hydration = $${recipeParamCount++}`); recipeUpdateValues.push(parseFloat(hydrationPercentage)); }
    if (saltPercentage !== undefined) { recipeUpdateFields.push(`target_salt_pct = $${recipeParamCount++}`); recipeUpdateValues.push(parseFloat(saltPercentage)); }

    if (recipeUpdateFields.length > 0) {
      recipeUpdateFields.push(`updated_at = NOW()`);
      const updateRecipeQuery = `UPDATE "Recipe" SET ${recipeUpdateFields.join(", ")} WHERE recipe_id = $${recipeParamCount} AND user_id = $${recipeParamCount + 1}`;
      recipeUpdateValues.push(recipeId, loggedInUserId);
      const updatedRecipeResult = await client.query(updateRecipeQuery, recipeUpdateValues);
      if (updatedRecipeResult.rowCount === 0) throw new Error("Failed to update recipe details.");
      console.log(`   Recipe table updated for recipe ID: ${recipeId}`);
    }

    // Replace RecipeSteps and their StageIngredients
    if (steps && Array.isArray(steps)) {
      console.log(`   Replacing steps and stage ingredients for recipe ID: ${recipeId}`);
      // Cascading delete on RecipeStep should handle StageIngredient if schema is set up that way,
      // but explicit delete is safer.
      await client.query('DELETE FROM "StageIngredient" WHERE recipe_step_id IN (SELECT recipe_step_id FROM "RecipeStep" WHERE recipe_id = $1)', [recipeId]);
      await client.query('DELETE FROM "RecipeStep" WHERE recipe_id = $1', [recipeId]);
      console.log(`   Old RecipeSteps and StageIngredients deleted for recipe ID: ${recipeId}`);

      for (const step of steps) {
        if (step.step_id == null || step.step_order == null) throw new Error("Each step must have step_id and step_order.");
        const recipeStepQuery = `
          INSERT INTO "RecipeStep" (recipe_id, step_id, step_order, duration_override, notes, target_temperature_celsius, contribution_pct, target_hydration, stretch_fold_interval_minutes, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()) RETURNING recipe_step_id;
        `;
        const recipeStepValues = [
            recipeId, step.step_id, step.step_order,
            step.duration_override != null ? parseInt(step.duration_override, 10) : null,
            step.notes || null,
            step.target_temperature_celsius != null ? parseFloat(step.target_temperature_celsius) : null,
            step.contribution_pct != null ? parseFloat(step.contribution_pct) : null,
            step.target_hydration != null ? parseFloat(step.target_hydration) : null,
            step.stretch_fold_interval_minutes != null ? parseInt(step.stretch_fold_interval_minutes, 10) : null,
        ];
        const recipeStepResult = await client.query(recipeStepQuery, recipeStepValues);
        const newRecipeStepId = recipeStepResult.rows[0].recipe_step_id;

        if (step.stageIngredients && Array.isArray(step.stageIngredients)) {
          for (const stageIng of step.stageIngredients) {
            if (stageIng.ingredient_id == null || stageIng.percentage == null) {
                console.warn(`Skipping stage ingredient update for step_order ${step.step_order} due to missing ingredient_id or percentage.`);
                continue;
            }
            const stageIngredientQuery = `
              INSERT INTO "StageIngredient" (recipe_step_id, ingredient_id, percentage, is_wet, created_at, updated_at)
              VALUES ($1, $2, $3, $4, NOW(), NOW());
            `;
            await client.query(stageIngredientQuery, [
              newRecipeStepId,
              stageIng.ingredient_id,
              parseFloat(stageIng.percentage),
              typeof stageIng.is_wet === 'boolean' ? stageIng.is_wet : false,
            ]);
          }
        }
      }
    }
    await client.query("COMMIT");

    const finalRecipeResult = await getFullRecipeDetails(client, recipeId, loggedInUserId);
     if (!finalRecipeResult) {
        throw new Error("Failed to retrieve the updated recipe after commit.");
    }

    console.log(`   Recipe ID ${recipeId} updated successfully for user ID ${loggedInUserId}.`);
    res.status(200).json({ message: "Recipe updated successfully!", recipe: finalRecipeResult });

  } catch (error) {
    if (client) await client.query("ROLLBACK");
    console.error(`閥 Error in PUT /api/recipes/${recipeId} for user ID ${loggedInUserId}:`, error.stack);
    res.status(500).json({ message: `Failed to update recipe: ${error.message}` });
  } finally {
    if (client) client.release();
  }
};

// Helper function to get full recipe details (used by create, update, getById)
async function getFullRecipeDetails(client, recipeId, userIdForPermissionCheck) {
    const query = `
      SELECT r.recipe_id, r.user_id, r.recipe_name, r.description, 
             r.target_weight AS "targetDoughWeight", 
             r.target_hydration AS "hydrationPercentage", 
             r.target_salt_pct AS "saltPercentage",
             r.is_base_recipe, r.created_at, r.updated_at,
             (SELECT json_agg(rs_agg.* ORDER BY rs_agg.step_order ASC) FROM (
                 SELECT rs.recipe_step_id, rs.step_id, s.step_name, s.step_type, s.description AS step_general_description,
                        s.duration_minutes AS step_default_duration_minutes, rs.step_order,
                        rs.duration_override, rs.notes, rs.target_temperature_celsius,
                        rs.contribution_pct, rs.target_hydration,
                        rs.stretch_fold_interval_minutes,
                        (SELECT json_agg(si_agg.* ORDER BY si_agg.stage_ingredient_id ASC) FROM (
                            SELECT si.stage_ingredient_id, si.ingredient_id, i.ingredient_name, si.percentage, si.is_wet, si.calculated_weight
                            FROM "StageIngredient" si
                            JOIN "Ingredient" i ON si.ingredient_id = i.ingredient_id
                            WHERE si.recipe_step_id = rs.recipe_step_id
                         ) AS si_agg
                        ) AS "stageIngredients" -- Changed from ingredients_in_step
                 FROM "RecipeStep" rs
                 JOIN "Step" s ON rs.step_id = s.step_id
                 WHERE rs.recipe_id = r.recipe_id
             ) AS rs_agg
            ) AS steps
      FROM "Recipe" r
      WHERE r.recipe_id = $1 AND (r.user_id = $2 OR (r.is_base_recipe = TRUE AND r.user_id IS NULL));
    `;
    // In the above query, added user_id check for non-base recipes.
    // For base recipes (user_id IS NULL), userIdForPermissionCheck is not strictly needed for ownership but good for consistency.
    // If userIdForPermissionCheck is NULL (e.g. for fetching public base templates), the OR condition handles it.

    const result = await client.query(query, [recipeId, userIdForPermissionCheck]);
    if (result.rows.length === 0) {
      // If specifically fetching for a user and not found, it could be an auth issue or recipe doesn't exist for them.
      // If fetching a base recipe and not found, it just doesn't exist.
      if (userIdForPermissionCheck) { // Only log/error if we expected it for a specific user
          console.warn(`Recipe ID ${recipeId} not found for user ID ${userIdForPermissionCheck} or it's not a base recipe.`);
      }
      return null;
    }

    const recipe = result.rows[0];
    // Convert numeric strings back to numbers for consistency if needed, or ensure frontend handles strings.
    // The query already aliases to the names frontend expects (targetDoughWeight etc.)
    recipe.targetDoughWeight = parseFloat(recipe.targetDoughWeight);
    recipe.hydrationPercentage = parseFloat(recipe.hydrationPercentage);
    recipe.saltPercentage = parseFloat(recipe.saltPercentage);
    if (recipe.steps) {
      recipe.steps = recipe.steps.map(step => ({
        ...step,
        stageIngredients: step.stageIngredients || [] // Ensure stageIngredients is always an array
      }));
    } else {
      recipe.steps = [];
    }
    return recipe;
}

// GET /api/recipes/templates - Fetch all base recipe templates
exports.getRecipeTemplates = async (req, res) => {
  console.log(`GET /api/recipes/templates - Fetching all base recipe templates.`);
  const client = await pool.connect();
  try {
    const query = `
      SELECT r.recipe_id, r.recipe_name, r.description, 
             r.target_weight AS "targetDoughWeight", 
             r.target_hydration AS "hydrationPercentage", 
             r.target_salt_pct AS "saltPercentage",
             r.is_base_recipe, r.created_at, r.updated_at,
             (SELECT json_agg(rs_agg.* ORDER BY rs_agg.step_order ASC) FROM (
                SELECT rs.recipe_step_id, rs.step_id, s.step_name, s.step_type, s.description AS step_general_description,
                       s.duration_minutes AS step_default_duration_minutes, rs.step_order, rs.duration_override,
                       rs.notes, rs.target_temperature_celsius, rs.contribution_pct, rs.target_hydration,
                       rs.stretch_fold_interval_minutes,
                       (SELECT json_agg(si_agg.* ORDER BY si_agg.stage_ingredient_id ASC) FROM (
                          SELECT si.stage_ingredient_id, si.ingredient_id, i.ingredient_name, si.percentage, si.is_wet, si.calculated_weight
                          FROM "StageIngredient" si JOIN "Ingredient" i ON si.ingredient_id = i.ingredient_id
                          WHERE si.recipe_step_id = rs.recipe_step_id
                       ) AS si_agg
                      ) AS "stageIngredients"
                FROM "RecipeStep" rs JOIN "Step" s ON rs.step_id = s.step_id
                WHERE rs.recipe_id = r.recipe_id
             ) AS rs_agg
            ) AS steps
      FROM "Recipe" r
      WHERE r.is_base_recipe = TRUE AND r.user_id IS NULL
      ORDER BY r.recipe_name ASC;
    `;
    const { rows } = await client.query(query);
    const templatesResponse = rows.map(recipe => ({
        ...recipe, // spread existing fields
        targetDoughWeight: String(recipe.targetDoughWeight), // Ensure string for consistency if frontend expects
        hydrationPercentage: String(recipe.hydrationPercentage),
        saltPercentage: String(recipe.saltPercentage),
        steps: recipe.steps ? recipe.steps.map(step => ({
            ...step, stageIngredients: step.stageIngredients || []
        })) : []
    }));
    console.log(`   Found ${templatesResponse.length} base recipe templates.`);
    res.json(templatesResponse);
  } catch (error) {
    console.error(`閥 Error in GET /api/recipes/templates:`, error.stack);
    res.status(500).json({ message: 'Failed to fetch base recipe templates.' });
  } finally {
    if (client) client.release();
  }
};

// GET /api/recipes - Fetch all recipes for the authenticated user
exports.getAllUserRecipes = async (req, res) => {
  const loggedInUserId = req.user.userId;
  console.log(`GET /api/recipes - Fetching all recipes for user ID ${loggedInUserId}`);
  const client = await pool.connect();
  try {
    // This query might become very heavy if recipes have many steps and ingredients.
    // For a list view, often less detail is needed. Consider a simpler query for the list,
    // and full details when a specific recipe is fetched.
    // For now, keeping it detailed to match potential frontend expectation for full objects.
    const query = `
      SELECT r.recipe_id, r.recipe_name, r.description, 
             r.target_weight AS "targetDoughWeight", 
             r.target_hydration AS "hydrationPercentage", 
             r.target_salt_pct AS "saltPercentage",
             r.is_base_recipe, r.created_at, r.updated_at,
             (SELECT json_agg(rs_agg.* ORDER BY rs_agg.step_order ASC) FROM (
                 SELECT rs.recipe_step_id, rs.step_id, s.step_name, s.step_type, s.description AS step_general_description,
                        s.duration_minutes AS step_default_duration_minutes, rs.step_order,
                        rs.duration_override, rs.notes, rs.target_temperature_celsius,
                        rs.contribution_pct, rs.target_hydration,
                        rs.stretch_fold_interval_minutes,
                        (SELECT json_agg(si_agg.* ORDER BY si_agg.stage_ingredient_id ASC) FROM (
                            SELECT si.stage_ingredient_id, si.ingredient_id, i.ingredient_name, si.percentage, si.is_wet, si.calculated_weight
                            FROM "StageIngredient" si
                            JOIN "Ingredient" i ON si.ingredient_id = i.ingredient_id
                            WHERE si.recipe_step_id = rs.recipe_step_id
                         ) AS si_agg
                        ) AS "stageIngredients"
                 FROM "RecipeStep" rs
                 JOIN "Step" s ON rs.step_id = s.step_id
                 WHERE rs.recipe_id = r.recipe_id
             ) AS rs_agg
            ) AS steps
      FROM "Recipe" r WHERE r.user_id = $1 ORDER BY r.created_at DESC;`;

    const { rows } = await client.query(query, [loggedInUserId]);
    const recipesResponse = rows.map(recipe => ({
        ...recipe,
        targetDoughWeight: String(recipe.targetDoughWeight),
        hydrationPercentage: String(recipe.hydrationPercentage),
        saltPercentage: String(recipe.saltPercentage),
        steps: recipe.steps ? recipe.steps.map(step => ({
            ...step, stageIngredients: step.stageIngredients || []
        })) : []
    }));
    console.log(`   Found ${recipesResponse.length} recipes for user ID: ${loggedInUserId}`);
    res.json(recipesResponse);
  } catch (error) {
    console.error(`閥 Error in GET /api/recipes for user ID ${loggedInUserId}:`, error.stack);
    res.status(500).json({ message: "Failed to fetch recipes." });
  } finally {
    if (client) client.release();
  }
};

// GET /api/recipes/:recipeId - Fetch a specific recipe
exports.getRecipeById = async (req, res) => {
  const loggedInUserId = req.user.userId; // For permission check on non-base recipes
  const { recipeId } = req.params;
  console.log(`GET /api/recipes/${recipeId} - Attempting fetch by user ID ${loggedInUserId} or as base recipe.`);

  if (isNaN(parseInt(recipeId))) {
    return res.status(400).json({ message: "Invalid recipe ID format." });
  }

  const client = await pool.connect();
  try {
    const recipe = await getFullRecipeDetails(client, recipeId, loggedInUserId);

    if (!recipe) {
      return res.status(404).json({ message: "Recipe not found or not authorized." });
    }
    console.log(`   Successfully fetched recipe ID ${recipeId}.`);
    res.json(recipe);
  } catch (error) {
    console.error(`閥 Error in GET /api/recipes/${recipeId}:`, error.stack);
    res.status(500).json({ message: "Failed to fetch recipe." });
  } finally {
    if (client) client.release();
  }
};

// GET /api/recipes/steps - Fetch all predefined step types
exports.getPredefinedSteps = async (req, res) => {
  console.log(`GET /api/recipes/steps - Fetching all predefined step types.`);
  try {
    const query = `
      SELECT step_id, step_name, description, step_type, 
             duration_minutes AS "defaultDurationMinutes" 
      FROM "Step" WHERE is_predefined = TRUE ORDER BY step_id ASC;`;
    const { rows } = await pool.query(query);
    console.log(`   Found ${rows.length} predefined steps.`);
    res.json(rows);
  } catch (error) {
    console.error(`閥 Error in GET /api/recipes/steps:`, error.stack);
    res.status(500).json({ message: 'Failed to fetch predefined steps.' });
  }
};

// DELETE /api/recipes/:recipeId - Delete a specific recipe
exports.deleteRecipe = async (req, res) => {
  const loggedInUserId = req.user.userId;
  const { recipeId } = req.params;
  console.log(`DELETE /api/recipes/${recipeId} - User ID ${loggedInUserId} attempting delete.`);

  if (isNaN(parseInt(recipeId))) {
    return res.status(400).json({ message: "Invalid recipe ID format." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ownershipResult = await client.query('SELECT user_id FROM "Recipe" WHERE recipe_id = $1;', [recipeId]);
    if (ownershipResult.rows.length === 0) {
      await client.query("ROLLBACK"); return res.status(404).json({ message: "Recipe not found." });
    }
    if (ownershipResult.rows[0].user_id !== loggedInUserId) {
      await client.query("ROLLBACK"); return res.status(403).json({ message: "Not authorized to delete this recipe." });
    }

    // StageIngredient rows will be deleted by CASCADE when RecipeStep rows are deleted.
    // RecipeStep rows will be deleted by CASCADE when Recipe row is deleted.
    // Explicit deletes are fine too for clarity if CASCADE is not fully relied upon or set up.
    // await client.query('DELETE FROM "StageIngredient" WHERE recipe_step_id IN (SELECT recipe_step_id FROM "RecipeStep" WHERE recipe_id = $1)', [recipeId]);
    // await client.query('DELETE FROM "RecipeStep" WHERE recipe_id = $1', [recipeId]);
    const deleteResult = await client.query('DELETE FROM "Recipe" WHERE recipe_id = $1 AND user_id = $2 RETURNING recipe_name;', [recipeId, loggedInUserId]);

    if (deleteResult.rowCount === 0) {
      // This case should ideally be caught by the ownership check, but as a safeguard.
      await client.query("ROLLBACK"); return res.status(404).json({ message: "Recipe not found or already deleted." });
    }
    await client.query("COMMIT");
    const deletedRecipeName = deleteResult.rows[0].recipe_name;
    console.log(`   Recipe "${deletedRecipeName}" (ID: ${recipeId}) deleted by user ID ${loggedInUserId}.`);
    res.status(200).json({ message: `Recipe "${deletedRecipeName}" deleted successfully.` });
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    console.error(`閥 Error in DELETE /api/recipes/${recipeId} for user ID ${loggedInUserId}:`, error.stack);
    res.status(500).json({ message: "Failed to delete recipe." });
  } finally {
    if (client) client.release();
  }
};