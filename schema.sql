-- schema.sql

-- Clear any existing tables (optional, for a clean slate during development)
-- Be careful with these lines in production!
DROP TABLE IF EXISTS StageIngredient CASCADE;
DROP TABLE IF EXISTS RecipeStep CASCADE;
DROP TABLE IF EXISTS Step CASCADE;
DROP TABLE IF EXISTS Recipe CASCADE; -- Will also drop idx_uq_base_recipe_name if it exists from a partial previous run
DROP TABLE IF EXISTS Ingredient CASCADE;
DROP TABLE IF EXISTS Unit CASCADE;
DROP TABLE IF EXISTS "User" CASCADE;

-- 1. User Table (Simplified for Phase 1)
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
CREATE TABLE Unit (
    unit_id SERIAL PRIMARY KEY,
    unit_name TEXT UNIQUE NOT NULL, -- e.g., 'grams', 'ounces', 'milliliters'
    unit_abbreviation TEXT UNIQUE NOT NULL, -- e.g., 'g', 'oz', 'ml'
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE Unit IS 'Stores units of measurement.';

-- 3. Ingredient Table
CREATE TABLE Ingredient (
    ingredient_id SERIAL PRIMARY KEY,
    ingredient_name TEXT UNIQUE NOT NULL, -- e.g., 'Bread Flour', 'Water', 'Salt'
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE Ingredient IS 'Stores information about ingredients.';

-- 4. Recipe Table
CREATE TABLE Recipe (
    recipe_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES "User"(user_id) ON DELETE SET NULL, -- Can be NULL for base/template recipes
    recipe_name TEXT NOT NULL,
    description TEXT,
    target_weight REAL NOT NULL, -- e.g., 900 (grams)
    target_weight_unit_id INTEGER NOT NULL REFERENCES Unit(unit_id),
    target_hydration REAL NOT NULL, -- e.g., 0.75 (for 75%)
    target_salt_pct REAL NOT NULL, -- e.g., 0.02 (for 2%)
    is_base_recipe BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_recipe_name UNIQUE (user_id, recipe_name) -- User cannot have multiple recipes with the same name
);

COMMENT ON TABLE Recipe IS 'Stores overall information and targets for each recipe.';
COMMENT ON COLUMN Recipe.user_id IS 'ID of the user who created the recipe. NULL for base recipes.';
COMMENT ON COLUMN Recipe.is_base_recipe IS 'TRUE if this is a predefined template, FALSE if user-created/customized.';

-- Ensure base recipe names are unique
CREATE UNIQUE INDEX idx_uq_base_recipe_name ON Recipe (recipe_name) WHERE (user_id IS NULL);

-- 5. Step Table (Defines types of recipe steps)
CREATE TABLE Step (
    step_id SERIAL PRIMARY KEY,
    step_name TEXT UNIQUE NOT NULL, -- e.g., "Mix Levain", "Bulk Ferment with S&F", "Bake"
    description TEXT,
    step_type TEXT NOT NULL, -- More general category, e.g., "Levain", "Mixing", "Fermentation", "Shaping", "Baking"
    duration_minutes INTEGER, -- Default or typical duration for this type of step, in minutes. Can be overridden in RecipeStep.
    is_predefined BOOLEAN NOT NULL DEFAULT FALSE, -- True if this is a system-defined step type
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE Step IS 'Defines types or categories of recipe steps (e.g., "Levain," "Bulk Fermentation").';
COMMENT ON COLUMN Step.step_name IS 'Name of the step (e.g., "Mix Levain," "Bulk Ferment"). This can be more specific than step_type.';
COMMENT ON COLUMN Step.step_type IS 'General category for the step, useful for grouping or logic.';
COMMENT ON COLUMN Step.duration_minutes IS 'Default or typical duration for this type of step, in minutes.';
COMMENT ON COLUMN Step.is_predefined IS 'Indicates if this is a system-provided step definition.';

-- 6. RecipeStep Table (Links Recipe to Step, specific instance of a step in a recipe)
CREATE TABLE RecipeStep (
    recipe_step_id SERIAL PRIMARY KEY,
    recipe_id INTEGER NOT NULL REFERENCES Recipe(recipe_id) ON DELETE CASCADE,
    step_id INTEGER NOT NULL REFERENCES Step(step_id) ON DELETE RESTRICT, -- Don't delete a Step if it's used
    step_order INTEGER NOT NULL,
    contribution_pct REAL, -- For starter: % of prefermented flour. For other additions: % of that ingredient.
    target_hydration REAL, -- For starter: its internal hydration. For soakers/other: hydration of that component.
    notes TEXT,
    duration_override INTEGER, -- User-defined duration for this specific recipe step, in minutes.
    target_temperature_celsius REAL,
    stretch_fold_interval_minutes INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_recipe_step_order UNIQUE (recipe_id, step_order)
);

COMMENT ON TABLE RecipeStep IS 'Links a Recipe to a Step, defining a specific instance of a step within a recipe, its order, and stage-specific targets. This effectively represents a "stage" in a recipe.';
COMMENT ON COLUMN RecipeStep.contribution_pct IS 'Percentage contribution of this step (and its ingredients) to the final dough weight. For starter, this is the starter percentage (prefermented flour as % of total flour).';
COMMENT ON COLUMN RecipeStep.target_hydration IS 'Target hydration for this specific step/stage. For starter, this is its internal hydration.';
COMMENT ON COLUMN RecipeStep.duration_override IS 'User-defined duration for this specific recipe step, in minutes. For "Bulk Fermentation with S&F", this represents the total bulk fermentation time.';
COMMENT ON COLUMN RecipeStep.target_temperature_celsius IS 'Target temperature for this specific recipe step, if applicable (e.g., in Celsius).';
COMMENT ON COLUMN RecipeStep.stretch_fold_interval_minutes IS 'Interval in minutes for performing stretch and folds during bulk fermentation, if applicable to the step type.';

-- 7. StageIngredient Table (Details ingredients for a specific RecipeStep)
CREATE TABLE StageIngredient (
    stage_ingredient_id SERIAL PRIMARY KEY,
    recipe_step_id INTEGER NOT NULL REFERENCES RecipeStep(recipe_step_id) ON DELETE CASCADE,
    ingredient_id INTEGER NOT NULL REFERENCES Ingredient(ingredient_id) ON DELETE RESTRICT, -- Don't delete Ingredient if used
    bakers_percentage REAL, -- Baker's percentage relative to total flour in the recipe
    calculated_weight REAL, -- To be calculated by the application
    is_wet BOOLEAN NOT NULL, -- Important for hydration calculations (e.g. water, milk are TRUE; flour, salt are FALSE)
    split_percentage REAL, -- For ingredients that are split across additions within the same conceptual stage, if needed later.
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_recipe_step_ingredient UNIQUE (recipe_step_id, ingredient_id) -- An ingredient should only appear once per step stage.
);

COMMENT ON TABLE StageIngredient IS 'Details each ingredient used in a specific RecipeStep (i.e., a stage of a recipe).';
COMMENT ON COLUMN StageIngredient.bakers_percentage IS 'Bakers percentage of this ingredient, relative to total flour in the recipe.';
COMMENT ON COLUMN StageIngredient.calculated_weight IS 'Calculated weight of the ingredient based on recipe targets and stage contribution. Populated dynamically by the application.';
COMMENT ON COLUMN StageIngredient.is_wet IS 'Indicates if the ingredient contributes to the hydration calculation (e.g., water is true, flour is false).';
COMMENT ON COLUMN StageIngredient.split_percentage IS 'If an ingredient is added in parts within one stage, this could denote the portion. Default to 1 (or NULL) if added all at once.';

-- Pre-populate essential lookup data

-- Units
INSERT INTO Unit (unit_name, unit_abbreviation) VALUES
('grams', 'g'),
('ounces', 'oz'),
('milliliters', 'ml'),
('liters', 'l'),
('teaspoons', 'tsp'),
('tablespoons', 'tbsp');

-- Ingredients (basic set)
INSERT INTO Ingredient (ingredient_name) VALUES
('Bread Flour'),
('Whole Wheat Flour'),
('Rye Flour'),
('All-Purpose Flour'),
('Water'),
('Salt'),
('Active Sourdough Starter');
-- Consider adding 'Olive Oil' if commonly used in recipes like Focaccia, or handle as an 'addition'

-- Predefined Steps
INSERT INTO Step (step_name, step_type, description, is_predefined, duration_minutes) VALUES
('Levain Build', 'Levain', 'Build and ferment the levain (sourdough starter pre-ferment).', TRUE, NULL),
('Autolyse', 'Mixing', 'Resting flour and water before adding other ingredients.', TRUE, 30),
('Mix Final Dough', 'Mixing', 'Combine all ingredients for the final dough.', TRUE, 15),
('Bulk Fermentation', 'Fermentation', 'First rise of the dough, often with folds.', TRUE, 240),
('Bulk Fermentation with Stretch and Fold', 'Fermentation', 'Main fermentation period with periodic stretch and folds.', TRUE, 240),
('Shaping', 'Shaping', 'Shape the dough into its final form.', TRUE, 15),
('Proofing', 'Fermentation', 'Final rise of the shaped dough (can be at room temp or cold).', TRUE, 120),
('Baking', 'Baking', 'Bake the bread.', TRUE, 45);

SELECT 'Database schema created and initial data populated successfully!' AS status;