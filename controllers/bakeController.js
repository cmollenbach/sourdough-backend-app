// controllers/bakeController.js
const pool = require('../config/db');
const { getFullRecipeDetails } = require('./recipeController');

// POST /api/bakes/start - Initiates a new guided baking session
exports.startBake = async (req, res, next) => {
    try {
        const dbUserId = req.user.userId;
        const { recipeId } = req.body;

        // 1. Create a new bake log
        const insertBakeLogResult = await pool.query(
            `INSERT INTO "UserBakeLog" (user_id, recipe_id, status, bake_start_timestamp) VALUES ($1, $2, 'active', NOW()) RETURNING bake_log_id, bake_start_timestamp;`,
            [dbUserId, recipeId]
        );
        const newBakeLogIdFromLog = insertBakeLogResult.rows[0].bake_log_id;
        const bakeStartTime = insertBakeLogResult.rows[0].bake_start_timestamp;

        // 2. Get the first step for this recipe
        const recipeQuery = `
          SELECT r.recipe_id, r.recipe_name,
                 first_step.recipe_step_id AS "first_recipe_step_id",
                 first_step.step_id AS "first_step_id",
                 s_step.step_name AS "first_step_name",
                 s_step.is_advanced AS "first_step_is_advanced",
                 first_step.step_order AS "first_step_order",
                 COALESCE(first_step.duration_override, s_step.duration_minutes) AS "first_step_planned_duration",
                 first_step.duration_override AS "first_step_actual_duration_override",
                 first_step.notes AS "first_step_notes",
                 s_step.description AS "first_step_general_description",
                 first_step.target_temperature_celsius AS "first_step_temp",
                 first_step.stretch_fold_interval_minutes AS "first_stretch_fold_interval",
                 first_step.number_of_sf_sets AS "first_number_of_sf_sets", 
                 (SELECT json_agg(si_agg.* ORDER BY si_agg.stage_ingredient_id ASC) FROM (
                    SELECT si.stage_ingredient_id, si.ingredient_id, i.ingredient_name, si.percentage, si.is_wet, si.calculated_weight, i.is_advanced
                    FROM "StageIngredient" si
                    JOIN "Ingredient" i ON si.ingredient_id = i.ingredient_id
                    WHERE si.recipe_step_id = first_step.recipe_step_id
                 ) AS si_agg
                ) AS "first_stage_ingredients"
          FROM "Recipe" r
          LEFT JOIN "RecipeStep" first_step ON r.recipe_id = first_step.recipe_id AND first_step.step_order = (
              SELECT MIN(inner_rs.step_order)
              FROM "RecipeStep" inner_rs
              WHERE inner_rs.recipe_id = r.recipe_id
          )
          LEFT JOIN "Step" s_step ON first_step.step_id = s_step.step_id
          WHERE r.recipe_id = $1 AND (r.user_id = $2 OR r.is_base_recipe = TRUE OR r.user_id IS NULL);`;

        const recipeResult = await pool.query(recipeQuery, [recipeId, dbUserId]);
        if (!recipeResult.rows.length) {
            return res.status(404).json({ message: "Recipe not found or not accessible." });
        }
        const recipeDetails = recipeResult.rows[0];

        // 3. Create the first bake step log
        const insertStepLogResult = await pool.query(
            `INSERT INTO "UserBakeStepLog" (bake_log_id, recipe_step_id, step_order, step_name, planned_duration_minutes, actual_start_timestamp)
             VALUES ($1, $2, $3, $4, $5, NOW())
             RETURNING bake_step_log_id, actual_start_timestamp;`,
            [
                newBakeLogIdFromLog,
                recipeDetails.first_recipe_step_id,
                recipeDetails.first_step_order,
                recipeDetails.first_step_name,
                recipeDetails.first_step_planned_duration
            ]
        );
        const newBakeStepLogId = insertStepLogResult.rows[0].bake_step_log_id;
        const firstStepStartTime = insertStepLogResult.rows[0].actual_start_timestamp;

        res.status(201).json({
            message: "Bake session started.",
            bakeLogId: newBakeLogIdFromLog,
            currentBakeStepLogId: newBakeStepLogId,
            firstStepDetails: {
                bake_step_log_id: newBakeStepLogId,
                recipe_step_id: recipeDetails.first_recipe_step_id,
                step_id: recipeDetails.first_step_id,
                step_name: recipeDetails.first_step_name,
                step_order: recipeDetails.first_step_order,
                planned_duration_minutes: recipeDetails.first_step_planned_duration,
                duration_override: recipeDetails.first_step_actual_duration_override,
                notes: recipeDetails.first_step_notes,
                description: recipeDetails.first_step_general_description,
                target_temperature_celsius: recipeDetails.first_step_temp,
                stretch_fold_interval_minutes: recipeDetails.first_stretch_fold_interval,
                number_of_sf_sets: recipeDetails.first_number_of_sf_sets,
                is_advanced: recipeDetails.first_step_is_advanced, 
                stageIngredients: (recipeDetails.first_stage_ingredients || []).map(si => ({
                  ...si,
                  is_advanced: si.is_advanced 
                })),
                actual_start_timestamp: firstStepStartTime,
                user_step_notes: null
            },
            bakeStartTimestamp: bakeStartTime,
            recipeName: recipeDetails.recipe_name,
            status: 'active'
        });
    } catch (err) {
        next(err);
    }
};

