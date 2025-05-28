// sourdough-backend/server.js
require("dotenv").config(); // Load .env file variables

// === Global Error Handlers (Place these very early) ===
process.on("unhandledRejection", (reason, promise) => {
  console.error("🔴 UNHANDLED REJECTION:", reason);
  // Consider graceful shutdown in production: process.exit(1);
});

process.on("uncaughtException", (error) => {
  console.error("🔴 UNCAUGHT EXCEPTION:", error);
  // Critical error, consider graceful shutdown: process.exit(1);
});

process.on("exit", (code) => {
  console.log(`🔴 Node.js process is exiting with code: ${code}`);
});
// === End of Global Error Handlers ===

// Environment variable checks and setup
if (!process.env.DATABASE_URL) {
  console.error(
    "🔴 FATAL ERROR: DATABASE_URL is not defined. Check .env file."
  );
  process.exit(1); // Exit on fatal error
} else {
  console.log("🟢 DOTENV: DATABASE_URL seems loaded.");
}
if (process.env.CLIENT_ORIGIN_URL) {
  console.log(
    "🟢 DOTENV: CLIENT_ORIGIN_URL loaded:",
    process.env.CLIENT_ORIGIN_URL
  );
} else {
  console.warn(
    "🟠 DOTENV Warning: CLIENT_ORIGIN_URL not defined, CORS might default."
  );
}
if (!process.env.JWT_SECRET) {
  console.error("🔴 FATAL ERROR: JWT_SECRET is not defined. Check .env file.");
  process.exit(1); // Exit on fatal error
} else {
  console.log("🟢 DOTENV: JWT_SECRET seems loaded.");
}
const JWT_SECRET = process.env.JWT_SECRET;

// Module requires
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const port = process.env.PORT || 3001;

// PostgreSQL Connection Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

// PG Pool Error Handler
pool.on("error", (err, client) => {
  console.error("🔴 UNEXPECTED ERROR ON IDLE PG CLIENT:", err);
});

// Initial Database Connection Check
pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error(
      "🔴 Error checking PostgreSQL database connection:",
      err.stack
    );
  } else {
    console.log(
      "🟢 Successfully connected to PostgreSQL database. Server time:",
      res.rows[0].now
    );
  }
});

// CORS Configuration
const clientOrigin = process.env.CLIENT_ORIGIN_URL || "http://localhost:3000";
app.use(cors({ origin: clientOrigin, optionsSuccessStatus: 200 }));
console.log(`CORS enabled for origin: ${clientOrigin}`);

// Middleware
app.use(express.json()); // Parse JSON request bodies

// === AUTHENTICATION MIDDLEWARE ===
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (token == null) {
    console.log("Auth middleware: No token provided.");
    return res.status(401).json({ message: "Access token is required." });
  }

  jwt.verify(token, JWT_SECRET, (err, decodedTokenPayload) => {
    if (err) {
      console.log("Auth middleware: Token verification failed.", err.message);
      return res.status(403).json({ message: "Token is invalid or expired." });
    }
    req.user = decodedTokenPayload;
    console.log(
      "Auth middleware: Token verified successfully for user:",
      req.user.username,
      "(ID:",
      req.user.userId,
      ")"
    );
    next();
  });
};
// === END OF AUTHENTICATION MIDDLEWARE ===

// === HELPER FUNCTION FOR LEVAIN BUILD STEP IDENTIFICATION ===
async function getLevainBuildStepId(client) {
  const stepResult = await client.query(
    "SELECT step_id FROM Step WHERE step_name = 'Levain Build' AND is_predefined = TRUE;"
  );
  if (stepResult.rows.length === 0) {
    throw new Error("Predefined step 'Levain Build' not found in Step table.");
  }
  return stepResult.rows[0].step_id;
}

