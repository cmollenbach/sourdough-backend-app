-- populate_base_recipes.sql (Corrected target_salt_pct for Recipe table)

-- ... (DELETE statements from previous version should be here) ...
DELETE FROM StageIngredient 
WHERE recipe_step_id IN (
    SELECT rs.recipe_step_id 
    FROM RecipeStep rs
    JOIN Recipe r ON rs.recipe_id = r.recipe_id
    WHERE r.is_base_recipe = TRUE AND r.user_id IS NULL
);

DELETE FROM RecipeStep 
WHERE recipe_id IN (
    SELECT recipe_id 
    FROM Recipe 
    WHERE is_base_recipe = TRUE AND r.user_id IS NULL
);

DELETE FROM Recipe 
WHERE is_base_recipe = TRUE AND user_id IS NULL;

-- Recipe 1: My First Loaf Tin Sourdough
INSERT INTO Recipe (user_id, recipe_name, description, target_weight, target_weight_unit_id, target_hydration, target_salt_pct, is_base_recipe) VALUES
(NULL, 'My First Loaf Tin Sourdough', 'A simple sourdough recipe perfect for beginners, baked in a loaf tin. Easy to handle, minimal shaping.', 900, 1, 75, 2.0, TRUE); -- salt_pct: 2.0

-- ... (RecipeSteps for Recipe 1 remain the same, including levain target_hydration as 100) ...
-- ... (StageIngredients for Recipe 1 remain the same, salt bakers_percentage is 0.02) ...
INSERT INTO RecipeStep (recipe_id, step_id, step_order, contribution_pct, target_hydration, notes, duration_override, target_temperature_celsius, stretch_fold_interval_minutes) VALUES
((SELECT recipe_id FROM Recipe WHERE recipe_name = 'My First Loaf Tin Sourdough' AND user_id IS NULL), 1, 1, 0.20, 100, 'Build your levain. It should be active and bubbly.', 360, 24, NULL),
((SELECT recipe_id FROM Recipe WHERE recipe_name = 'My First Loaf Tin Sourdough' AND user_id IS NULL), 3, 2, NULL, NULL, 'Combine levain, flour, water, and salt. Mix until no dry bits remain, then rest.', 20, NULL, NULL),
((SELECT recipe_id FROM Recipe WHERE recipe_name = 'My First Loaf Tin Sourdough' AND user_id IS NULL), 4, 3, NULL, NULL, 'Let dough rise. Perform 2-3 sets of gentle folds if comfortable, spread 30-45 mins apart.', 240, 24, NULL),
((SELECT recipe_id FROM Recipe WHERE recipe_name = 'My First Loaf Tin Sourdough' AND user_id IS NULL), 7, 4, NULL, NULL, 'Gently shape and place in a loaf tin. Proof at room temperature.', 120, 24, NULL),
((SELECT recipe_id FROM Recipe WHERE recipe_name = 'My First Loaf Tin Sourdough' AND user_id IS NULL), 8, 5, NULL, NULL, 'Preheat oven with baking vessel if using. Bake until golden brown and cooked through.', 45, 230, NULL);

INSERT INTO StageIngredient (recipe_step_id, ingredient_id, bakers_percentage, is_wet)
SELECT rs.recipe_step_id, 1, 1.0, FALSE 
FROM RecipeStep rs JOIN Recipe r ON rs.recipe_id = r.recipe_id
WHERE r.recipe_name = 'My First Loaf Tin Sourdough' AND r.user_id IS NULL AND rs.step_order = 2;
INSERT INTO StageIngredient (recipe_step_id, ingredient_id, bakers_percentage, is_wet)
SELECT rs.recipe_step_id, 5, NULL, TRUE 
FROM RecipeStep rs JOIN Recipe r ON rs.recipe_id = r.recipe_id
WHERE r.recipe_name = 'My First Loaf Tin Sourdough' AND r.user_id IS NULL AND rs.step_order = 2;
INSERT INTO StageIngredient (recipe_step_id, ingredient_id, bakers_percentage, is_wet)
SELECT rs.recipe_step_id, 6, 0.02, FALSE  -- Salt as StageIngredient still 0.02 (decimal for BP)
FROM RecipeStep rs JOIN Recipe r ON rs.recipe_id = r.recipe_id
WHERE r.recipe_name = 'My First Loaf Tin Sourdough' AND r.user_id IS NULL AND rs.step_order = 2;


-- Recipe 2: Simple Sourdough Focaccia
INSERT INTO Recipe (user_id, recipe_name, description, target_weight, target_weight_unit_id, target_hydration, target_salt_pct, is_base_recipe) VALUES
(NULL, 'Simple Sourdough Focaccia', 'A high-hydration, very forgiving focaccia. Great for using up starter and learning to handle wet dough.', 1000, 1, 80, 2.5, TRUE); -- salt_pct: 2.5

-- ... (RecipeSteps for Recipe 2 remain the same, including levain target_hydration as 100) ...
-- ... (StageIngredients for Recipe 2 remain the same, salt bakers_percentage is 0.025) ...
INSERT INTO RecipeStep (recipe_id, step_id, step_order, contribution_pct, target_hydration, notes, duration_override, target_temperature_celsius, stretch_fold_interval_minutes) VALUES
((SELECT recipe_id FROM Recipe WHERE recipe_name = 'Simple Sourdough Focaccia' AND user_id IS NULL), 1, 1, 0.15, 100, 'Build your levain.', 360, 24, NULL),
((SELECT recipe_id FROM Recipe WHERE recipe_name = 'Simple Sourdough Focaccia' AND user_id IS NULL), 3, 2, NULL, NULL, 'Gently mix all ingredients. Dough will be very wet. Add olive oil during mixing if desired (not included in core percentages).', 15, NULL, NULL),
((SELECT recipe_id FROM Recipe WHERE recipe_name = 'Simple Sourdough Focaccia' AND user_id IS NULL), 5, 3, NULL, NULL, 'Perform 3-4 sets of stretch and folds in the bowl.', 180, 24, 30),
((SELECT recipe_id FROM Recipe WHERE recipe_name = 'Simple Sourdough Focaccia' AND user_id IS NULL), 7, 4, NULL, NULL, 'Transfer to an oiled pan, gently stretch. Dimple generously with oiled fingers and add toppings if desired. Let proof.', 60, 24, NULL),
((SELECT recipe_id FROM Recipe WHERE recipe_name = 'Simple Sourdough Focaccia' AND user_id IS NULL), 8, 5, NULL, NULL, 'Bake in a hot oven until golden and bubbly.', 25, 220, NULL);

