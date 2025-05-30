// utils/dbHelpers.js

async function getLevainBuildStepId(client) {
  const stepResult = await client.query(
    'SELECT step_id FROM "Step" WHERE step_name = \'Levain Build\' AND is_predefined = TRUE;'
  );
  if (stepResult.rows.length === 0) {
    // It's critical that your Step table IS populated with 'Levain Build'
    // and any other essential predefined steps your application logic relies on.
    console.error("🔴 CRITICAL: Predefined step 'Levain Build' not found in Step table. Ensure schema and initial data are correct.");
    throw new Error("Predefined step 'Levain Build' not found in Step table.");
  }
  return stepResult.rows[0].step_id;
}

// The getIngredientIds function might no longer be needed by recipeController.js
// if the client is sending specific ingredient_ids for all stageIngredients,
// including those for preferments like levains.
// If you have other backend scripts that use it (e.g., for populating base recipes programmatically),
// you might keep it or refactor it to be more generic.
/*
async function getIngredientIds(client) {
  // ... existing code ...
  // This function's primary use in recipeController was for auto-populating levain ingredients,
  // which is now handled by the client sending explicit stageIngredients for the levain step.
  console.warn("🟠 DBHELPER_NOTE: getIngredientIds may no longer be directly used by recipeController if client provides all stage ingredients for preferments.");
  // ... (rest of your original function code if you decide to keep it for other purposes)
  const flourIngResult = await client.query(
    'SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name ILIKE \'Bread Flour\' OR ingredient_name ILIKE \'%All-Purpose Flour%\';'
  );
  const waterIngResult = await client.query(
    'SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = \'Water\';'
  );

  let finalFlourId;
  if (flourIngResult.rows.length > 0) {
    finalFlourId = flourIngResult.rows[0].ingredient_id;
  } else {
    console.warn("🟠 Warning: Default 'Bread Flour' or 'All-Purpose Flour' not found in Ingredient table. Falling back to any flour for getIngredientIds.");
    const anyFlourResult = await client.query(
        'SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name ILIKE \'%flour%\' LIMIT 1;'
    );
    if (anyFlourResult.rows.length === 0) {
        throw new Error("No 'Flour' variants found in Ingredient table for getIngredientIds.");
    }
    finalFlourId = anyFlourResult.rows[0].ingredient_id;
  }

  if (waterIngResult.rows.length === 0) {
    throw new Error("'Water' not found in Ingredient table for getIngredientIds.");
  }
  
  return {
    flourIngredientId: finalFlourId,
    waterIngredientId: waterIngResult.rows[0].ingredient_id,
  };
}
*/

module.exports = {
  getLevainBuildStepId,
  // getIngredientIds, // Only export if you confirm it's still needed elsewhere
};n