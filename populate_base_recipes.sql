-- populate_base_recipes.sql

-- Delete existing base recipes and their components
-- (Ensuring cascade delete from Recipe to RecipeStep and then to StageIngredient handles this)
DELETE FROM "Recipe"
WHERE is_base_recipe = TRUE AND user_id IS NULL;

-- (Re)Insert Predefined Steps (ensure these are up-to-date with your schema.sql)
-- This part is usually in schema.sql, but if you run populate_base_recipes.sql standalone, ensure steps exist.
-- For brevity, I'll assume the Step table is already populated as per the schema.sql
-- Ensure you have at least these ingredient IDs (from your schema.sql defaults):
-- 1: Bread Flour
-- 2: Whole Wheat Flour
-- 3: Rye Flour
-- 4: All-Purpose Flour
-- 5: Water
-- 6: Salt
-- 7: Active Sourdough Starter (This is the inoculum for the levain, not part of the levain's flour bill usually)

-- Recipe 1: My First Loaf Tin Sourdough
INSERT INTO "Recipe" (user_id, recipe_name, description, target_weight, target_weight_unit_id, target_hydration, target_salt_pct, is_base_recipe) VALUES
(NULL, 'My First Loaf Tin Sourdough', 'A simple sourdough recipe perfect for beginners, baked in a loaf tin. Easy to handle, minimal shaping.', 900, 1, 75, 2.0, TRUE);

INSERT INTO "RecipeStep" (recipe_id, step_id, step_order, contribution_pct, target_hydration, notes, duration_override, target_temperature_celsius, stretch_fold_interval_minutes) VALUES
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'My First Loaf Tin Sourdough' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Levain Build'), 1, 20, 100, 'Build your levain. It should be active and bubbly.', 360, 24, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'My First Loaf Tin Sourdough' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Mix Final Dough'), 2, NULL, NULL, 'Combine levain, flour, water, and salt. Mix until no dry bits remain, then rest.', 20, NULL, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'My First Loaf Tin Sourdough' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Bulk Fermentation'), 3, NULL, NULL, 'Let dough rise. Perform 2-3 sets of gentle folds if comfortable, spread 30-45 mins apart.', 240, 24, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'My First Loaf Tin Sourdough' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Proofing'), 4, NULL, NULL, 'Gently shape and place in a loaf tin. Proof at room temperature.', 120, 24, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'My First Loaf Tin Sourdough' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Baking'), 5, NULL, NULL, 'Preheat oven with baking vessel if using. Bake until golden brown and cooked through.', 45, 230, NULL);

