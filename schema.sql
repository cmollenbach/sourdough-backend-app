-- schema.sql

-- Clear any existing tables (optional, for a clean slate during development)
-- BE CAREFUL with these lines in production or if you want to preserve data!
DROP TABLE IF EXISTS "StageIngredient" CASCADE;
DROP TABLE IF EXISTS "UserBakeStepLog" CASCADE;
DROP TABLE IF EXISTS "UserBakeLog" CASCADE;
DROP TABLE IF EXISTS "RecipeStep" CASCADE;
DROP TABLE IF EXISTS "Step" CASCADE;
DROP TABLE IF EXISTS "Recipe" CASCADE;
DROP TABLE IF EXISTS "Ingredient" CASCADE;
DROP TABLE IF EXISTS "Unit" CASCADE;
DROP TABLE IF EXISTS "User" CASCADE;

-- 1. User Table
CREATE TABLE "User" (
    user_id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT,
    google_id TEXT UNIQUE,
    auth_provider TEXT NOT NULL, -- e.g., 'email', 'google'
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE "User" IS 'Stores information about users who register in the app.';
COMMENT ON COLUMN "User".password_hash IS 'Hashed password for users signing up with email/password. NULL for OAuth users.';
COMMENT ON COLUMN "User".google_id IS 'Unique identifier from Google for users signing in with Google.';

-- 2. Unit Table
CREATE TABLE "Unit" (
    unit_id SERIAL PRIMARY KEY,
    unit_name TEXT UNIQUE NOT NULL, -- e.g., 'grams', 'ounces', 'milliliters'
    unit_abbreviation TEXT UNIQUE NOT NULL, -- e.g., 'g', 'oz', 'ml'
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE "Unit" IS 'Stores units of measurement.';

-- 3. Ingredient Table
CREATE TABLE "Ingredient" (
    ingredient_id SERIAL PRIMARY KEY,
    ingredient_name TEXT UNIQUE NOT NULL, -- e.g., 'Bread Flour', 'Water', 'Salt'
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE "Ingredient" IS 'Stores information about ingredients.';

-- 4. Recipe Table
CREATE TABLE "Recipe" (
    recipe_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES "User"(user_id) ON DELETE SET NULL,
    recipe_name TEXT NOT NULL,
    description TEXT,
    target_weight REAL NOT NULL,
    target_weight_unit_id INTEGER NOT NULL REFERENCES "Unit"(unit_id),
    target_hydration REAL NOT NULL,
    target_salt_pct REAL NOT NULL,
    is_base_recipe BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_recipe_name UNIQUE (user_id, recipe_name)
);

COMMENT ON TABLE "Recipe" IS 'Stores overall information and targets for each recipe.';
COMMENT ON COLUMN "Recipe".user_id IS 'ID of the user who created the recipe. NULL for base recipes.';
COMMENT ON COLUMN "Recipe".is_base_recipe IS 'TRUE if this is a predefined template, FALSE if user-created/customized.';

CREATE UNIQUE INDEX idx_uq_base_recipe_name ON "Recipe" (recipe_name) WHERE (user_id IS NULL);

-- 5. Step Table
CREATE TABLE "Step" (
    step_id SERIAL PRIMARY KEY,
    step_name TEXT UNIQUE NOT NULL,
    description TEXT,
    step_type TEXT NOT NULL,
    duration_minutes INTEGER,
    is_predefined BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE "Step" IS 'Defines types or categories of recipe steps.';
COMMENT ON COLUMN "Step".step_name IS 'Name of the step (e.g., "Mix Levain").';
COMMENT ON COLUMN "Step".step_type IS 'General category for the step.';
COMMENT ON COLUMN "Step".duration_minutes IS 'Default duration for this type of step, in minutes.';
COMMENT ON COLUMN "Step".is_predefined IS 'Indicates if this is a system-provided step definition.';

-- 6. RecipeStep Table
CREATE TABLE "RecipeStep" (
    recipe_step_id SERIAL PRIMARY KEY,
    recipe_id INTEGER NOT NULL REFERENCES "Recipe"(recipe_id) ON DELETE CASCADE,
    step_id INTEGER NOT NULL REFERENCES "Step"(step_id) ON DELETE RESTRICT,
    step_order INTEGER NOT NULL,
    contribution_pct REAL,
    target_hydration REAL,
    notes TEXT,
    duration_override INTEGER,
    target_temperature_celsius REAL,
    stretch_fold_interval_minutes INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_recipe_step_order UNIQUE (recipe_id, step_order)
);

COMMENT ON TABLE "RecipeStep" IS 'Links a Recipe to a Step, defining a specific instance of a step within a recipe.';
COMMENT ON COLUMN "RecipeStep".contribution_pct IS 'For starter: % of prefermented flour. For other additions: % of that ingredient.';
COMMENT ON COLUMN "RecipeStep".target_hydration IS 'For starter: its internal hydration. For soakers/other: hydration of that component.';
COMMENT ON COLUMN "RecipeStep".duration_override IS 'User-defined duration for this specific recipe step, in minutes.';
COMMENT ON COLUMN "RecipeStep".target_temperature_celsius IS 'Target temperature for this step, if applicable.';
COMMENT ON COLUMN "RecipeStep".stretch_fold_interval_minutes IS 'Interval for stretch and folds, if applicable.';

-- 7. StageIngredient Table
CREATE TABLE "StageIngredient" (
    stage_ingredient_id SERIAL PRIMARY KEY,
    recipe_step_id INTEGER NOT NULL REFERENCES "RecipeStep"(recipe_step_id) ON DELETE CASCADE,
    ingredient_id INTEGER NOT NULL REFERENCES "Ingredient"(ingredient_id) ON DELETE RESTRICT,
    bakers_percentage REAL,
    calculated_weight REAL,
    is_wet BOOLEAN NOT NULL,
    split_percentage REAL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_recipe_step_ingredient UNIQUE (recipe_step_id, ingredient_id)
);

COMMENT ON TABLE "StageIngredient" IS 'Details each ingredient used in a specific RecipeStep.';
COMMENT ON COLUMN "StageIngredient".bakers_percentage IS 'Bakers percentage relative to total flour in the recipe.';
COMMENT ON COLUMN "StageIngredient".calculated_weight IS 'Calculated by the application.';
COMMENT ON COLUMN "StageIngredient".is_wet IS 'Important for hydration calculations.';
COMMENT ON COLUMN "StageIngredient".split_percentage IS 'For ingredients split across additions within the same stage.';

-- 8. UserBakeLog Table
CREATE TABLE "UserBakeLog" (
    bake_log_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES "User"(user_id) ON DELETE CASCADE,
    recipe_id INTEGER NOT NULL REFERENCES "Recipe"(recipe_id) ON DELETE CASCADE,
    bake_start_timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    bake_end_timestamp TIMESTAMPTZ,
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- e.g., 'active', 'paused', 'completed', 'abandoned'
    user_overall_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE "UserBakeLog" IS 'Stores a log for each time a user initiates a guided bake.';
COMMENT ON COLUMN "UserBakeLog".status IS 'Current status of the baking session.';

-- 9. UserBakeStepLog Table
CREATE TABLE "UserBakeStepLog" (
    bake_step_log_id SERIAL PRIMARY KEY,
    bake_log_id INTEGER NOT NULL REFERENCES "UserBakeLog"(bake_log_id) ON DELETE CASCADE,
    recipe_step_id INTEGER NOT NULL REFERENCES "RecipeStep"(recipe_step_id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL,
    step_name TEXT,
    planned_duration_minutes INTEGER,
    actual_start_timestamp TIMESTAMPTZ NOT NULL,
    actual_end_timestamp TIMESTAMPTZ,
    user_step_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE "UserBakeStepLog" IS 'Stores actual timings and user notes for each step in a UserBakeLog.';
COMMENT ON COLUMN "UserBakeStepLog".recipe_step_id IS 'FK to the specific step definition in RecipeStep.';

-- Indexes for UserBakeLog and UserBakeStepLog
CREATE INDEX idx_userbakelog_user_status ON "UserBakeLog"(user_id, status);
CREATE INDEX idx_userbakesteplog_bakelog_order ON "UserBakeStepLog"(bake_log_id, step_order);

-- Pre-populate essential lookup data

-- Units
INSERT INTO "Unit" (unit_name, unit_abbreviation) VALUES
('grams', 'g'),
('ounces', 'oz'),
('milliliters', 'ml'),
('liters', 'l'),
('teaspoons', 'tsp'),
('tablespoons', 'tbsp')
ON CONFLICT (unit_name) DO NOTHING;

-- Ingredients (basic set)
INSERT INTO "Ingredient" (ingredient_name) VALUES
('Bread Flour'),
('Whole Wheat Flour'),
('Rye Flour'),
('All-Purpose Flour'),
('Water'),
('Salt'),
('Active Sourdough Starter')
ON CONFLICT (ingredient_name) DO NOTHING;

-- Predefined Steps
INSERT INTO "Step" (step_name, step_type, description, is_predefined, duration_minutes) VALUES
('Levain Build', 'Levain', 'Build and ferment the levain (sourdough starter pre-ferment).', TRUE, NULL),
('Autolyse', 'Mixing', 'Resting flour and water before adding other ingredients.', TRUE, 30),
('Mix Final Dough', 'Mixing', 'Combine all ingredients for the final dough.', TRUE, 15),
('Bulk Fermentation', 'Fermentation', 'First rise of the dough, often with folds.', TRUE, 240),
('Bulk Fermentation with Stretch and Fold', 'Fermentation', 'Main fermentation period with periodic stretch and folds.', TRUE, 240),
('Shaping', 'Shaping', 'Shape the dough into its final form.', TRUE, 15),
('Proofing', 'Fermentation', 'Final rise of the shaped dough (can be at room temp or cold).', TRUE, 120),
('Baking', 'Baking', 'Bake the bread.', TRUE, 45)
ON CONFLICT (step_name) DO NOTHING;

SELECT 'Database schema created and initial data populated successfully (or skipped if conflicting)!' AS status;