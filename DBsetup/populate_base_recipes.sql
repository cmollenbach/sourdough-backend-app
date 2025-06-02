-- Clean base recipe population script for new step types

-- 1. Delete existing base recipes and their components
DELETE FROM "Recipe"
WHERE is_base_recipe = TRUE AND user_id IS NULL;

-- 2. Ensure essential lookup data (Units, Ingredients, Steps) are present
INSERT INTO "Unit" (unit_name, unit_abbreviation) VALUES
('grams', 'g'), ('ounces', 'oz'), ('milliliters', 'ml'), ('liters', 'l'),
('teaspoons', 'tsp'), ('tablespoons', 'tbsp')
ON CONFLICT (unit_name) DO NOTHING;

INSERT INTO "Ingredient" (ingredient_name, is_wet) VALUES
('Bread Flour', FALSE),
('Whole Wheat Flour', FALSE),
('Rye Flour', FALSE),
('Spelt Flour', FALSE),
('Semolina Flour', FALSE),
('Einkorn Flour', FALSE),
('Other Flour', FALSE),
('Water', TRUE),
('Active Sourdough Starter', TRUE),
('Olive Oil', TRUE),
('All-Purpose Flour', FALSE)
ON CONFLICT (ingredient_name) DO NOTHING;

-- 3. Insert valid Step types only
INSERT INTO "Step" (step_name, step_type, description, is_predefined, duration_minutes) VALUES
-- Preferment steps
('Levain Build', 'preferment', 'Build and ferment the levain (sourdough starter pre-ferment).', TRUE, 480),
('Poolish Build', 'preferment', 'Prepare and ferment a poolish.', TRUE, 720),
('Biga Build', 'preferment', 'Prepare and ferment a biga.', TRUE, 720),
-- Main mix steps
('Autolyse', 'main_mix', 'Resting flour and water before adding other ingredients.', TRUE, 30),
('Mix Final Dough', 'main_mix', 'Combine all ingredients for the final dough.', TRUE, 15),
-- Timing steps (all others)
('Bulk Fermentation', 'timing', 'First rise of the dough, often with folds.', TRUE, 240),
('Bulk Fermentation with Stretch and Fold', 'timing', 'Main fermentation period with periodic stretch and folds.', TRUE, 240),
('Shaping', 'timing', 'Shape the dough into its final form.', TRUE, 15),
('Proofing', 'timing', 'Final rise of the shaped dough (can be at room temp or cold).', TRUE, 120),
('Baking', 'timing', 'Bake the bread.', TRUE, 45),
('Soaker Prep', 'timing', 'Soak grains, seeds, or other additions.', TRUE, 240),
('Scald Prep', 'timing', 'Prepare a scald with flour/grains and hot liquid.', TRUE, 60),
('Pre-shaping', 'timing', 'Initial shaping of the dough before a bench rest.', TRUE, 10),
('Bench Rest', 'timing', 'A short rest period, often after pre-shaping.', TRUE, 20),
('Cooling', 'timing', 'Cooling the baked bread before slicing.', TRUE, 120),
('Bulk Ferment - Active S&F', 'timing', 'Active stretch and fold sets during bulk fermentation.', TRUE, 120),
('Bulk Ferment - Passive Rest', 'timing', 'Passive rest after S&F sets during bulk fermentation.', TRUE, 150),
('Bake Covered', 'timing', 'Bake covered at high temperature.', TRUE, 25),
('Bake Uncovered', 'timing', 'Finish baking uncovered for crust.', TRUE, 20)
ON CONFLICT (step_name) DO NOTHING;

-- 4. Insert base recipes and their steps (examples)

-- Recipe 1: Simple No-Knead Sourdough Bread
INSERT INTO "Recipe" (user_id, recipe_name, description, target_weight, target_weight_unit_id, target_hydration, target_salt_pct, is_base_recipe) VALUES
(NULL, 'Simple No-Knead Sourdough Bread', 'An easy, hands-off sourdough recipe perfect for beginners, requiring minimal kneading and yielding a great crust and crumb. Ideal for a Dutch oven bake.', 900, (SELECT unit_id FROM "Unit" WHERE unit_name = 'grams'), 75, 2.0, TRUE);

