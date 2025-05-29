// controllers/recipeController.js
const pool = require('../config/db');
const { getLevainBuildStepId, getIngredientIds } = require('../utils/dbHelpers');

// POST /api/recipes - Create a new recipe with steps
exports.createRecipe = async (req, res) => {
  const dbUserId = req.user.userId;
  const username = req.user.username;
  const {
    recipe_name,
    description,
    targetDoughWeight,
    hydrationPercentage,
    saltPercentage,
    steps,
  } = req.body;

  console.log(`User [${username}, ID: ${dbUserId}] creating new recipe: "${recipe_name}"`);

  if (!recipe_name || recipe_name.trim() === "") {
    return res.status(400).json({ message: "Recipe name is required." });
  }
  if ([targetDoughWeight, hydrationPercentage, saltPercentage].some(val => val == null)) {
    return res.status(400).json({ message: "Missing core recipe parameters (targetDoughWeight, hydrationPercentage, saltPercentage)." });
  }
  if (!steps || !Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({ message: "At least one step is required." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const unitResult = await client.query('SELECT unit_id FROM "Unit" WHERE unit_abbreviation = \'g\';'); // Quoted "Unit"
    if (unitResult.rows.length === 0) throw new Error("Default unit 'g' (grams) not found.");
    const gramsUnitId = unitResult.rows[0].unit_id;

    const recipeQuery = `
      INSERT INTO "Recipe" (user_id, recipe_name, description, target_weight, target_weight_unit_id, target_hydration, target_salt_pct, is_base_recipe, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING recipe_id, recipe_name;
    `; // Quoted "Recipe"
    const recipeParams = [dbUserId, recipe_name.trim(), description || null, parseFloat(targetDoughWeight), gramsUnitId, parseFloat(hydrationPercentage), parseFloat(saltPercentage), false];
    const recipeResult = await client.query(recipeQuery, recipeParams);
    const newRecipe = recipeResult.rows[0];
    const recipeId = newRecipe.recipe_id;

    const LEVAIN_BUILD_STEP_ID = await getLevainBuildStepId(client); // Helper will use quoted table names
    const { flourIngredientId, waterIngredientId } = await getIngredientIds(client); // Helper will use quoted table names

    for (const step of steps) {
      if (step.step_id == null || step.step_order == null) {
        throw new Error("Each step must have a step_id and step_order.");
      }
      const recipeStepQuery = `
        INSERT INTO "RecipeStep" (recipe_id, step_id, step_order, duration_override, notes, target_temperature_celsius, contribution_pct, target_hydration, stretch_fold_interval_minutes, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()) RETURNING recipe_step_id;
      `; // Quoted "RecipeStep"
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

      if (parseInt(step.step_id, 10) === LEVAIN_BUILD_STEP_ID && step.contribution_pct != null && step.target_hydration != null) {
        const stepContributionPct = parseFloat(step.contribution_pct) / 100;
        const stepTargetHydration = parseFloat(step.target_hydration) / 100;
        const overallTargetDoughWeight = parseFloat(targetDoughWeight);
        const starterWeight = overallTargetDoughWeight * stepContributionPct;
        const flourInStarter = starterWeight / (1 + stepTargetHydration);
        const waterInStarter = starterWeight - flourInStarter;

        console.log(`   Levain Step (ID ${newRecipeStepId}): TDW=${overallTargetDoughWeight}, Contr%=${step.contribution_pct}, Hydr%=${step.target_hydration} => SW=${starterWeight.toFixed(1)}, F=${flourInStarter.toFixed(1)}, W=${waterInStarter.toFixed(1)}`);
        const stageIngredientQuery = `INSERT INTO "StageIngredient" (recipe_step_id, ingredient_id, calculated_weight, is_wet) VALUES ($1, $2, $3, $4);`; // Quoted "StageIngredient"
        await client.query(stageIngredientQuery, [newRecipeStepId, flourIngredientId, flourInStarter, false]);
        await client.query(stageIngredientQuery, [newRecipeStepId, waterIngredientId, waterInStarter, true]);
      }
    }

    await client.query("COMMIT");
    console.log(`   Recipe "${newRecipe.recipe_name}" (ID: ${recipeId}) and steps saved for user ID: ${dbUserId}.`);
    
    const finalNewRecipeQuery = `
        SELECT r.recipe_id, r.recipe_name, r.description, 
               r.target_weight AS "targetDoughWeight", 
               r.target_hydration AS "hydrationPercentage", 
               r.target_salt_pct AS "saltPercentage",
               r.created_at, r.updated_at,
               (SELECT json_agg(rs_agg.* ORDER BY rs_agg.step_order ASC) FROM (
                   SELECT rs.recipe_step_id, rs.step_id, s.step_name, rs.step_order,
                          rs.duration_override, rs.notes, rs.target_temperature_celsius,
                          rs.contribution_pct, rs.target_hydration,
                          rs.stretch_fold_interval_minutes
                   FROM "RecipeStep" rs
                   JOIN "Step" s ON rs.step_id = s.step_id
                   WHERE rs.recipe_id = r.recipe_id
               ) AS rs_agg) AS steps
        FROM "Recipe" r
        WHERE r.recipe_id = $1 AND r.user_id = $2;
    `; // Quoted "Recipe", "RecipeStep", "Step"
    const finalNewRecipeResult = await client.query(finalNewRecipeQuery, [recipeId, dbUserId]);

    res.status(201).json({
      message: "Recipe created successfully!",
      recipe: finalNewRecipeResult.rows[0] || { ...newRecipe, recipe_id: recipeId, steps: req.body.steps },
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    console.error(`🔴 Error in POST /api/recipes for user ID ${dbUserId}:`, error.stack);
    res.status(500).json({ message: `Failed to create recipe: ${error.message}` });
  } finally {
    if (client) client.release();
  }
};

// GET /api/recipes/templates - Fetch all base recipe templates
exports.getRecipeTemplates = async (req, res) => {
  console.log(`GET /api/recipes/templates - Fetching all base recipe templates.`);
  try {
    const query = `
      SELECT r.recipe_id, r.recipe_name, r.description, r.target_weight, r.target_weight_unit_id,
             r.target_hydration AS "hydrationPercentage", r.target_salt_pct AS "saltPercentage",
             r.is_base_recipe, r.created_at, r.updated_at,
             (SELECT json_agg(rs_agg.* ORDER BY rs_agg.step_order ASC) FROM (
                SELECT rs.recipe_step_id, rs.step_id, s.step_name, s.step_type, s.description AS step_description,
                       s.duration_minutes AS step_default_duration_minutes, rs.step_order, rs.duration_override,
                       rs.notes, rs.target_temperature_celsius, rs.contribution_pct, rs.target_hydration,
                       rs.stretch_fold_interval_minutes,
                       (SELECT json_agg(si_agg.* ORDER BY si_agg.ingredient_id ASC) FROM (
                          SELECT si.ingredient_id, i.ingredient_name, si.bakers_percentage, si.is_wet
                          FROM "StageIngredient" si JOIN "Ingredient" i ON si.ingredient_id = i.ingredient_id
                          WHERE si.recipe_step_id = rs.recipe_step_id
                       ) AS si_agg) AS ingredients_in_step
                FROM "RecipeStep" rs JOIN "Step" s ON rs.step_id = s.step_id
                WHERE rs.recipe_id = r.recipe_id
             ) AS rs_agg) AS steps
      FROM "Recipe" r
      WHERE r.is_base_recipe = TRUE AND r.user_id IS NULL
      ORDER BY r.recipe_name ASC;
    `; // Quoted "Recipe", "RecipeStep", "Step", "StageIngredient", "Ingredient"
    const { rows } = await pool.query(query);
    const templatesResponse = rows.map(recipe => ({
      recipe_id: recipe.recipe_id, recipe_name: recipe.recipe_name, description: recipe.description,
      targetDoughWeight: String(recipe.target_weight), hydrationPercentage: String(recipe.hydrationPercentage),
      saltPercentage: String(recipe.saltPercentage), is_base_recipe: recipe.is_base_recipe,
      created_at: recipe.created_at, updated_at: recipe.updated_at,
      steps: recipe.steps ? recipe.steps.map(step => ({
        ...step, ingredients_in_step: step.ingredients_in_step || []
      })) : []
    }));
    console.log(`   Found ${templatesResponse.length} base recipe templates.`);
    res.json(templatesResponse);
  } catch (error) {
    console.error(`🔴 Error in GET /api/recipes/templates:`, error.stack);
    res.status(500).json({ message: 'Failed to fetch base recipe templates.' });
  }
};

// PUT /api/recipes/:recipeId - Update an existing recipe
exports.updateRecipe = async (req, res) => {
  const loggedInUserId = req.user.userId;
  const { recipeId } = req.params;
  const { recipe_name, description, targetDoughWeight, hydrationPercentage, saltPercentage, steps } = req.body;

  console.log(`PUT /api/recipes/${recipeId} - User ID ${loggedInUserId} attempting update.`);
  if (isNaN(parseInt(recipeId))) {
    return res.status(400).json({ message: "Invalid recipe ID format." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const ownershipResult = await client.query('SELECT user_id, target_weight FROM "Recipe" WHERE recipe_id = $1;', [recipeId]); // Quoted "Recipe"
    if (ownershipResult.rows.length === 0) {
      await client.query("ROLLBACK"); return res.status(404).json({ message: "Recipe not found." });
    }
    if (ownershipResult.rows[0].user_id !== loggedInUserId) {
      await client.query("ROLLBACK"); return res.status(403).json({ message: "Not authorized to update this recipe." });
    }
    let currentRecipeTDW = parseFloat(ownershipResult.rows[0].target_weight);

    const recipeUpdateFields = [];
    const recipeUpdateValues = [];
    let recipeParamCount = 1;

    if (recipe_name !== undefined) { recipeUpdateFields.push(`recipe_name = $${recipeParamCount++}`); recipeUpdateValues.push(recipe_name.trim()); }
    if (description !== undefined) { recipeUpdateFields.push(`description = $${recipeParamCount++}`); recipeUpdateValues.push(description); }
    if (targetDoughWeight !== undefined) { recipeUpdateFields.push(`target_weight = $${recipeParamCount++}`); recipeUpdateValues.push(parseFloat(targetDoughWeight)); currentRecipeTDW = parseFloat(targetDoughWeight); }
    if (hydrationPercentage !== undefined) { recipeUpdateFields.push(`target_hydration = $${recipeParamCount++}`); recipeUpdateValues.push(parseFloat(hydrationPercentage)); }
    if (saltPercentage !== undefined) { recipeUpdateFields.push(`target_salt_pct = $${recipeParamCount++}`); recipeUpdateValues.push(parseFloat(saltPercentage)); }

    if (recipeUpdateFields.length > 0) {
      recipeUpdateFields.push(`updated_at = NOW()`);
      const updateRecipeQuery = `UPDATE "Recipe" SET ${recipeUpdateFields.join(", ")} WHERE recipe_id = $${recipeParamCount} AND user_id = $${recipeParamCount + 1}`; // Quoted "Recipe"
      recipeUpdateValues.push(recipeId, loggedInUserId);
      const updatedRecipeResult = await client.query(updateRecipeQuery, recipeUpdateValues);
      if (updatedRecipeResult.rowCount === 0) throw new Error("Failed to update recipe details or recipe not found for user.");
      console.log(`   Recipe table updated for recipe ID: ${recipeId}`);
    }

    if (steps && Array.isArray(steps)) {
      console.log(`   Replacing steps for recipe ID: ${recipeId}`);
      await client.query('DELETE FROM "StageIngredient" WHERE recipe_step_id IN (SELECT recipe_step_id FROM "RecipeStep" WHERE recipe_id = $1)', [recipeId]); // Quoted
      await client.query('DELETE FROM "RecipeStep" WHERE recipe_id = $1', [recipeId]); // Quoted
      console.log(`   Old RecipeSteps and StageIngredients deleted for recipe ID: ${recipeId}`);

      const LEVAIN_BUILD_STEP_ID = await getLevainBuildStepId(client);
      const { flourIngredientId, waterIngredientId } = await getIngredientIds(client);

      for (const step of steps) {
        if (step.step_id == null || step.step_order == null) throw new Error("Each step must have step_id and step_order.");
        const recipeStepQuery = `
          INSERT INTO "RecipeStep" (recipe_id, step_id, step_order, duration_override, notes, target_temperature_celsius, contribution_pct, target_hydration, stretch_fold_interval_minutes, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()) RETURNING recipe_step_id;
        `; // Quoted "RecipeStep"
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

        if (parseInt(step.step_id, 10) === LEVAIN_BUILD_STEP_ID && step.contribution_pct != null && step.target_hydration != null) {
            const stepContributionPct = parseFloat(step.contribution_pct) / 100;
            const stepTargetHydration = parseFloat(step.target_hydration) / 100;
            const starterWeight = currentRecipeTDW * stepContributionPct;
            const flourInStarter = starterWeight / (1 + stepTargetHydration);
            const waterInStarter = starterWeight - flourInStarter;
            const stageIngredientQuery = `INSERT INTO "StageIngredient" (recipe_step_id, ingredient_id, calculated_weight, is_wet) VALUES ($1, $2, $3, $4);`; // Quoted
            await client.query(stageIngredientQuery, [newRecipeStepId, flourIngredientId, flourInStarter, false]);
            await client.query(stageIngredientQuery, [newRecipeStepId, waterIngredientId, waterInStarter, true]);
        }
      }
    }
    await client.query("COMMIT");
    const finalRecipeQuery = `
        SELECT r.recipe_id, r.recipe_name, r.description, r.target_weight AS "targetDoughWeight", 
               r.target_hydration AS "hydrationPercentage", r.target_salt_pct AS "saltPercentage",
               r.created_at, r.updated_at,
               (SELECT json_agg(rs_agg.* ORDER BY rs_agg.step_order ASC) FROM (
                   SELECT rs.recipe_step_id, rs.step_id, s.step_name, rs.step_order, rs.duration_override, 
                          rs.notes, rs.target_temperature_celsius, rs.contribution_pct, rs.target_hydration, 
                          rs.stretch_fold_interval_minutes
                   FROM "RecipeStep" rs JOIN "Step" s ON rs.step_id = s.step_id
                   WHERE rs.recipe_id = r.recipe_id
               ) AS rs_agg) AS steps
        FROM "Recipe" r WHERE r.recipe_id = $1 AND r.user_id = $2;`; // Quoted
    const finalRecipeResult = await client.query(finalRecipeQuery, [recipeId, loggedInUserId]);
    console.log(`   Recipe ID ${recipeId} updated successfully for user ID ${loggedInUserId}.`);
    res.status(200).json({ message: "Recipe updated successfully!", recipe: finalRecipeResult.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    console.error(`🔴 Error in PUT /api/recipes/${recipeId} for user ID ${loggedInUserId}:`, error.stack);
    res.status(500).json({ message: `Failed to update recipe: ${error.message}` });
  } finally {
    if (client) client.release();
  }
};

// GET /api/recipes/steps - Fetch all predefined step types
exports.getPredefinedSteps = async (req, res) => {
  console.log(`GET /api/recipes/steps - Fetching all predefined step types.`);
  try {
    const query = `SELECT step_id, step_name, description, step_type, duration_minutes AS "defaultDurationMinutes" FROM "Step" WHERE is_predefined = TRUE ORDER BY step_id ASC;`; // Quoted "Step"
    const { rows } = await pool.query(query);
    console.log(`   Found ${rows.length} predefined steps.`);
    res.json(rows);
  } catch (error) {
    console.error(`🔴 Error in GET /api/recipes/steps:`, error.stack);
    res.status(500).json({ message: 'Failed to fetch predefined steps.' });
  }
};

// GET /api/recipes - Fetch all recipes for the authenticated user
exports.getAllUserRecipes = async (req, res) => {
  const loggedInUserId = req.user.userId;
  console.log(`GET /api/recipes - Fetching all recipes for user ID ${loggedInUserId}`);
  try {
    const query = `
      SELECT r.recipe_id, r.recipe_name, r.description, r.target_weight, r.target_weight_unit_id,
             r.target_hydration AS "hydrationPercentage", r.target_salt_pct AS "saltPercentage",
             r.is_base_recipe, r.created_at, r.updated_at,
             (SELECT rs.contribution_pct FROM "RecipeStep" rs JOIN "Step" s ON rs.step_id = s.step_id WHERE rs.recipe_id = r.recipe_id AND s.step_name = 'Levain Build' ORDER BY rs.step_order ASC LIMIT 1) AS "starterPercentage",
             (SELECT rs.target_hydration FROM "RecipeStep" rs JOIN "Step" s ON rs.step_id = s.step_id WHERE rs.recipe_id = r.recipe_id AND s.step_name = 'Levain Build' ORDER BY rs.step_order ASC LIMIT 1) AS "starterHydration"
      FROM "Recipe" r WHERE r.user_id = $1 ORDER BY r.created_at DESC;`; // Quoted "Recipe", "RecipeStep", "Step"
    const { rows } = await pool.query(query, [loggedInUserId]);
    const recipesResponse = rows.map(r => ({
      ...r, targetDoughWeight: String(r.target_weight), hydrationPercentage: String(r.hydrationPercentage),
      saltPercentage: String(r.saltPercentage),
      starterPercentage: r.starterPercentage != null ? String(r.starterPercentage) : null,
      starterHydration: r.starterHydration != null ? String(r.starterHydration) : null,
    }));
    console.log(`   Found ${recipesResponse.length} recipes for user ID: ${loggedInUserId}`);
    res.json(recipesResponse);
  } catch (error) {
    console.error(`🔴 Error in GET /api/recipes for user ID ${loggedInUserId}:`, error.stack);
    res.status(500).json({ message: "Failed to fetch recipes." });
  }
};

// GET /api/recipes/:recipeId - Fetch a specific recipe
exports.getRecipeById = async (req, res) => {
  const loggedInUserId = req.user.userId;
  const { recipeId } = req.params;
  console.log(`GET /api/recipes/${recipeId} - Attempting fetch for user ID ${loggedInUserId} or base recipe.`);

  if (isNaN(parseInt(recipeId))) {
    return res.status(400).json({ message: "Invalid recipe ID format." });
  }

  const client = await pool.connect();
  try {
    let recipeData;
    const userRecipeQuery = `
      SELECT r.recipe_id, r.recipe_name, r.description, r.target_weight, 
             r.target_hydration AS "hydrationPercentage", r.target_salt_pct AS "saltPercentage",
             r.created_at, r.updated_at, r.is_base_recipe
      FROM "Recipe" r WHERE r.recipe_id = $1 AND r.user_id = $2;`; // Quoted "Recipe"
    const userRecipeResult = await client.query(userRecipeQuery, [recipeId, loggedInUserId]);

    if (userRecipeResult.rows.length > 0) {
      recipeData = userRecipeResult.rows[0];
    } else {
      const baseRecipeQuery = `
        SELECT r.recipe_id, r.recipe_name, r.description, r.target_weight, 
               r.target_hydration AS "hydrationPercentage", r.target_salt_pct AS "saltPercentage",
               r.created_at, r.updated_at, r.is_base_recipe
        FROM "Recipe" r WHERE r.recipe_id = $1 AND r.is_base_recipe = TRUE AND r.user_id IS NULL;`; // Quoted "Recipe"
      const baseRecipeResult = await client.query(baseRecipeQuery, [recipeId]);
      if (baseRecipeResult.rows.length > 0) {
        recipeData = baseRecipeResult.rows[0];
      } else {
        return res.status(404).json({ message: "Recipe not found or not authorized." });
      }
    }

    const stepsQuery = `
      SELECT rs.recipe_step_id, rs.step_id, s.step_name, rs.step_order, rs.duration_override, rs.notes, 
             rs.target_temperature_celsius, rs.contribution_pct, rs.target_hydration, rs.stretch_fold_interval_minutes
      FROM "RecipeStep" rs JOIN "Step" s ON rs.step_id = s.step_id
      WHERE rs.recipe_id = $1 ORDER BY rs.step_order ASC;`; // Quoted "RecipeStep", "Step"
    const stepsResult = await client.query(stepsQuery, [recipeId]);

    const recipeResponse = {
      ...recipeData,
      targetDoughWeight: String(recipeData.target_weight),
      hydrationPercentage: String(recipeData.hydrationPercentage),
      saltPercentage: String(recipeData.saltPercentage),
      steps: stepsResult.rows.map(step => ({ ...step })),
    };
    console.log(`   Successfully fetched recipe ID ${recipeId}.`);
    res.json(recipeResponse);
  } catch (error) {
    console.error(`🔴 Error in GET /api/recipes/${recipeId}:`, error.stack);
    res.status(500).json({ message: "Failed to fetch recipe." });
  } finally {
    if (client) client.release();
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
    const ownershipResult = await client.query('SELECT user_id FROM "Recipe" WHERE recipe_id = $1;', [recipeId]); // Quoted "Recipe"
    if (ownershipResult.rows.length === 0) {
      await client.query("ROLLBACK"); return res.status(404).json({ message: "Recipe not found." });
    }
    if (ownershipResult.rows[0].user_id !== loggedInUserId) {
      await client.query("ROLLBACK"); return res.status(403).json({ message: "Not authorized to delete this recipe." });
    }

    await client.query('DELETE FROM "StageIngredient" WHERE recipe_step_id IN (SELECT recipe_step_id FROM "RecipeStep" WHERE recipe_id = $1)', [recipeId]); // Quoted
    await client.query('DELETE FROM "RecipeStep" WHERE recipe_id = $1', [recipeId]); // Quoted
    const deleteResult = await client.query('DELETE FROM "Recipe" WHERE recipe_id = $1 AND user_id = $2 RETURNING recipe_name;', [recipeId, loggedInUserId]); // Quoted

    if (deleteResult.rowCount === 0) {
      await client.query("ROLLBACK"); return res.status(404).json({ message: "Recipe not found or already deleted." });
    }
    await client.query("COMMIT");
    const deletedRecipeName = deleteResult.rows[0].recipe_name;
    console.log(`   Recipe "${deletedRecipeName}" (ID: ${recipeId}) deleted by user ID ${loggedInUserId}.`);
    res.status(200).json({ message: `Recipe "${deletedRecipeName}" deleted successfully.` });
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    console.error(`🔴 Error in DELETE /api/recipes/${recipeId} for user ID ${loggedInUserId}:`, error.stack);
    res.status(500).json({ message: "Failed to delete recipe." });
  } finally {
    if (client) client.release();
  }
};