INSERT INTO StageIngredient (recipe_step_id, ingredient_id, bakers_percentage, is_wet)
SELECT rs.recipe_step_id, 4, 1.0, FALSE 
FROM RecipeStep rs JOIN Recipe r ON rs.recipe_id = r.recipe_id
WHERE r.recipe_name = 'Simple Sourdough Focaccia' AND r.user_id IS NULL AND rs.step_order = 2;
INSERT INTO StageIngredient (recipe_step_id, ingredient_id, bakers_percentage, is_wet)
SELECT rs.recipe_step_id, 5, NULL, TRUE 
FROM RecipeStep rs JOIN Recipe r ON rs.recipe_id = r.recipe_id
WHERE r.recipe_name = 'Simple Sourdough Focaccia' AND r.user_id IS NULL AND rs.step_order = 2;
INSERT INTO StageIngredient (recipe_step_id, ingredient_id, bakers_percentage, is_wet)
SELECT rs.recipe_step_id, 6, 0.025, FALSE -- Salt as StageIngredient still 0.025 (decimal for BP)
FROM RecipeStep rs JOIN Recipe r ON rs.recipe_id = r.recipe_id
WHERE r.recipe_name = 'Simple Sourdough Focaccia' AND r.user_id IS NULL AND rs.step_order = 2;


-- Recipe 3: Alexandra's Simple Artisan Loaf (Adapted)
INSERT INTO Recipe (user_id, recipe_name, description, target_weight, target_weight_unit_id, target_hydration, target_salt_pct, is_base_recipe) VALUES
(NULL, 'Alexandra''s Simple Artisan Loaf (Adapted)', 'A beginner-friendly approach to a classic artisan loaf with a good crust and open crumb.', 950, 1, 72, 2.0, TRUE); -- salt_pct: 2.0

-- ... (RecipeSteps for Recipe 3 remain the same, including levain target_hydration as 100) ...
-- ... (StageIngredients for Recipe 3 remain the same, salt bakers_percentage is 0.02) ...
INSERT INTO RecipeStep (recipe_id, step_id, step_order, contribution_pct, target_hydration, notes, duration_override, target_temperature_celsius, stretch_fold_interval_minutes) VALUES
((SELECT recipe_id FROM Recipe WHERE recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND user_id IS NULL), 1, 1, 0.20, 100, 'Prepare your levain until active and bubbly.', 300, 25, NULL),
((SELECT recipe_id FROM Recipe WHERE recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND user_id IS NULL), 2, 2, NULL, NULL, 'Combine main flour and most of the water. Mix until just combined and let rest.', 30, NULL, NULL),
((SELECT recipe_id FROM Recipe WHERE recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND user_id IS NULL), 3, 3, NULL, NULL, 'Add levain, salt, and remaining water. Mix thoroughly.', 15, NULL, NULL),
((SELECT recipe_id FROM Recipe WHERE recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND user_id IS NULL), 5, 4, NULL, NULL, 'Perform 3-4 sets of stretch and folds.', 240, 24, 45),
((SELECT recipe_id FROM Recipe WHERE recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND user_id IS NULL), 6, 5, NULL, NULL, 'Gently pre-shape, rest, then final shape the dough.', 20, NULL, NULL),
((SELECT recipe_id FROM Recipe WHERE recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND user_id IS NULL), 7, 6, NULL, NULL, 'Place in a banneton or bowl and cold proof in the refrigerator.', 720, 5, NULL),
((SELECT recipe_id FROM Recipe WHERE recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND user_id IS NULL), 8, 7, NULL, NULL, 'Bake in a preheated Dutch oven or on a baking stone.', 50, 240, NULL);

INSERT INTO StageIngredient (recipe_step_id, ingredient_id, bakers_percentage, is_wet)
SELECT rs.recipe_step_id, 1, 1.0, FALSE 
FROM RecipeStep rs JOIN Recipe r ON rs.recipe_id = r.recipe_id
WHERE r.recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND r.user_id IS NULL AND rs.step_order = 2;
INSERT INTO StageIngredient (recipe_step_id, ingredient_id, bakers_percentage, is_wet)
SELECT rs.recipe_step_id, 5, NULL, TRUE 
FROM RecipeStep rs JOIN Recipe r ON rs.recipe_id = r.recipe_id
WHERE r.recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND r.user_id IS NULL AND rs.step_order = 2;
INSERT INTO StageIngredient (recipe_step_id, ingredient_id, bakers_percentage, is_wet)
SELECT rs.recipe_step_id, 6, 0.02, FALSE -- Salt as StageIngredient still 0.02 (decimal for BP)
FROM RecipeStep rs JOIN Recipe r ON rs.recipe_id = r.recipe_id
WHERE r.recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND r.user_id IS NULL AND rs.step_order = 3;

SELECT 'Base recipes and their steps populated successfully with corrected hydration and salt percentages!' AS status;