INSERT INTO "RecipeStep" (recipe_id, step_id, step_order, contribution_pct, target_hydration, notes, duration_override, target_temperature_celsius, stretch_fold_interval_minutes) VALUES
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'Simple No-Knead Sourdough Bread' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Levain Build'), 1, 20, 100, 'Build your levain. It should be active and bubbly.', 480, 24, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'Simple No-Knead Sourdough Bread' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Mix Final Dough'), 2, NULL, NULL, 'Combine levain, main flour, water, and salt. Mix gently until just combined.', 15, NULL, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'Simple No-Knead Sourdough Bread' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Bulk Fermentation'), 3, NULL, NULL, 'Let dough rise. Perform 2-3 sets of gentle folds if comfortable, spread 30-45 mins apart.', 240, 24, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'Simple No-Knead Sourdough Bread' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Proofing'), 4, NULL, NULL, 'Cold proof in the refrigerator.', 720, 5, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'Simple No-Knead Sourdough Bread' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Baking'), 5, NULL, NULL, 'Preheat Dutch oven, bake covered then uncovered.', 50, 240, NULL);

-- StageIngredients for 'Simple No-Knead Sourdough Bread'
INSERT INTO "StageIngredient" (recipe_step_id, ingredient_id, percentage, is_wet) VALUES
((SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'Simple No-Knead Sourdough Bread' AND r.user_id IS NULL AND rs.step_order = 1), (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'Bread Flour'), 100.0, FALSE);

INSERT INTO "StageIngredient" (recipe_step_id, ingredient_id, percentage, is_wet) VALUES
((SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'Simple No-Knead Sourdough Bread' AND r.user_id IS NULL AND rs.step_order = 2), (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'Bread Flour'), 90.0, FALSE),
((SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'Simple No-Knead Sourdough Bread' AND r.user_id IS NULL AND rs.step_order = 2), (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'Whole Wheat Flour'), 10.0, FALSE);

-- Recipe 2: Classic Sourdough Focaccia
INSERT INTO "Recipe" (user_id, recipe_name, description, target_weight, target_weight_unit_id, target_hydration, target_salt_pct, is_base_recipe) VALUES
(NULL, 'Classic Sourdough Focaccia', 'A light, airy, and very forgiving sourdough focaccia with a crisp exterior, perfect for beginners and adaptable to various toppings. For a visual guide, search for "Joshua Weissman sourdough focaccia".', 1000, (SELECT unit_id FROM "Unit" WHERE unit_name = 'grams'), 80, 2.5, TRUE);

INSERT INTO "RecipeStep" (recipe_id, step_id, step_order, contribution_pct, target_hydration, notes, duration_override, target_temperature_celsius, stretch_fold_interval_minutes) VALUES
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'Classic Sourdough Focaccia' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Levain Build'), 1, 15, 100, 'Build your levain.', 360, 24, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'Classic Sourdough Focaccia' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Mix Final Dough'), 2, NULL, NULL, 'Gently mix all ingredients. Dough will be very wet. Add olive oil during mixing if desired (not included in core percentages).', 15, NULL, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'Classic Sourdough Focaccia' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Bulk Fermentation with Stretch and Fold'), 3, NULL, NULL, 'Perform 3-4 sets of stretch and folds in the bowl.', 180, 24, 30),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'Classic Sourdough Focaccia' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Proofing'), 4, NULL, NULL, 'Transfer to an oiled pan, gently stretch. Dimple generously with oiled fingers and add toppings if desired. Let proof.', 60, 24, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'Classic Sourdough Focaccia' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Baking'), 5, NULL, NULL, 'Bake in a hot oven until golden and bubbly.', 25, 220, NULL);

INSERT INTO "StageIngredient" (recipe_step_id, ingredient_id, percentage, is_wet) VALUES
((SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'Classic Sourdough Focaccia' AND r.user_id IS NULL AND rs.step_order = 1), (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'All-Purpose Flour'), 100.0, FALSE);

INSERT INTO "StageIngredient" (recipe_step_id, ingredient_id, percentage, is_wet) VALUES
((SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'Classic Sourdough Focaccia' AND r.user_id IS NULL AND rs.step_order = 2), (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'Bread Flour'), 95.0, FALSE),
((SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'Classic Sourdough Focaccia' AND r.user_id IS NULL AND rs.step_order = 2), (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'Whole Wheat Flour'), 5.0, FALSE);

