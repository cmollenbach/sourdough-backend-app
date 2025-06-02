-- Assign test recipes and bakes to existing user: test@home.com

DO $$
DECLARE
  test_user_id INT;
  quick_loaf_id INT;
  mini_loaf_id INT;
  bake2_id INT;
  bake3_id INT;
BEGIN
  -- Get user_id for test@home.com
  SELECT user_id INTO test_user_id FROM "User" WHERE username = 'test@home.com';

  -- Create 2 test recipes for test@home.com
  INSERT INTO "Recipe" (user_id, recipe_name, description, target_weight, target_weight_unit_id, target_hydration, target_salt_pct, is_base_recipe)
  VALUES
    (test_user_id, 'Quick Test Loaf', 'A short, test-friendly loaf.', 500, (SELECT unit_id FROM "Unit" WHERE unit_abbreviation = 'g'), 70, 2.0, FALSE),
    (test_user_id, 'Mini Sourdough', 'A mini loaf for testing.', 300, (SELECT unit_id FROM "Unit" WHERE unit_abbreviation = 'g'), 65, 2.5, FALSE)
  ON CONFLICT DO NOTHING;

  -- Get recipe_ids
  SELECT recipe_id INTO quick_loaf_id FROM "Recipe" WHERE recipe_name = 'Quick Test Loaf' AND user_id = test_user_id;
  SELECT recipe_id INTO mini_loaf_id FROM "Recipe" WHERE recipe_name = 'Mini Sourdough' AND user_id = test_user_id;

  -- Add steps for Quick Test Loaf (short durations for testing)
  INSERT INTO "RecipeStep" (recipe_id, step_id, step_order, contribution_pct, target_hydration, notes, duration_override)
  VALUES
    (quick_loaf_id, (SELECT step_id FROM "Step" WHERE step_name = 'Levain Build'), 1, 10, 100, 'Quick levain.', 10),
    (quick_loaf_id, (SELECT step_id FROM "Step" WHERE step_name = 'Mix Final Dough'), 2, NULL, NULL, 'Mix all.', 5),
    (quick_loaf_id, (SELECT step_id FROM "Step" WHERE step_name = 'Bulk Fermentation'), 3, NULL, NULL, 'Bulk rise.', 15),
    (quick_loaf_id, (SELECT step_id FROM "Step" WHERE step_name = 'Baking'), 4, NULL, NULL, 'Bake.', 10)
  ON CONFLICT DO NOTHING;

  -- Add steps for Mini Sourdough
  INSERT INTO "RecipeStep" (recipe_id, step_id, step_order, contribution_pct, target_hydration, notes, duration_override)
  VALUES
    (mini_loaf_id, (SELECT step_id FROM "Step" WHERE step_name = 'Levain Build'), 1, 15, 100, 'Mini levain.', 8),
    (mini_loaf_id, (SELECT step_id FROM "Step" WHERE step_name = 'Mix Final Dough'), 2, NULL, NULL, 'Mix.', 4),
    (mini_loaf_id, (SELECT step_id FROM "Step" WHERE step_name = 'Baking'), 3, NULL, NULL, 'Bake.', 7)
  ON CONFLICT DO NOTHING;

  -- Bake 1: Quick Test Loaf, at step 1 (active)
  INSERT INTO "UserBakeLog" (user_id, recipe_id, status, bake_start_timestamp)
  VALUES (test_user_id, quick_loaf_id, 'active', NOW());
  -- Get bake_log_id for Bake 1
  SELECT bake_log_id INTO bake2_id FROM "UserBakeLog" WHERE user_id = test_user_id AND recipe_id = quick_loaf_id ORDER BY bake_log_id DESC LIMIT 1;
  -- Insert active step (step 1, started but not finished)
  INSERT INTO "UserBakeStepLog" (bake_log_id, recipe_step_id, step_order, step_name, planned_duration_minutes, actual_start_timestamp)
  SELECT bake2_id, recipe_step_id, step_order, 'Levain Build', 10, NOW()
  FROM "RecipeStep" WHERE recipe_id = quick_loaf_id AND step_order = 1;

  -- Bake 2: Quick Test Loaf, at step 3 (steps 1 and 2 completed, step 3 active)
  INSERT INTO "UserBakeLog" (user_id, recipe_id, status, bake_start_timestamp)
  VALUES (test_user_id, quick_loaf_id, 'active', NOW() - INTERVAL '1 hour');
  SELECT bake_log_id INTO bake2_id FROM "UserBakeLog" WHERE user_id = test_user_id AND recipe_id = quick_loaf_id ORDER BY bake_log_id DESC LIMIT 1;
  -- Complete steps 1 and 2
  INSERT INTO "UserBakeStepLog" (bake_log_id, recipe_step_id, step_order, step_name, planned_duration_minutes, actual_start_timestamp, actual_end_timestamp)
  SELECT bake2_id, recipe_step_id, step_order, 'Levain Build', 10, NOW() - INTERVAL '55 min', NOW() - INTERVAL '50 min'
  FROM "RecipeStep" WHERE recipe_id = quick_loaf_id AND step_order = 1;
  INSERT INTO "UserBakeStepLog" (bake_log_id, recipe_step_id, step_order, step_name, planned_duration_minutes, actual_start_timestamp, actual_end_timestamp)
  SELECT bake2_id, recipe_step_id, step_order, 'Mix Final Dough', 5, NOW() - INTERVAL '50 min', NOW() - INTERVAL '45 min'
  FROM "RecipeStep" WHERE recipe_id = quick_loaf_id AND step_order = 2;
  -- Insert active step (step 3, started but not finished)
  INSERT INTO "UserBakeStepLog" (bake_log_id, recipe_step_id, step_order, step_name, planned_duration_minutes, actual_start_timestamp)
  SELECT bake2_id, recipe_step_id, step_order, 'Bulk Fermentation', 15, NOW() - INTERVAL '45 min'
  FROM "RecipeStep" WHERE recipe_id = quick_loaf_id AND step_order = 3;

  -- Bake 3: Mini Sourdough, at step 2 (step 1 completed, step 2 active)
  INSERT INTO "UserBakeLog" (user_id, recipe_id, status, bake_start_timestamp)
  VALUES (test_user_id, mini_loaf_id, 'active', NOW() - INTERVAL '30 min');
  SELECT bake_log_id INTO bake3_id FROM "UserBakeLog" WHERE user_id = test_user_id AND recipe_id = mini_loaf_id ORDER BY bake_log_id DESC LIMIT 1;
  -- Complete step 1
  INSERT INTO "UserBakeStepLog" (bake_log_id, recipe_step_id, step_order, step_name, planned_duration_minutes, actual_start_timestamp, actual_end_timestamp)
  SELECT bake3_id, recipe_step_id, step_order, 'Levain Build', 8, NOW() - INTERVAL '28 min', NOW() - INTERVAL '20 min'
  FROM "RecipeStep" WHERE recipe_id = mini_loaf_id AND step_order = 1;
  -- Insert active step (step 2, started but not finished)
  INSERT INTO "UserBakeStepLog" (bake_log_id, recipe_step_id, step_order, step_name, planned_duration_minutes, actual_start_timestamp)
  SELECT bake3_id, recipe_step_id, step_order, 'Mix Final Dough', 4, NOW() - INTERVAL '20 min'
  FROM "RecipeStep" WHERE recipe_id = mini_loaf_id AND step_order = 2;

END $$ LANGUAGE plpgsql;