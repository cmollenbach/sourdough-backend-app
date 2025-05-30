// controllers/bakeController.js
const pool = require('../config/db');

// POST /api/bakes/start - Initiates a new guided baking session
exports.startBake = async (req, res) => {
  const dbUserId = req.user.userId;
  const { recipeId } = req.body;

  console.log(`User ID ${dbUserId} starting bake for Recipe ID ${recipeId}`);
  if (!recipeId || isNaN(parseInt(recipeId))) {
    return res.status(400).json({ message: "Valid Recipe ID is required." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const recipeCheckQuery = `
      SELECT r.recipe_id, r.recipe_name, 
             rs.recipe_step_id AS "first_recipe_step_id",
             rs.step_id AS "first_step_id", 
             s_step.step_name AS "first_step_name",
             rs.step_order AS "first_step_order", 
             COALESCE(rs.duration_override, s_step.duration_minutes) AS "first_step_planned_duration",
             rs.duration_override AS "first_step_actual_duration_override",
             rs.notes AS "first_step_notes", 
             rs.target_temperature_celsius AS "first_step_temp",
             rs.stretch_fold_interval_minutes AS "first_stretch_fold_interval"
      FROM "Recipe" r
      LEFT JOIN "RecipeStep" rs ON r.recipe_id = rs.recipe_id AND rs.step_order = (
          SELECT MIN(inner_rs.step_order) 
          FROM "RecipeStep" inner_rs 
          WHERE inner_rs.recipe_id = r.recipe_id
      )
      LEFT JOIN "Step" s_step ON rs.step_id = s_step.step_id
      WHERE r.recipe_id = $1 AND (r.user_id = $2 OR r.is_base_recipe = TRUE OR r.user_id IS NULL);`;
    const recipeCheckResult = await client.query(recipeCheckQuery, [recipeId, dbUserId]);

    if (recipeCheckResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Recipe not found or not accessible." });
    }
    const recipeDetails = recipeCheckResult.rows[0];
    if (!recipeDetails.first_recipe_step_id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Recipe has no steps." });
    }

    const bakeLogQuery = `INSERT INTO "UserBakeLog" (user_id, recipe_id, status, bake_start_timestamp) VALUES ($1, $2, 'active', NOW()) RETURNING bake_log_id, bake_start_timestamp;`; // bake_start_timestamp explicitly set
    const bakeLogResult = await client.query(bakeLogQuery, [dbUserId, recipeId]);
    const { bake_log_id: newBakeLogIdFromLog, bake_start_timestamp: bakeStartTime } = bakeLogResult.rows[0];

    const bakeStepLogQuery = `
      INSERT INTO "UserBakeStepLog" (bake_log_id, recipe_step_id, step_order, step_name, planned_duration_minutes, actual_start_timestamp) 
      VALUES ($1, $2, $3, $4, $5, NOW()) 
      RETURNING bake_step_log_id, actual_start_timestamp;`;
    const bakeStepLogResult = await client.query(bakeStepLogQuery, [
        newBakeLogIdFromLog, 
        recipeDetails.first_recipe_step_id, 
        recipeDetails.first_step_order, 
        recipeDetails.first_step_name, 
        recipeDetails.first_step_planned_duration
    ]);
    const { bake_step_log_id: newBakeStepLogId, actual_start_timestamp: firstStepStartTime } = bakeStepLogResult.rows[0];

    await client.query("COMMIT");
    console.log(`   Bake Log ID ${newBakeLogIdFromLog} started for recipe "${recipeDetails.recipe_name}". First step log ID ${newBakeStepLogId}`);
    
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
        target_temperature_celsius: recipeDetails.first_step_temp,
        actual_start_timestamp: firstStepStartTime,
        stretch_fold_interval_minutes: recipeDetails.first_stretch_fold_interval,
      },
      bakeStartTimestamp: bakeStartTime, // This is the UserBakeLog.bake_start_timestamp
      recipeName: recipeDetails.recipe_name,
      status: 'active'
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    console.error(`閥 Error POST /api/bakes/start UserID ${dbUserId}, RecipeID ${recipeId}:`, error.stack);
    res.status(500).json({ message: "Server error starting bake." });
  } finally {
    if (client) client.release();
  }
};

exports.completeBakeStep = async (req, res) => {
  const dbUserId = req.user.userId;
  const { bakeLogId } = req.params;
  const { currentBakeStepLogId, userNotesForCompletedStep } = req.body;

  console.log(`Complete step for BakeLogID ${bakeLogId}, StepLogID ${currentBakeStepLogId}, UserID ${dbUserId}`);
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
      await client.query("ROLLBACK"); return res.status(404).json({ message: "Active bake or step log not found."});
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
    console.log(`   Step Log ID ${currentBakeStepLogId} marked complete.`);

    const nextStepQuery = `
      SELECT rs.recipe_step_id, rs.step_id, s.step_name, rs.step_order, 
             COALESCE(rs.duration_override, s.duration_minutes) AS "planned_duration_minutes", 
             rs.duration_override, 
             rs.notes, s.description AS "step_general_description", 
             rs.target_temperature_celsius, rs.stretch_fold_interval_minutes
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
      console.log(`   Next Step Log ID ${newNextBakeStepLogId} initiated.`);
      
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
        actual_start_timestamp: nextStepStartTime,
        user_step_notes: null 
      };

      res.status(200).json({ 
          message: "Step completed, next initiated.",
          currentStepDetails: newCurrentStepDataForFrontend 
      });
    } else {
      await client.query(`UPDATE "UserBakeLog" SET status = 'completed', bake_end_timestamp = NOW(), updated_at = NOW() WHERE bake_log_id = $1 AND user_id = $2;`, [bakeLogId, dbUserId]);
      await client.query("COMMIT");
      console.log(`   Bake Log ID ${bakeLogId} marked completed.`);
      res.status(200).json({ message: "Final step completed. Bake finished!", bakeLogId });
    }
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    console.error(`閥 Error POST /api/bakes/.../complete for BakeLogID ${bakeLogId}:`, error.stack);
    res.status(500).json({ message: "Server error completing step." });
  } finally {
    if (client) client.release();
  }
};

exports.updateBakeStatus = async (req, res) => {
  const dbUserId = req.user.userId;
  const { bakeLogId } = req.params;
  const { status } = req.body;

  console.log(`Update BakeLogID ${bakeLogId} status to ${status} for UserID ${dbUserId}`);
  if (isNaN(parseInt(bakeLogId))) return res.status(400).json({ message: "Valid bakeLogId required." });
  const validStatuses = ['active', 'paused', 'abandoned', 'completed']; // Added 'completed'
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

exports.getActiveBakes = async (req, res) => {
  const dbUserId = req.user.userId;
  console.log(`GET /api/bakes/active - User ID ${dbUserId} fetching active bakes.`);
  try {
    const query = `
      SELECT ubl.bake_log_id, ubl.recipe_id, r.recipe_name, 
             ubl.bake_start_timestamp, ubl.status, -- This is the key timestamp
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
                  'target_temperature_celsius', rs.target_temperature_celsius,
                  'stretch_fold_interval_minutes', rs.stretch_fold_interval_minutes
              ) FROM "UserBakeStepLog" ubsl
                JOIN "RecipeStep" rs ON ubsl.recipe_step_id = rs.recipe_step_id
                JOIN "Step" s ON rs.step_id = s.step_id
                WHERE ubsl.bake_log_id = ubl.bake_log_id AND ubsl.actual_end_timestamp IS NULL 
                ORDER BY ubsl.step_order ASC LIMIT 1
             ) AS "currentStepDetails"
      FROM "UserBakeLog" ubl 
      JOIN "Recipe" r ON ubl.recipe_id = r.recipe_id
      WHERE ubl.user_id = $1 AND (ubl.status = 'active' OR ubl.status = 'paused') -- MODIFIED HERE
      ORDER BY ubl.bake_start_timestamp DESC;`;

    const { rows } = await pool.query(query, [dbUserId]);
    
    // Ensure the field names sent to frontend match what it expects, e.g., bakeLogId if that's used
    const activeBakes = rows.map(bake => ({
        bakeLogId: bake.bake_log_id, // ensure frontend consistency
        recipeId: bake.recipe_id,
        recipeName: bake.recipe_name,
        bake_start_timestamp: bake.bake_start_timestamp, // Ensure this is passed through
        status: bake.status,
        currentStepDetails: bake.currentStepDetails
    }));

    console.log(`   Found ${activeBakes.length} active/paused bake(s) for User ID ${dbUserId}.`);
    res.status(200).json({ activeBakes }); // Return the mapped array

  } catch (error) {
    console.error(`閥 Error GET /api/bakes/active for UserID ${dbUserId}:`, error.stack);
    res.status(500).json({ message: "Server error fetching active bakes." });
  }
};

exports.getBakeLogDetailsById = async (req, res) => {
  const dbUserId = req.user.userId;
  const { bakeLogId } = req.params;

  console.log(`GET /api/bakes/${bakeLogId} - User ID ${dbUserId} fetching details.`);
  if (isNaN(parseInt(bakeLogId))) {
    return res.status(400).json({ message: "Valid Bake Log ID is required." });
  }

  try {
    const query = `
      SELECT 
        ubl.bake_log_id AS "bakeLogId", 
        ubl.recipe_id, 
        r.recipe_name AS "recipeName",
        ubl.bake_start_timestamp AS "bakeStartTimestamp", -- This is the overall bake start time
        ubl.status,
        ubl.bake_end_timestamp AS "bakeEndTimestamp",
        ubl.user_overall_notes AS "userOverallNotes",
        (SELECT json_build_object(
            'bake_step_log_id', ubsl.bake_step_log_id, 
            'recipe_step_id', ubsl.recipe_step_id,
            'step_id', rs.step_id,                           
            'step_order', ubsl.step_order, 
            'step_name', ubsl.step_name,
            'planned_duration_minutes', ubsl.planned_duration_minutes, 
            'duration_override', rs.duration_override,                 
            'actual_start_timestamp', ubsl.actual_start_timestamp,
            'user_step_notes', ubsl.user_step_notes,
            'notes', rs.notes,                                       
            'description', s.description,                           
            'target_temperature_celsius', rs.target_temperature_celsius,
            'stretch_fold_interval_minutes', rs.stretch_fold_interval_minutes
          ) 
         FROM "UserBakeStepLog" ubsl
         JOIN "RecipeStep" rs ON ubsl.recipe_step_id = rs.recipe_step_id
         JOIN "Step" s ON rs.step_id = s.step_id
         WHERE ubsl.bake_log_id = $1 AND ubsl.actual_end_timestamp IS NULL
         ORDER BY ubsl.step_order ASC LIMIT 1
        ) AS "currentStepDetails",
        (SELECT json_agg(
            json_build_object(
              'bake_step_log_id', hist_ubsl.bake_step_log_id,
              'recipe_step_id', hist_ubsl.recipe_step_id, 
              'step_name', hist_ubsl.step_name,
              'step_order', hist_ubsl.step_order,
              'planned_duration_minutes', hist_ubsl.planned_duration_minutes, 
              'actual_start_timestamp', hist_ubsl.actual_start_timestamp,
              'actual_end_timestamp', hist_ubsl.actual_end_timestamp,
              'user_step_notes', hist_ubsl.user_step_notes
            ) ORDER BY hist_ubsl.step_order ASC
          )
         FROM "UserBakeStepLog" hist_ubsl
         WHERE hist_ubsl.bake_log_id = $1
        ) AS "historyStepDetails"
      FROM "UserBakeLog" ubl
      JOIN "Recipe" r ON ubl.recipe_id = r.recipe_id
      WHERE ubl.bake_log_id = $1 AND ubl.user_id = $2;
    `;
    
    const { rows } = await pool.query(query, [bakeLogId, dbUserId]);

    if (rows.length === 0) {
      console.log(`   Bake Log ID ${bakeLogId} not found for User ID ${dbUserId}.`);
      return res.status(404).json({ message: "Bake log not found or not authorized." });
    }

    const bakeLogDetail = rows[0];
    if (bakeLogDetail.currentStepDetails && bakeLogDetail.currentStepDetails.bake_step_log_id === null) {
        bakeLogDetail.currentStepDetails = null;
    }
    // The bakeStartTimestamp is already included from the main query
    console.log(`   Successfully fetched details for Bake Log ID ${bakeLogId}.`);
    res.status(200).json(bakeLogDetail);

  } catch (error) {
    console.error(`閥 Error GET /api/bakes/${bakeLogId} for UserID ${dbUserId}:`, error.stack);
    res.status(500).json({ message: "Server error fetching bake log details." });
  }
};