-- Recipe 3: High-Hydration Country Loaf with Seeds & Grains
INSERT INTO "Recipe" (user_id, recipe_name, description, target_weight, target_weight_unit_id, target_hydration, target_salt_pct, is_base_recipe) VALUES
(NULL, 'High-Hydration Country Loaf with Seeds & Grains', 'A challenging but rewarding high-hydration sourdough loaf with complex flavors and textures from added seeds and grains. Focuses on advanced dough handling. For advanced techniques, look into sources like "FullProofBaking" on YouTube for detailed shaping and handling of wet doughs.', 1050, (SELECT unit_id FROM "Unit" WHERE unit_name = 'grams'), 85, 2.2, TRUE);

INSERT INTO "RecipeStep" (recipe_id, step_id, step_order, contribution_pct, target_hydration, notes, duration_override, target_temperature_celsius, stretch_fold_interval_minutes) VALUES
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'High-Hydration Country Loaf with Seeds & Grains' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Soaker Prep'), 1, NULL, NULL, 'Soak seeds/grains (e.g., flax, sunflower, pumpkin seeds) in equal parts hot water.', 240, NULL, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'High-Hydration Country Loaf with Seeds & Grains' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Levain Build'), 2, 25, 100, 'Build your levain until active and bubbly.', 360, 24, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'High-Hydration Country Loaf with Seeds & Grains' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Autolyse'), 3, NULL, NULL, 'Combine main flours with most of the water. Mix until just combined and let rest.', 30, NULL, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'High-Hydration Country Loaf with Seeds & Grains' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Mix Final Dough'), 4, NULL, NULL, 'Add levain, salt, remaining water, and drained soaker. Mix thoroughly to incorporate all ingredients and develop initial strength.', 20, NULL, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'High-Hydration Country Loaf with Seeds & Grains' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Bulk Fermentation with Stretch and Fold'), 5, NULL, NULL, 'Perform 4-5 sets of strong stretch and folds.', 270, 24, 30),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'High-Hydration Country Loaf with Seeds & Grains' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Pre-shaping'), 6, NULL, NULL, 'Gently pre-shape the dough.', 10, NULL, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'High-Hydration Country Loaf with Seeds & Grains' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Bench Rest'), 7, NULL, NULL, 'Allow dough to relax.', 20, 24, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'High-Hydration Country Loaf with Seeds & Grains' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Shaping'), 8, NULL, NULL, 'Final shape the dough.', 15, NULL, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'High-Hydration Country Loaf with Seeds & Grains' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Proofing'), 9, NULL, NULL, 'Cold proof in the refrigerator.', 1080, 5, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'High-Hydration Country Loaf with Seeds & Grains' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Baking'), 10, NULL, NULL, 'Preheat Dutch oven, bake covered then uncovered, potentially reducing temp later for dark crust.', 60, 245, NULL);

INSERT INTO "StageIngredient" (recipe_step_id, ingredient_id, percentage, is_wet) VALUES
((SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'High-Hydration Country Loaf with Seeds & Grains' AND r.user_id IS NULL AND rs.step_order = 2), (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'Bread Flour'), 80.0, FALSE),
((SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'High-Hydration Country Loaf with Seeds & Grains' AND r.user_id IS NULL AND rs.step_order = 2), (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'Whole Wheat Flour'), 20.0, FALSE);

INSERT INTO "StageIngredient" (recipe_step_id, ingredient_id, percentage, is_wet) VALUES
((SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'High-Hydration Country Loaf with Seeds & Grains' AND r.user_id IS NULL AND rs.step_order = 3), (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'Bread Flour'), 85.0, FALSE),
((SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'High-Hydration Country Loaf with Seeds & Grains' AND r.user_id IS NULL AND rs.step_order = 3), (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'Whole Wheat Flour'), 15.0, FALSE);

INSERT INTO "StageIngredient" (recipe_step_id, ingredient_id, percentage, is_wet) VALUES
((SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'High-Hydration Country Loaf with Seeds & Grains' AND r.user_id IS NULL AND rs.step_order = 4), (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'Other Flour'), 10.0, FALSE);

SELECT 'Base recipes and their steps populated successfully!' AS status;