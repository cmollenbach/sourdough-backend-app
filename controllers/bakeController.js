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
      SELECT r.recipe_id, r.recipe_name, rs.recipe_step_id AS first_recipe_step_id,
             rs.step_id AS first_step_id, s_step.step_name AS first_step_name,
             rs.step_order AS first_step_order, rs.duration_override AS first_step_duration,
             rs.notes AS first_step_notes, rs.target_temperature_celsius AS first_step_temp,
             rs.stretch_fold_interval_minutes AS first_stretch_fold_interval
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

    const bakeLogQuery = `INSERT INTO "UserBakeLog" (user_id, recipe_id, status) VALUES ($1, $2, 'active') RETURNING bake_log_id, bake_start_timestamp;`;
    const bakeLogResult = await client.query(bakeLogQuery, [dbUserId, recipeId]);
    const { bake_log_id: newBakeLogIdFromLog, bake_start_timestamp: bakeStartTime } = bakeLogResult.rows[0]; // Renamed to avoid conflict

    const bakeStepLogQuery = `INSERT INTO "UserBakeStepLog" (bake_log_id, recipe_step_id, step_order, step_name, planned_duration_minutes, actual_start_timestamp) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING bake_step_log_id, actual_start_timestamp;`;
    const bakeStepLogResult = await client.query(bakeStepLogQuery, [newBakeLogIdFromLog, recipeDetails.first_recipe_step_id, recipeDetails.first_step_order, recipeDetails.first_step_name, recipeDetails.first_step_duration]);
    const { bake_step_log_id: newBakeStepLogId, actual_start_timestamp: firstStepStartTime } = bakeStepLogResult.rows[0];

    await client.query("COMMIT");
    console.log(`   Bake Log ID ${newBakeLogIdFromLog} started for recipe "${recipeDetails.recipe_name}". First step log ID ${newBakeStepLogId}`);
    res.status(201).json({
      message: "Bake session started.",
      bakeLogId: newBakeLogIdFromLog, // Use ID from UserBakeLog
      currentBakeStepLogId: newBakeStepLogId, // Use ID from UserBakeStepLog
      firstStepDetails: {
        bake_step_log_id: newBakeStepLogId, // Add this for consistency
        recipe_step_id: recipeDetails.first_recipe_step_id,
        step_id: recipeDetails.first_step_id,
        step_name: recipeDetails.first_step_name,
        step_order: recipeDetails.first_step_order,
        planned_duration_minutes: recipeDetails.first_step_duration,
        notes: recipeDetails.first_step_notes,
        target_temperature_celsius: recipeDetails.first_step_temp,
        actual_start_timestamp: firstStepStartTime,
        stretch_fold_interval_minutes: recipeDetails.first_stretch_fold_interval,
      },
      bakeStartTimestamp: bakeStartTime,
      recipeName: recipeDetails.recipe_name,
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    console.error(`🔴 Error POST /api/bakes/start UserID ${dbUserId}, RecipeID ${recipeId}:`, error.stack);
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
    const bakeLogCheckQuery = `SELECT ubl.recipe_id, ubsl.step_order AS completed_step_order, ubl.status FROM "UserBakeLog" ubl JOIN "UserBakeStepLog" ubsl ON ubl.bake_log_id = ubsl.bake_log_id WHERE ubl.bake_log_id = $1 AND ubl.user_id = $2 AND ubsl.bake_step_log_id = $3;`;
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
      SELECT rs.recipe_step_id, rs.step_id, s.step_name, rs.step_order, rs.duration_override AS planned_duration_minutes, 
             rs.notes, s.description AS step_general_description, rs.target_temperature_celsius, rs.stretch_fold_interval_minutes
      FROM "RecipeStep" rs JOIN "Step" s ON rs.step_id = s.step_id
      WHERE rs.recipe_id = $1 AND rs.step_order > $2 ORDER BY rs.step_order ASC LIMIT 1;`;
    const nextStepResult = await client.query(nextStepQuery, [recipe_id, completed_step_order]);

    if (nextStepResult.rows.length > 0) {
      const nextStepRecipeData = nextStepResult.rows[0];
      const insertNextLogQuery = `INSERT INTO "UserBakeStepLog" (bake_log_id, recipe_step_id, step_order, step_name, planned_duration_minutes, actual_start_timestamp) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING bake_step_log_id, actual_start_timestamp;`;
      const nextLogResult = await client.query(insertNextLogQuery, [bakeLogId, nextStepRecipeData.recipe_step_id, nextStepRecipeData.step_order, nextStepRecipeData.step_name, nextStepRecipeData.planned_duration_minutes]);
      const { bake_step_log_id: newNextBakeStepLogId, actual_start_timestamp: nextStepStartTime } = nextLogResult.rows[0];
      
      await client.query("COMMIT");
      console.log(`   Next Step Log ID ${newNextBakeStepLogId} initiated.`);
      
      const newCurrentStepDataForFrontend = {
        ...nextStepRecipeData,
        bake_step_log_id: newNextBakeStepLogId,
        actual_start_timestamp: nextStepStartTime,
        user_step_notes: null 
      };

      res.status(200).json({ 
          message: "Step completed, next initiated.",
          currentStepDetails: newCurrentStepDataForFrontend 
          // furtherNextStepDetails: could be added here if logic exists to fetch it
      });
    } else {
      await client.query(`UPDATE "UserBakeLog" SET status = 'completed', bake_end_timestamp = NOW(), updated_at = NOW() WHERE bake_log_id = $1 AND user_id = $2;`, [bakeLogId, dbUserId]);
      await client.query("COMMIT");
      console.log(`   Bake Log ID ${bakeLogId} marked completed.`);
      res.status(200).json({ message: "Final step completed. Bake finished!", bakeLogId });
    }
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    console.error(`🔴 Error POST /api/bakes/.../complete for BakeLogID ${bakeLogId}:`, error.stack);
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
  const validStatuses = ['active', 'paused', 'abandoned'];
  if (!status || !validStatuses.includes(status)) return res.status(400).json({ message: `Invalid status. Use: ${validStatuses.join(', ')}` });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let setClauses = ["status = $1", "updated_at = NOW()"];
    const queryParams = [status];
    if (status === 'abandoned') {
        setClauses.push("bake_end_timestamp = NOW()");
    } else if (status === 'active' || status === 'paused') {
        setClauses.push("bake_end_timestamp = NULL");
    }
    queryParams.push(bakeLogId, dbUserId);

    const updateQuery = `UPDATE "UserBakeLog" SET ${setClauses.join(', ')} WHERE bake_log_id = $${queryParams.length-1} AND user_id = $${queryParams.length} RETURNING status, bake_end_timestamp;`;
    const result = await client.query(updateQuery, queryParams);
    if (result.rowCount === 0) {
      await client.query("ROLLBACK"); return res.status(404).json({ message: "Bake session not found or no change needed." });
    }
    await client.query("COMMIT");
    console.log(`   Bake Log ID ${bakeLogId} status updated to ${result.rows[0].status}.`);
    res.status(200).json({ message: "Bake status updated.", newStatus: result.rows[0].status, bakeEndTimestamp: result.rows[0].bake_end_timestamp });
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    console.error(`🔴 Error PUT /api/bakes/.../status for BakeLogID ${bakeLogId}:`, error.stack);
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
             ubl.bake_start_timestamp, ubl.status,
             (SELECT json_build_object(
                  'bake_step_log_id', ubsl.bake_step_log_id, 
                  'recipe_step_id', ubsl.recipe_step_id,
                  'step_order', ubsl.step_order, 
                  'step_name', ubsl.step_name,
                  'planned_duration_minutes', ubsl.planned_duration_minutes,
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
      WHERE ubl.user_id = $1 AND ubl.status = 'active'
      ORDER BY ubl.bake_start_timestamp DESC;`;

    const { rows } = await pool.query(query, [dbUserId]);
    
    console.log(`   Found ${rows.length} active bake(s) for User ID ${dbUserId}.`);
    res.status(200).json({ activeBakes: rows });
  } catch (error) {
    console.error(`🔴 Error GET /api/bakes/active for UserID ${dbUserId}:`, error.stack);
    res.status(500).json({ message: "Server error fetching active bakes." });
  }
};