exports.completeBakeStep = async (req, res) => {
  const dbUserId = req.user.userId;
  const { bakeLogId } = req.params;
  const { currentBakeStepLogId, userNotesForCompletedStep } = req.body;

  console.log(`Complete step for BakeLogID ${bakeLogId}, UserBakeStepLogID ${currentBakeStepLogId}, UserID ${dbUserId}`);
  if (isNaN(parseInt(bakeLogId)) || !currentBakeStepLogId || isNaN(parseInt(currentBakeStepLogId))) {
    return res.status(400).json({ message: "Valid bakeLogId and currentBakeStepLogId required." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const bakeLogCheckQuery = `
        SELECT ubl.recipe_id, ubsl.step_order AS "completed_step_order", ubl.status
        FROM "UserBakeLog" ubl
        JOIN "UserBakeStepLog" ubsl ON ubl.bake_log_id = ubsl.bake_log_id
        WHERE ubl.bake_log_id = $1 AND ubl.user_id = $2 AND ubsl.bake_step_log_id = $3;`;
    const bakeLogCheckResult = await client.query(bakeLogCheckQuery, [bakeLogId, dbUserId, currentBakeStepLogId]);

    if (bakeLogCheckResult.rows.length === 0) {
      await client.query("ROLLBACK"); return res.status(404).json({ message: "Active bake or step log not found for current user."});
    }
    const { recipe_id, completed_step_order, status } = bakeLogCheckResult.rows[0];
    if (status !== 'active') {
      await client.query("ROLLBACK"); return res.status(400).json({ message: `Cannot complete step: bake status is '${status}'.`});
    }

    const updateStepLogQuery = `UPDATE "UserBakeStepLog" SET actual_end_timestamp = NOW(), user_step_notes = $1, updated_at = NOW() WHERE bake_step_log_id = $2 AND bake_log_id = $3 AND actual_end_timestamp IS NULL RETURNING actual_end_timestamp;`;
    const updatedStepResult = await client.query(updateStepLogQuery, [userNotesForCompletedStep || null, currentBakeStepLogId, bakeLogId]);
    if (updatedStepResult.rowCount === 0) {
      await client.query("ROLLBACK"); return res.status(409).json({ message: "Step already completed or not found." });
    }
    console.log(`   UserBakeStepLog ID ${currentBakeStepLogId} marked complete.`);

    // Fetch next RecipeStep details, including its stage ingredients
    const nextStepQuery = `
      SELECT rs.recipe_step_id, rs.step_id, s.step_name, s.is_advanced AS step_is_advanced, rs.step_order,
             COALESCE(rs.duration_override, s.duration_minutes) AS "planned_duration_minutes",
             rs.duration_override, rs.notes, s.description AS "step_general_description",
             rs.target_temperature_celsius, rs.stretch_fold_interval_minutes,
             rs.number_of_sf_sets, 
             (SELECT json_agg(si_agg.* ORDER BY si_agg.stage_ingredient_id ASC) FROM (
                SELECT si.stage_ingredient_id, si.ingredient_id, i.ingredient_name, si.percentage, si.is_wet, si.calculated_weight, i.is_advanced
FROM "StageIngredient" si
JOIN "Ingredient" i ON si.ingredient_id = i.ingredient_id
WHERE si.recipe_step_id = rs.recipe_step_id
             ) AS si_agg
            ) AS "stageIngredients"
      FROM "RecipeStep" rs JOIN "Step" s ON rs.step_id = s.step_id
      WHERE rs.recipe_id = $1 AND rs.step_order > $2 ORDER BY rs.step_order ASC LIMIT 1;`;
    const nextStepResult = await client.query(nextStepQuery, [recipe_id, completed_step_order]);

    if (nextStepResult.rows.length > 0) {
      const nextStepRecipeData = nextStepResult.rows[0];
      const insertNextLogQuery = `
        INSERT INTO "UserBakeStepLog" (bake_log_id, recipe_step_id, step_order, step_name, planned_duration_minutes, actual_start_timestamp)
        VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING bake_step_log_id, actual_start_timestamp;`;
      const nextLogResult = await client.query(insertNextLogQuery, [
          bakeLogId,
          nextStepRecipeData.recipe_step_id,
          nextStepRecipeData.step_order,
          nextStepRecipeData.step_name,
          nextStepRecipeData.planned_duration_minutes
      ]);
      const { bake_step_log_id: newNextBakeStepLogId, actual_start_timestamp: nextStepStartTime } = nextLogResult.rows[0];

      await client.query("COMMIT");
      console.log(`   Next UserBakeStepLog ID ${newNextBakeStepLogId} initiated.`);

      const newCurrentStepDataForFrontend = {
        bake_step_log_id: newNextBakeStepLogId,
        recipe_step_id: nextStepRecipeData.recipe_step_id,
        step_id: nextStepRecipeData.step_id,
        step_name: nextStepRecipeData.step_name,
        step_order: nextStepRecipeData.step_order,
        planned_duration_minutes: nextStepRecipeData.planned_duration_minutes,
        duration_override: nextStepRecipeData.duration_override,
        notes: nextStepRecipeData.notes,
        description: nextStepRecipeData.step_general_description,
        target_temperature_celsius: nextStepRecipeData.target_temperature_celsius,
        stretch_fold_interval_minutes: nextStepRecipeData.stretch_fold_interval_minutes,
        number_of_sf_sets: nextStepRecipeData.number_of_sf_sets,
        is_advanced: nextStepRecipeData.step_is_advanced, 
        stageIngredients: (nextStepRecipeData.stageIngredients || []).map(si => ({
          ...si,
          is_advanced: si.is_advanced 
        })),
        actual_start_timestamp: nextStepStartTime,
        user_step_notes: null
      };

      res.status(200).json({
          message: "Step completed, next initiated.",
          currentStepDetails: newCurrentStepDataForFrontend
      });
    } else {
      // No next step, bake is finished
      await client.query(`UPDATE "UserBakeLog" SET status = 'completed', bake_end_timestamp = NOW(), updated_at = NOW() WHERE bake_log_id = $1 AND user_id = $2;`, [bakeLogId, dbUserId]);
      await client.query("COMMIT");
      console.log(`   Bake Log ID ${bakeLogId} marked completed (all steps done).`);
      res.status(200).json({ message: "Final step completed. Bake finished!", bakeLogId, currentStepDetails: null }); // Send null for currentStepDetails
    }
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    console.error(`閥 Error POST /api/bakes/.../complete for BakeLogID ${bakeLogId}:`, error.stack);
    res.status(500).json({ message: "Server error completing step." });
  } finally {
    if (client) client.release();
  }
};

// updateBakeStatus remains the same as your provided version
exports.updateBakeStatus = async (req, res) => {
  const dbUserId = req.user.userId;
  const { bakeLogId } = req.params;
  const { status } = req.body;

  console.log(`Update BakeLogID ${bakeLogId} status to ${status} for UserID ${dbUserId}`);
  if (isNaN(parseInt(bakeLogId))) return res.status(400).json({ message: "Valid bakeLogId required." });
  const validStatuses = ['active', 'paused', 'abandoned', 'completed'];
  if (!status || !validStatuses.includes(status)) return res.status(400).json({ message: `Invalid status. Use: ${validStatuses.join(', ')}` });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let setClauses = ["status = $1", "updated_at = NOW()"];
    const queryParams = [status];
    let paramIndex = 2;

    if (status === 'abandoned' || status === 'completed') {
        setClauses.push(`bake_end_timestamp = NOW()`);
    } else if (status === 'active' || status === 'paused') {
        setClauses.push(`bake_end_timestamp = NULL`);
    }

    queryParams.push(bakeLogId, dbUserId);

    const updateQuery = `UPDATE "UserBakeLog" SET ${setClauses.join(', ')} WHERE bake_log_id = $${paramIndex++} AND user_id = $${paramIndex++} RETURNING status, bake_end_timestamp;`;
    const result = await client.query(updateQuery, queryParams);

    if (result.rowCount === 0) {
      await client.query("ROLLBACK"); return res.status(404).json({ message: "Bake session not found or not authorized to update." });
    }
    await client.query("COMMIT");
    console.log(`   Bake Log ID ${bakeLogId} status updated to ${result.rows[0].status}.`);
    res.status(200).json({ message: "Bake status updated.", newStatus: result.rows[0].status, bakeEndTimestamp: result.rows[0].bake_end_timestamp });
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    console.error(`閥 Error PUT /api/bakes/.../status for BakeLogID ${bakeLogId}:`, error.stack);
    res.status(500).json({ message: "Server error updating status." });
  } finally {
    if (client) client.release();
  }
};

// getActiveBakes needs to ensure it also fetches stageIngredients for the current step
exports.getActiveBakes = async (req, res) => {
  const dbUserId = req.user.userId;
  console.log(`GET /api/bakes/active - User ID ${dbUserId} fetching active bakes.`);
  try {
    const query = `
      SELECT ubl.bake_log_id, ubl.recipe_id, r.recipe_name,
             ubl.bake_start_timestamp, ubl.status,
             (SELECT json_build_object(
                  'bake_step_log_id', ubsl.bake_step_log_id,
                  'recipe_step_id', ubsl.recipe_step_id,
                  'step_id', rs.step_id,
                  'step_order', ubsl.step_order,
                  'step_name', ubsl.step_name,
                  'planned_duration_minutes', ubsl.planned_duration_minutes,
                  'duration_override', rs.duration_override,
                  'actual_start_timestamp', ubsl.actual_start_timestamp,
                  'notes', rs.notes,
                  'description', s.description,
                  'is_advanced', s.is_advanced, 
                  'target_temperature_celsius', rs.target_temperature_celsius,
                  'stretch_fold_interval_minutes', rs.stretch_fold_interval_minutes,
                  'number_of_sf_sets', rs.number_of_sf_sets, 
                  'stageIngredients', (SELECT json_agg(si_agg.* ORDER BY si_agg.stage_ingredient_id ASC) FROM (
                                        SELECT si.stage_ingredient_id, si.ingredient_id, i.ingredient_name, si.percentage, si.is_wet, si.calculated_weight, i.is_advanced
                                        FROM "StageIngredient" si
                                        JOIN "Ingredient" i ON si.ingredient_id = i.ingredient_id
                                        WHERE si.recipe_step_id = rs.recipe_step_id
                                     ) AS si_agg
                                    ),
                  'timing_relation_type', rs.timing_relation_type 
              ) FROM "UserBakeStepLog" ubsl
                JOIN "RecipeStep" rs ON ubsl.recipe_step_id = rs.recipe_step_id
                JOIN "Step" s ON rs.step_id = s.step_id
                WHERE ubsl.bake_log_id = ubl.bake_log_id AND ubsl.actual_end_timestamp IS NULL
                ORDER BY ubsl.step_order ASC LIMIT 1
             ) AS "currentStepDetails"
      FROM "UserBakeLog" ubl
      JOIN "Recipe" r ON ubl.recipe_id = r.recipe_id
      WHERE ubl.user_id = $1 AND (ubl.status = 'active' OR ubl.status = 'paused')
      ORDER BY ubl.bake_start_timestamp DESC;`;

    const { rows } = await pool.query(query, [dbUserId]);

    const activeBakes = rows.map(bake => ({
        bakeLogId: bake.bake_log_id,
        recipeId: bake.recipe_id,
        recipeName: bake.recipe_name,
        bake_start_timestamp: bake.bake_start_timestamp,
        status: bake.status,
        currentStepDetails: bake.currentStepDetails ? {
            ...bake.currentStepDetails,
            stageIngredients: bake.currentStepDetails.stageIngredients || []
        } : null
    }));

    console.log(`   Found ${activeBakes.length} active/paused bake(s) for User ID ${dbUserId}.`);
    res.status(200).json({ activeBakes });

  } catch (error) {
    console.error(`閥 Error GET /api/bakes/active for UserID ${dbUserId}:`, error.stack);
    res.status(500).json({ message: "Server error fetching active bakes." });
  }
};

exports.getBakeHistory = async (req, res) => {
  const dbUserId = req.user.userId;
  try {
    const query = `
      SELECT 
        ubl.bake_log_id, ubl.recipe_id, r.recipe_name,
        ubl.bake_start_timestamp, ubl.bake_end_timestamp,
        ubl.status, ubl.user_overall_notes
      FROM "UserBakeLog" ubl
      JOIN "Recipe" r ON ubl.recipe_id = r.recipe_id
      WHERE ubl.user_id = $1
      ORDER BY ubl.bake_start_timestamp DESC
    `;
    const { rows } = await pool.query(query, [dbUserId]);
    res.json({ bakes: rows });
  } catch (error) {
    console.error("Error fetching bake history:", error);
    res.status(500).json({ message: "Server error fetching bake history." });
  }
};


exports.getBakeLogDetailsById = async (req, res) => {
  const dbUserId = req.user.userId;
  const { bakeLogId } = req.params;

  const query = `
    SELECT 
      ubl.bake_log_id, ubl.recipe_id, ubl.status, ubl.user_overall_notes, r.recipe_name,
      (SELECT json_build_object(
          'bake_step_log_id', ubsl.bake_step_log_id,
          'recipe_step_id', ubsl.recipe_step_id,
          'step_id', rs.step_id,
          'step_order', ubsl.step_order,
          'step_name', ubsl.step_name,
          'planned_duration_minutes', ubsl.planned_duration_minutes,
          'duration_override', rs.duration_override,
          'actual_start_timestamp', ubsl.actual_start_timestamp,
          'notes', rs.notes,
          'description', s.description,
          'is_advanced', s.is_advanced, 
          'target_temperature_celsius', rs.target_temperature_celsius,
          'stretch_fold_interval_minutes', rs.stretch_fold_interval_minutes,
          'number_of_sf_sets', rs.number_of_sf_sets, 
          'stageIngredients', (SELECT json_agg(si_agg.* ORDER BY si_agg.stage_ingredient_id ASC) FROM (
                                SELECT si.stage_ingredient_id, si.ingredient_id, i.ingredient_name, si.percentage, si.is_wet, si.calculated_weight, i.is_advanced
                                FROM "StageIngredient" si
                                JOIN "Ingredient" i ON si.ingredient_id = i.ingredient_id
                                WHERE si.recipe_step_id = rs.recipe_step_id
                             ) AS si_agg
                            ),
          'timing_relation_type', rs.timing_relation_type 
      ) FROM "UserBakeStepLog" ubsl
        JOIN "RecipeStep" rs ON ubsl.recipe_step_id = rs.recipe_step_id
        JOIN "Step" s ON rs.step_id = s.step_id
        WHERE ubsl.bake_log_id = ubl.bake_log_id AND ubsl.actual_end_timestamp IS NULL
        ORDER BY ubsl.step_order ASC LIMIT 1
      ) AS "currentStepDetails"
    FROM "UserBakeLog" ubl
    JOIN "Recipe" r ON ubl.recipe_id = r.recipe_id
    WHERE ubl.bake_log_id = $1 AND ubl.user_id = $2
    LIMIT 1;
  `;

  try {
    const { rows } = await pool.query(query, [bakeLogId, dbUserId]);
    if (!rows.length) {
      return res.status(404).json({ message: "Bake log not found." });
    }
    const row = rows[0];

    // Always attach the full recipe for frontend calculations
    const client = await pool.connect();
    try {
      const fullRecipe = await getFullRecipeDetails(client, row.recipe_id, dbUserId);
      row.recipe = fullRecipe;
    } finally {
      client.release();
    }

    // If there is no current step, explicitly set currentStepDetails to null
    if (!row.currentstepdetails && !row.currentStepDetails) {
      row.currentStepDetails = null;
    } else if (row.currentstepdetails) {
      row.currentStepDetails = row.currentstepdetails;
      delete row.currentstepdetails;
    }

    res.json(row);
  } catch (error) {
    console.error("Error fetching bake log details:", error);
    res.status(500).json({ message: "Server error fetching bake log details." });
  }
};