async function getIngredientIds(client) {
  const flourIngResult = await client.query(
    "SELECT ingredient_id FROM Ingredient WHERE ingredient_name ILIKE '%flour%';"
  );
  const waterIngResult = await client.query(
    "SELECT ingredient_id FROM Ingredient WHERE ingredient_name = 'Water';"
  );
  if (flourIngResult.rows.length === 0)
    throw new Error("Default 'Flour' not found in Ingredient table.");
  if (waterIngResult.rows.length === 0)
    throw new Error("'Water' not found in Ingredient table.");
  return {
    flourIngredientId: flourIngResult.rows[0].ingredient_id,
    waterIngredientId: waterIngResult.rows[0].ingredient_id,
  };
}
// === END OF HELPER FUNCTIONS ===

// === ROUTES ===

app.get("/", (req, res) => {
  res.send("Hello from the Sourdough Backend!");
});

// === CORRECTED POST /api/recipes - Create a new recipe with steps ===
app.post("/api/recipes", authenticateToken, async (req, res) => {
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

  console.log(
    `POST /api/recipes - User [${username}, ID: ${dbUserId}] creating new recipe: "${recipe_name}"`
  );
  // console.log(`  Received data:`, JSON.stringify(req.body, null, 2)); // Keep for debugging if needed

  if (!recipe_name || recipe_name.trim() === "") {
    return res.status(400).json({ message: "Recipe name is required." });
  }
  if (
    [targetDoughWeight, hydrationPercentage, saltPercentage].some(
      (val) => val == null
    )
  ) {
    return res
      .status(400)
      .json({
        message:
          "Missing core recipe calculation parameters (targetDoughWeight, hydrationPercentage, saltPercentage).",
      });
  }
  if (!steps || !Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({ message: "At least one step is required." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const unitResult = await client.query(
      "SELECT unit_id FROM Unit WHERE unit_abbreviation = 'g';"
    );
    if (unitResult.rows.length === 0)
      throw new Error("Default unit 'g' (grams) not found in Unit table.");
    const gramsUnitId = unitResult.rows[0].unit_id; // Still needed for Recipe table

    const recipeQuery = `
            INSERT INTO Recipe (
                user_id, recipe_name, description, 
                target_weight, target_weight_unit_id, target_hydration, target_salt_pct, 
                is_base_recipe, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
            RETURNING recipe_id, recipe_name, created_at;
        `;
    const recipeParams = [
      dbUserId,
      recipe_name.trim(),
      description || null,
      parseFloat(targetDoughWeight),
      gramsUnitId, // For Recipe.target_weight_unit_id
      parseFloat(hydrationPercentage),
      parseFloat(saltPercentage),
      false,
    ];
    const recipeResult = await client.query(recipeQuery, recipeParams);
    const newRecipe = recipeResult.rows[0];
    const recipeId = newRecipe.recipe_id;

    const LEVAIN_BUILD_STEP_ID = await getLevainBuildStepId(client);
    const { flourIngredientId, waterIngredientId } = await getIngredientIds(
      client
    );

    for (const step of steps) {
      if (step.step_id == null || step.step_order == null) {
        throw new Error("Each step must have a step_id and step_order.");
      }
      const recipeStepQuery = `
                INSERT INTO RecipeStep (
                    recipe_id, step_id, step_order, duration_override, notes, 
                    target_temperature_celsius, contribution_pct, target_hydration, 
                    created_at, updated_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
                RETURNING recipe_step_id;
            `;
      const recipeStepValues = [
        recipeId,
        step.step_id,
        step.step_order,
        step.duration_override != null
          ? parseInt(step.duration_override, 10)
          : null,
        step.notes || null,
        step.target_temperature_celsius != null
          ? parseFloat(step.target_temperature_celsius)
          : null,
        step.contribution_pct != null
          ? parseFloat(step.contribution_pct)
          : null,
        step.target_hydration != null
          ? parseFloat(step.target_hydration)
          : null,
      ];
      const recipeStepResult = await client.query(
        recipeStepQuery,
        recipeStepValues
      );
      const newRecipeStepId = recipeStepResult.rows[0].recipe_step_id;

      if (
        parseInt(step.step_id, 10) === LEVAIN_BUILD_STEP_ID &&
        step.contribution_pct != null &&
        step.target_hydration != null
      ) {
        const stepContributionPct = parseFloat(step.contribution_pct) / 100;
        const stepTargetHydration = parseFloat(step.target_hydration) / 100;
        const overallTargetDoughWeight = parseFloat(targetDoughWeight);

        const starterWeight = overallTargetDoughWeight * stepContributionPct;
        const flourInStarter = starterWeight / (1 + stepTargetHydration);
        const waterInStarter = starterWeight - flourInStarter;

        console.log(
          `  Levain Step (ID ${newRecipeStepId}): TDW=${overallTargetDoughWeight}, Contr%=${
            step.contribution_pct
          }, Hydr%=${step.target_hydration} => SW=${starterWeight.toFixed(
            1
          )}, F=${flourInStarter.toFixed(1)}, W=${waterInStarter.toFixed(1)}`
        );

        // CORRECTED StageIngredient INSERT (removed unit_id)
        const stageIngredientQuery = `
                    INSERT INTO StageIngredient (recipe_step_id, ingredient_id, calculated_weight, is_wet)
                    VALUES ($1, $2, $3, $4);
                `;
        await client.query(stageIngredientQuery, [
          newRecipeStepId,
          flourIngredientId,
          flourInStarter,
          false,
        ]);
        await client.query(stageIngredientQuery, [
          newRecipeStepId,
          waterIngredientId,
          waterInStarter,
          true,
        ]);
      }
    }

    await client.query("COMMIT");
    console.log(
      `  Recipe "${newRecipe.recipe_name}" (ID: ${recipeId}) and its steps saved successfully for user ID: ${dbUserId}.`
    );
    res.status(201).json({
      message: "Recipe created successfully!",
      recipe: { ...newRecipe, recipe_id: recipeId, steps: req.body.steps },
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    console.error(
      `🔴 Error in POST /api/recipes for user ID ${dbUserId}:`,
      error.stack
    );
    res
      .status(500)
      .json({ message: `Failed to create recipe: ${error.message}` });
  } finally {
    if (client) client.release();
  }
});
// === END OF CORRECTED POST /api/recipes ===

// === CORRECTED PUT /api/recipes/:recipeId - Update an existing recipe and its steps ===
app.put("/api/recipes/:recipeId", authenticateToken, async (req, res) => {
  const loggedInUserId = req.user.userId;
  const username = req.user.username;
  const { recipeId } = req.params;

  const {
    recipe_name,
    description,
    targetDoughWeight,
    hydrationPercentage,
    saltPercentage,
    steps,
  } = req.body;

  console.log(
    `PUT /api/recipes/${recipeId} - User [${username}, ID: ${loggedInUserId}] attempting to update recipe.`
  );
  // console.log(`  Update data received:`, JSON.stringify(req.body, null, 2)); // Keep for debugging

  if (isNaN(parseInt(recipeId))) {
    return res.status(400).json({ message: "Invalid recipe ID format." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const ownershipCheckQuery =
      "SELECT user_id, target_weight FROM Recipe WHERE recipe_id = $1;"; // Also fetch target_weight
    const ownershipResult = await client.query(ownershipCheckQuery, [recipeId]);

    if (ownershipResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Recipe not found." });
    }
    if (ownershipResult.rows[0].user_id !== loggedInUserId) {
      await client.query("ROLLBACK");
      return res
        .status(403)
        .json({ message: "You are not authorized to update this recipe." });
    }
    let currentRecipeTDW = parseFloat(ownershipResult.rows[0].target_weight);

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
      currentRecipeTDW = parseFloat(targetDoughWeight); // Update for subsequent StageIngredient calc
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
      recipeUpdateFields.push(`updated_at = NOW()`);
      const updateRecipeQuery = `
                UPDATE Recipe SET ${recipeUpdateFields.join(", ")}
                WHERE recipe_id = $${recipeParamCount} AND user_id = $${
        recipeParamCount + 1
      }
            `;
      recipeUpdateValues.push(recipeId, loggedInUserId);
      const updatedRecipeResult = await client.query(
        updateRecipeQuery,
        recipeUpdateValues
      );
      if (updatedRecipeResult.rowCount === 0) {
        throw new Error(
          "Failed to update recipe main details or recipe not found for user."
        );
      }
      console.log(`  Recipe table updated for recipe ID: ${recipeId}`);
    }

    if (steps && Array.isArray(steps)) {
      console.log(`  Replacing steps for recipe ID: ${recipeId}`);
      await client.query("DELETE FROM RecipeStep WHERE recipe_id = $1", [
        recipeId,
      ]);
      console.log(`  Old RecipeSteps deleted for recipe ID: ${recipeId}`);

      const LEVAIN_BUILD_STEP_ID = await getLevainBuildStepId(client);
      const { flourIngredientId, waterIngredientId } = await getIngredientIds(
        client
      );
      // unit_id is not needed for StageIngredient inserts

      for (const step of steps) {
        if (step.step_id == null || step.step_order == null) {
          throw new Error("Each step must have a step_id and step_order.");
        }
        const recipeStepQuery = `
                    INSERT INTO RecipeStep (
                        recipe_id, step_id, step_order, duration_override, notes, 
                        target_temperature_celsius, contribution_pct, target_hydration, 
                        created_at, updated_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
                    RETURNING recipe_step_id;
                `;
        const recipeStepValues = [
          recipeId,
          step.step_id,
          step.step_order,
          step.duration_override != null
            ? parseInt(step.duration_override, 10)
            : null,
          step.notes || null,
          step.target_temperature_celsius != null
            ? parseFloat(step.target_temperature_celsius)
            : null,
          step.contribution_pct != null
            ? parseFloat(step.contribution_pct)
            : null,
          step.target_hydration != null
            ? parseFloat(step.target_hydration)
            : null,
        ];
        const recipeStepResult = await client.query(
          recipeStepQuery,
          recipeStepValues
        );
        const newRecipeStepId = recipeStepResult.rows[0].recipe_step_id;
        console.log(`   Inserted new RecipeStep ID: ${newRecipeStepId}`);

        if (
          parseInt(step.step_id, 10) === LEVAIN_BUILD_STEP_ID &&
          step.contribution_pct != null &&
          step.target_hydration != null
        ) {
          const stepContributionPct = parseFloat(step.contribution_pct) / 100;
          const stepTargetHydration = parseFloat(step.target_hydration) / 100;

          const starterWeight = currentRecipeTDW * stepContributionPct; // Use potentially updated TDW
          const flourInStarter = starterWeight / (1 + stepTargetHydration);
          const waterInStarter = starterWeight - flourInStarter;

          console.log(
            `   Levain Step (ID ${newRecipeStepId}) Updated: TDW=${currentRecipeTDW}, Contr%=${
              step.contribution_pct
            }, Hydr%=${step.target_hydration} => SW=${starterWeight.toFixed(
              1
            )}, F=${flourInStarter.toFixed(1)}, W=${waterInStarter.toFixed(1)}`
          );

          // CORRECTED StageIngredient INSERT (removed unit_id)
          const stageIngredientQuery = `
                        INSERT INTO StageIngredient (recipe_step_id, ingredient_id, calculated_weight, is_wet)
                        VALUES ($1, $2, $3, $4);
                    `;
          await client.query(stageIngredientQuery, [
            newRecipeStepId,
            flourIngredientId,
            flourInStarter,
            false,
          ]);
          await client.query(stageIngredientQuery, [
            newRecipeStepId,
            waterIngredientId,
            waterInStarter,
            true,
          ]);
        }
      }
    }

    await client.query("COMMIT");

    const finalRecipeResult = await client.query(
      "SELECT * FROM Recipe WHERE recipe_id = $1",
      [recipeId]
    );

    console.log(
      `  Recipe ID ${recipeId} updated successfully for user ID ${loggedInUserId}.`
    );
    res.status(200).json({
      message: "Recipe updated successfully!",
      recipe: finalRecipeResult.rows[0],
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    console.error(
      `🔴 Error in PUT /api/recipes/${recipeId} for user ID ${loggedInUserId}:`,
      error.stack
    );
    res
      .status(500)
      .json({ message: `Failed to update recipe: ${error.message}` });
  } finally {
    if (client) client.release();
  }
});
// In sourdough-backend/server.js

// ... (after your other route definitions, e.g., before app.listen)

// === NEW ROUTE: GET /api/steps - Fetch all predefined step types ===
app.get('/api/steps', authenticateToken, async (req, res) => {
    // authenticateToken might not be strictly necessary if these steps are considered public,
    // but it's good practice if only logged-in users should see them or if you plan to expand this.
    // If they are public, you can remove `authenticateToken`.
    console.log(`GET /api/steps - Fetching all predefined step types.`); 
    try {
        const query = `
            SELECT 
                step_id, 
                step_name, 
                description, 
                step_type,      -- Added from your schema
                duration_minutes AS "defaultDurationMinutes" -- Added from your schema, aliased
                -- is_predefined -- You might want to send this too
            FROM Step 
            WHERE is_predefined = TRUE  -- Assuming you only want predefined steps for selection
            ORDER BY step_id ASC; 
        `;
        
        const { rows } = await pool.query(query);
        console.log(`  Found ${rows.length} predefined steps.`);
        res.json(rows);
    } catch (error) {
        console.error(`🔴 Error in GET /api/steps:`, error.stack);
        res.status(500).json({ message: 'Failed to fetch predefined steps due to server error.' });
    }
});
// === END OF NEW ROUTE ===


// Start server (this should be at the very end)
app.listen(port, '0.0.0.0', () => {
  console.log(`Sourdough backend server listening on host 0.0.0.0, port ${port}`);
});
// GET /api/recipes - Fetch all recipes for the authenticated user
app.get("/api/recipes", authenticateToken, async (req, res) => {
  const loggedInUserId = req.user.userId;
  const username = req.user.username;

  console.log(
    `GET /api/recipes - Fetching all recipes for user [${username}, ID: ${loggedInUserId}]`
  );

  try {
    const query = `
    SELECT
        r.recipe_id,
        r.recipe_name,
        r.description,
        r.target_weight, 
        r.target_weight_unit_id, 
        r.target_hydration AS "hydrationPercentage",
        r.target_salt_pct AS "saltPercentage",
        r.is_base_recipe,
        r.created_at,
        r.updated_at,
        levain_details.contribution_pct AS "starterPercentage",
        levain_details.target_hydration AS "starterHydration"
    FROM
        Recipe r
    LEFT JOIN (
        SELECT 
            rs.recipe_id, 
            rs.contribution_pct, 
            rs.target_hydration
        FROM RecipeStep rs
        JOIN Step s ON rs.step_id = s.step_id
        WHERE s.step_name = 'Levain Build'
    ) AS levain_details ON r.recipe_id = levain_details.recipe_id
    WHERE
        r.user_id = $1
    ORDER BY
        r.created_at DESC;
`;
    const { rows } = await pool.query(query, [loggedInUserId]);

    const recipesResponse = rows.map((recipe) => ({
      recipe_id: recipe.recipe_id,
      recipe_name: recipe.recipe_name,
      description: recipe.description,
      targetDoughWeight: String(recipe.target_weight),
      hydrationPercentage: String(recipe.hydrationPercentage),
      saltPercentage: String(recipe.saltPercentage),
      starterPercentage:
        recipe.starterPercentage != null
          ? String(recipe.starterPercentage)
          : null,
      starterHydration:
        recipe.starterHydration != null
          ? String(recipe.starterHydration)
          : null,
      created_at: recipe.created_at,
      updated_at: recipe.updated_at,
    }));

    console.log(
      `  Found ${recipesResponse.length} recipes for user ID: ${loggedInUserId}`
    );
    res.json(recipesResponse);
  } catch (error) {
    console.error(
      `🔴 Error in GET /api/recipes for user ID ${loggedInUserId}:`,
      error.stack
    );
    res
      .status(500)
      .json({ message: "Failed to fetch recipes due to server error." });
  }
});

// GET /api/recipes/:recipeId - Fetch a specific recipe by its ID
app.get("/api/recipes/:recipeId", authenticateToken, async (req, res) => {
  const loggedInUserId = req.user.userId;
  const username = req.user.username;
  const { recipeId } = req.params;

  console.log(
    `GET /api/recipes/${recipeId} - Attempting to fetch for user [${username}, ID: ${loggedInUserId}]`
  );

  if (isNaN(parseInt(recipeId))) {
    return res.status(400).json({ message: "Invalid recipe ID format." });
  }

  const client = await pool.connect();
  try {
    const recipeQuery = `
            SELECT
                r.recipe_id, r.recipe_name, r.description,
                r.target_weight, r.target_hydration AS "hydrationPercentage", r.target_salt_pct AS "saltPercentage",
                r.created_at, r.updated_at
            FROM Recipe r
            WHERE r.recipe_id = $1 AND r.user_id = $2;
        `;
    const recipeResult = await client.query(recipeQuery, [
      recipeId,
      loggedInUserId,
    ]);

    if (recipeResult.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "Recipe not found or not authorized." });
    }
    const recipeData = recipeResult.rows[0];

    const stepsQuery = `
            SELECT 
                rs.recipe_step_id, rs.step_id, s.step_name, rs.step_order, 
                rs.duration_override, rs.notes, rs.target_temperature_celsius,
                rs.contribution_pct, rs.target_hydration
            FROM RecipeStep rs
            JOIN Step s ON rs.step_id = s.step_id
            WHERE rs.recipe_id = $1
            ORDER BY rs.step_order ASC;
        `;
    const stepsResult = await client.query(stepsQuery, [recipeId]);

    const recipeResponse = {
      recipe_id: recipeData.recipe_id,
      recipe_name: recipeData.recipe_name,
      description: recipeData.description,
      targetDoughWeight: String(recipeData.target_weight),
      hydrationPercentage: String(recipeData.hydrationPercentage),
      saltPercentage: String(recipeData.saltPercentage),
      created_at: recipeData.created_at,
      updated_at: recipeData.updated_at,
      steps: stepsResult.rows.map((step) => ({
        recipe_step_id: step.recipe_step_id,
        step_id: step.step_id,
        step_name: step.step_name,
        step_order: step.step_order,
        duration_override: step.duration_override,
        notes: step.notes,
        target_temperature_celsius: step.target_temperature_celsius,
        contribution_pct: step.contribution_pct,
        target_hydration: step.target_hydration,
      })),
    };

    console.log(
      `  Successfully fetched recipe ID ${recipeId} for user ID ${loggedInUserId}.`
    );
    res.json(recipeResponse);
  } catch (error) {
    console.error(
      `🔴 Error in GET /api/recipes/${recipeId} for user ID ${loggedInUserId}:`,
      error.stack
    );
    res
      .status(500)
      .json({ message: "Failed to fetch recipe due to server error." });
  } finally {
    if (client) client.release();
  }
});

// DELETE /api/recipes/:recipeId - Delete a specific recipe for the authenticated user
app.delete("/api/recipes/:recipeId", authenticateToken, async (req, res) => {
  const loggedInUserId = req.user.userId;
  const username = req.user.username;
  const { recipeId } = req.params;

  console.log(
    `DELETE /api/recipes/${recipeId} - User [${username}, ID: ${loggedInUserId}] attempting to delete recipe.`
  );

  if (isNaN(parseInt(recipeId))) {
    return res.status(400).json({ message: "Invalid recipe ID format." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const ownershipCheckQuery =
      "SELECT user_id FROM Recipe WHERE recipe_id = $1;";
    const ownershipResult = await client.query(ownershipCheckQuery, [recipeId]);

    if (ownershipResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Recipe not found." });
    }

    if (ownershipResult.rows[0].user_id !== loggedInUserId) {
      await client.query("ROLLBACK");
      return res
        .status(403)
        .json({ message: "You are not authorized to delete this recipe." });
    }

    const deleteRecipeQuery =
      "DELETE FROM Recipe WHERE recipe_id = $1 AND user_id = $2 RETURNING recipe_name;";
    const deleteResult = await client.query(deleteRecipeQuery, [
      recipeId,
      loggedInUserId,
    ]);

    if (deleteResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({ message: "Recipe not found or already deleted." });
    }

    await client.query("COMMIT");

    const deletedRecipeName = deleteResult.rows[0].recipe_name;
    console.log(
      `  Recipe "${deletedRecipeName}" (ID: ${recipeId}) deleted successfully for user ID ${loggedInUserId}.`
    );
    res
      .status(200)
      .json({ message: `Recipe "${deletedRecipeName}" deleted successfully.` });
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    console.error(
      `🔴 Error in DELETE /api/recipes/${recipeId} for user ID ${loggedInUserId}:`,
      error.stack
    );
    res
      .status(500)
      .json({ message: "Failed to delete recipe due to server error." });
  } finally {
    if (client) client.release();
  }
});

// --- Auth Routes ---
app.post("/auth/register", async (req, res) => {
  const { email, password } = req.body;
  const username = email;

  console.log(`POST /auth/register - Attempting to register: ${username}`);
  if (!email || !password) {
    return res
      .status(400)
      .json({ message: "Email and password are required." });
  }

  try {
    const userExistsQuery =
      'SELECT * FROM "User" WHERE username = $1 OR email = $2';
    const existingUser = await pool.query(userExistsQuery, [username, email]);
    if (existingUser.rows.length > 0) {
      console.log(`  Registration failed: User already exists - ${username}`);
      return res
        .status(409)
        .json({ message: "User already exists with this email." });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    console.log(`  Password hashed for: ${username}`);

    const insertUserQuery = `
      INSERT INTO "User" (username, email, password_hash, auth_provider)
      VALUES ($1, $2, $3, $4)
      RETURNING user_id, username, email, created_at;
    `;
    const newUserResult = await pool.query(insertUserQuery, [
      username,
      email,
      passwordHash,
      "email",
    ]);
    const newUser = newUserResult.rows[0];

    console.log(`  User registered: ${JSON.stringify(newUser)}`);
    res.status(201).json({
      message: "User registered successfully!",
      user: {
        userId: newUser.user_id,
        username: newUser.username,
        email: newUser.email,
        createdAt: newUser.created_at,
      },
    });
  } catch (error) {
    console.error("🔴 Error in POST /auth/register:", error.stack);
    res.status(500).json({ message: "Server error during registration." });
  }
});

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const username = email;

  console.log(`POST /auth/login - Attempting login: ${username}`);
  if (!email || !password) {
    return res
      .status(400)
      .json({ message: "Email and password are required." });
  }

  try {
    const findUserQuery =
      'SELECT * FROM "User" WHERE username = $1 AND auth_provider = $2';
    const userResult = await pool.query(findUserQuery, [username, "email"]);
    if (userResult.rows.length === 0) {
      console.log(`  Login failed: User not found - ${username}`);
      return res.status(401).json({ message: "Invalid credentials." });
    }
    const user = userResult.rows[0];

    const isPasswordMatch = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordMatch) {
      console.log(`  Login failed: Password incorrect for user - ${username}`);
      return res.status(401).json({ message: "Invalid credentials." });
    }

    const expiresIn = "1h";
    const token = jwt.sign(
      { userId: user.user_id, username: user.username },
      JWT_SECRET,
      { expiresIn }
    );

    console.log(`  Login successful, token generated for: ${username}`);
    res.status(200).json({
      message: "Login successful!",
      token,
      user: {
        userId: user.user_id,
        username: user.username,
        email: user.email,
      },
      expiresIn,
    });
  } catch (error) {
    console.error("🔴 Error in POST /auth/login:", error.stack);
    res.status(500).json({ message: "Server error during login." });
  }
});

// Start server
app.listen(port, "0.0.0.0", () => {
  console.log(
    `Sourdough backend server listening on host 0.0.0.0, port ${port}`
  );
});
