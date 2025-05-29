// utils/dbHelpers.js

async function getLevainBuildStepId(client) {
  const stepResult = await client.query(
    'SELECT step_id FROM "Step" WHERE step_name = \'Levain Build\' AND is_predefined = TRUE;' // Quoted "Step"
  );
  if (stepResult.rows.length === 0) {
    throw new Error("Predefined step 'Levain Build' not found in Step table.");
  }
  return stepResult.rows[0].step_id;
}

async function getIngredientIds(client) {
  const flourIngResult = await client.query(
    'SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name ILIKE \'Bread Flour\' OR ingredient_name ILIKE \'%All-Purpose Flour%\';' // Quoted "Ingredient"
  );
  const waterIngResult = await client.query(
    'SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = \'Water\';' // Quoted "Ingredient"
  );

  if (flourIngResult.rows.length === 0) {
    console.warn("🟠 Warning: Default 'Bread Flour' or 'All-Purpose Flour' not found in Ingredient table. Falling back to any flour.");
    const anyFlourResult = await client.query(
        'SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name ILIKE \'%flour%\';' // Quoted "Ingredient"
    );
    if (anyFlourResult.rows.length === 0) {
        throw new Error("No 'Flour' variants found in Ingredient table.");
    }
    flourIngResult.rows.push(anyFlourResult.rows[0]);
  }
  if (waterIngResult.rows.length === 0) {
    throw new Error("'Water' not found in Ingredient table.");
  }
  
  return {
    flourIngredientId: flourIngResult.rows[0].ingredient_id,
    waterIngredientId: waterIngResult.rows[0].ingredient_id,
  };
}

module.exports = {
  getLevainBuildStepId,
  getIngredientIds,
};