-- StageIngredients for 'My First Loaf Tin Sourdough'
-- Levain Build (step_order = 1)
INSERT INTO "StageIngredient" (recipe_step_id, ingredient_id, percentage, is_wet) VALUES
(
    (SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'My First Loaf Tin Sourdough' AND r.user_id IS NULL AND rs.step_order = 1),
    (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'Bread Flour'), -- Assuming Levain is 100% Bread Flour
    100.0, -- 100% of the levain's flour is Bread Flour
    FALSE
),
(
    (SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'My First Loaf Tin Sourdough' AND r.user_id IS NULL AND rs.step_order = 1),
    (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'Water'),
    100.0, -- 100% hydration for the levain (relative to levain's flour)
    TRUE
);
-- Note: The actual starter (inoculum) is implied by the 'Levain Build' step and RecipeStep.contribution_pct.
-- If you need to explicitly list the starter seed as an ingredient for the levain build, you'd add another row,
-- but its 'percentage' would need a different interpretation (e.g., % of levain's flour weight).

-- Mix Final Dough (step_order = 2)
INSERT INTO "StageIngredient" (recipe_step_id, ingredient_id, percentage, is_wet) VALUES
(
    (SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'My First Loaf Tin Sourdough' AND r.user_id IS NULL AND rs.step_order = 2),
    (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'Bread Flour'), -- Main dough flour
    100.0, -- 100% of the main dough's flour is Bread Flour
    FALSE
),
(
    (SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'My First Loaf Tin Sourdough' AND r.user_id IS NULL AND rs.step_order = 2),
    (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'Water'),
    NULL, -- Water for main dough; actual amount calculated by app to reach Recipe.target_hydration
    TRUE
),
(
    (SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'My First Loaf Tin Sourdough' AND r.user_id IS NULL AND rs.step_order = 2),
    (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'Salt'),
    2.0, -- Salt percentage (relative to final recipe's total flour, matching Recipe.target_salt_pct)
    FALSE
);
-- The Levain (from step_order = 1) is an input to this step. The application logic will handle this.
-- Optionally, you could add an entry for 'Active Sourdough Starter' (as an ingredient type) here if you want to represent the entire built levain as an ingredient being added.


-- Recipe 2: Simple Sourdough Focaccia
INSERT INTO "Recipe" (user_id, recipe_name, description, target_weight, target_weight_unit_id, target_hydration, target_salt_pct, is_base_recipe) VALUES
(NULL, 'Simple Sourdough Focaccia', 'A high-hydration, very forgiving focaccia. Great for using up starter and learning to handle wet dough.', 1000, 1, 80, 2.5, TRUE);

INSERT INTO "RecipeStep" (recipe_id, step_id, step_order, contribution_pct, target_hydration, notes, duration_override, target_temperature_celsius, stretch_fold_interval_minutes) VALUES
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'Simple Sourdough Focaccia' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Levain Build'), 1, 15, 100, 'Build your levain.', 360, 24, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'Simple Sourdough Focaccia' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Mix Final Dough'), 2, NULL, NULL, 'Gently mix all ingredients. Dough will be very wet. Add olive oil during mixing if desired (not included in core percentages).', 15, NULL, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'Simple Sourdough Focaccia' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Bulk Fermentation with Stretch and Fold'), 3, NULL, NULL, 'Perform 3-4 sets of stretch and folds in the bowl.', 180, 24, 30),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'Simple Sourdough Focaccia' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Proofing'), 4, NULL, NULL, 'Transfer to an oiled pan, gently stretch. Dimple generously with oiled fingers and add toppings if desired. Let proof.', 60, 24, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'Simple Sourdough Focaccia' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Baking'), 5, NULL, NULL, 'Bake in a hot oven until golden and bubbly.', 25, 220, NULL);

-- StageIngredients for 'Simple Sourdough Focaccia'
-- Levain Build (step_order = 1)
INSERT INTO "StageIngredient" (recipe_step_id, ingredient_id, percentage, is_wet) VALUES
(
    (SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'Simple Sourdough Focaccia' AND r.user_id IS NULL AND rs.step_order = 1),
    (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'All-Purpose Flour'),
    100.0,
    FALSE
),
(
    (SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'Simple Sourdough Focaccia' AND r.user_id IS NULL AND rs.step_order = 1),
    (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'Water'),
    100.0,
    TRUE
);

-- Mix Final Dough (step_order = 2)
INSERT INTO "StageIngredient" (recipe_step_id, ingredient_id, percentage, is_wet) VALUES
(
    (SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'Simple Sourdough Focaccia' AND r.user_id IS NULL AND rs.step_order = 2),
    (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'All-Purpose Flour'),
    100.0,
    FALSE
),
(
    (SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'Simple Sourdough Focaccia' AND r.user_id IS NULL AND rs.step_order = 2),
    (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'Water'),
    NULL,
    TRUE
),
(
    (SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'Simple Sourdough Focaccia' AND r.user_id IS NULL AND rs.step_order = 2),
    (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'Salt'),
    2.5,
    FALSE
);

-- Recipe 3: Alexandra's Simple Artisan Loaf (Adapted)
INSERT INTO "Recipe" (user_id, recipe_name, description, target_weight, target_weight_unit_id, target_hydration, target_salt_pct, is_base_recipe) VALUES
(NULL, 'Alexandra''s Simple Artisan Loaf (Adapted)', 'A beginner-friendly approach to a classic artisan loaf with a good crust and open crumb.', 950, 1, 72, 2.0, TRUE);

INSERT INTO "RecipeStep" (recipe_id, step_id, step_order, contribution_pct, target_hydration, notes, duration_override, target_temperature_celsius, stretch_fold_interval_minutes) VALUES
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Levain Build'), 1, 20, 100, 'Prepare your levain until active and bubbly.', 300, 25, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Autolyse'), 2, NULL, NULL, 'Combine main flour and most of the water. Mix until just combined and let rest.', 30, NULL, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Mix Final Dough'), 3, NULL, NULL, 'Add levain, salt, and remaining water. Mix thoroughly.', 15, NULL, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Bulk Fermentation with Stretch and Fold'), 4, NULL, NULL, 'Perform 3-4 sets of stretch and folds.', 240, 24, 45),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Pre-shaping'), 5, NULL, NULL, 'Gently pre-shape the dough.', 10, NULL, NULL), -- Assuming Pre-shaping is a new Step
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Bench Rest'), 6, NULL, NULL, 'Rest dough after pre-shaping.', 20, 24, NULL), -- Assuming Bench Rest is a new Step
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Shaping'), 7, NULL, NULL, 'Final shape the dough.', 15, NULL, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Proofing'), 8, NULL, NULL, 'Place in a banneton or bowl and cold proof in the refrigerator.', 720, 5, NULL),
((SELECT recipe_id FROM "Recipe" WHERE recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND user_id IS NULL), (SELECT step_id FROM "Step" WHERE step_name = 'Baking'), 9, NULL, NULL, 'Bake in a preheated Dutch oven or on a baking stone.', 50, 240, NULL);

-- StageIngredients for 'Alexandra''s Simple Artisan Loaf (Adapted)'
-- Levain Build (step_order = 1)
INSERT INTO "StageIngredient" (recipe_step_id, ingredient_id, percentage, is_wet) VALUES
(
    (SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND r.user_id IS NULL AND rs.step_order = 1),
    (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'Bread Flour'), -- Assuming 100% Bread Flour Levain
    100.0,
    FALSE
),
(
    (SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND r.user_id IS NULL AND rs.step_order = 1),
    (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'Water'),
    100.0,
    TRUE
);

-- Autolyse (step_order = 2) - Flours for autolyse are part of the main dough's flour bill.
-- This step defines WHICH flours (from the main dough bill) and HOW MUCH water are used FOR THE AUTOLYSE.
-- For this base recipe, we'll assume it uses 100% of the main dough's Bread Flour in the autolyse.
INSERT INTO "StageIngredient" (recipe_step_id, ingredient_id, percentage, is_wet) VALUES
(
    (SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND r.user_id IS NULL AND rs.step_order = 2),
    (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'Bread Flour'),
    100.0, -- This means 100% of the flour *involved in the autolyse step* is Bread Flour.
           -- The actual *amount* of this bread flour will be determined by the calculation engine
           -- based on main dough requirements minus levain flour.
    FALSE
),
(
    (SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND r.user_id IS NULL AND rs.step_order = 2),
    (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'Water'),
    NULL, -- Water for autolyse; amount calculated by app.
    TRUE
);


-- Mix Final Dough (step_order = 3) - This step defines the main dough's flour bill and adds other ingredients.
-- For this recipe, the flour is already accounted for in the Autolyse step's definition.
-- This step primarily adds levain, salt, and any remaining water.
-- If the main dough had a *different* flour blend than what was autolysed, you'd define those flours here.
-- For this base recipe, let's assume the "Mix Final Dough" step defines the overall main dough flour bill,
-- and the "Autolyse" references a portion of it.

-- To keep it simpler for now and align with the idea that "Mix Final Dough" might be where main flours are declared:
-- We'll add the main flour definition to the "Mix Final Dough" step (order 3 for this recipe)
-- And the Autolyse (order 2) will be a process using these.
-- (This part needs careful thought in the app logic: how to specify autolyse flours if they are a subset of main dough flours)

-- Let's define the main dough flour for "Alexandra's Loaf" in its "Mix Final Dough" step (step_order = 3)
INSERT INTO "StageIngredient" (recipe_step_id, ingredient_id, percentage, is_wet) VALUES
(
    (SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND r.user_id IS NULL AND rs.step_order = 3),
    (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'Bread Flour'),
    100.0, -- Main dough is 100% Bread Flour
    FALSE
),
(
    (SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND r.user_id IS NULL AND rs.step_order = 3),
    (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'Salt'),
    2.0, -- Salt percentage
    FALSE
),
(
    (SELECT rs.recipe_step_id FROM "RecipeStep" rs JOIN "Recipe" r ON rs.recipe_id = r.recipe_id WHERE r.recipe_name = 'Alexandra''s Simple Artisan Loaf (Adapted)' AND r.user_id IS NULL AND rs.step_order = 3),
    (SELECT ingredient_id FROM "Ingredient" WHERE ingredient_name = 'Water'),
    NULL, -- Main dough water, calculated by app
    TRUE
);
-- The Autolyse step (step_order = 2) would then conceptually use a portion of the flour and water
-- defined for the main dough (step_order = 3). The application logic for calculation
-- will need to handle this relationship if users can customize autolyse percentages.
-- For base recipes, we assume autolyse uses all flour defined in the main mix step with some of its water.


SELECT 'Base recipes and their steps populated successfully with updated percentage handling!' AS status;