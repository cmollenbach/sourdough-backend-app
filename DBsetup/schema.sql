-- schema.sql

-- Drop tables for a clean slate (optional, for development only)
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
    auth_provider TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE "User" IS 'Stores information about users who register in the app.';
COMMENT ON COLUMN "User".user_id IS 'Unique identifier for the user.';
COMMENT ON COLUMN "User".username IS 'User-chosen unique username.';
COMMENT ON COLUMN "User".email IS 'User''s email address, unique if provided.';
COMMENT ON COLUMN "User".password_hash IS 'Hashed password for users signing up with email/password. NULL for OAuth users.';
COMMENT ON COLUMN "User".google_id IS 'Unique identifier from Google for users signing in with Google.';
COMMENT ON COLUMN "User".auth_provider IS 'Indicates the authentication method used (e.g., ''email'', ''google'').';
COMMENT ON COLUMN "User".created_at IS 'Timestamp of when the user account was created.';
COMMENT ON COLUMN "User".updated_at IS 'Timestamp of the last update to the user account.';

-- 2. Unit Table
CREATE TABLE "Unit" (
    unit_id SERIAL PRIMARY KEY,
    unit_name TEXT UNIQUE NOT NULL, -- e.g., 'grams', 'ounces', 'milliliters'
    unit_abbreviation TEXT UNIQUE NOT NULL, -- e.g., 'g', 'oz', 'ml'
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE "Unit" IS 'Stores units of measurement.';
COMMENT ON COLUMN "Unit".unit_id IS 'Unique identifier for the unit.';
COMMENT ON COLUMN "Unit".unit_name IS 'Full name of the unit (e.g., ''grams'').';
COMMENT ON COLUMN "Unit".unit_abbreviation IS 'Abbreviation for the unit (e.g., ''g'').';
COMMENT ON COLUMN "Unit".created_at IS 'Timestamp of when the unit was created.';

-- 3. Ingredient Table
CREATE TABLE "Ingredient" (
    ingredient_id SERIAL PRIMARY KEY,
    ingredient_name TEXT UNIQUE NOT NULL, -- e.g., 'Bread Flour', 'Water', 'Salt'
    is_wet BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE if the ingredient is primarily a liquid and contributes to hydration
    is_advanced BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE "Ingredient" IS 'Stores information about ingredients, including various flour types and their hydration properties.';
COMMENT ON COLUMN "Ingredient".ingredient_id IS 'Unique identifier for the ingredient.';
COMMENT ON COLUMN "Ingredient".ingredient_name IS 'Name of the ingredient (e.g., ''Bread Flour'', ''Water'', ''Salt'').';
COMMENT ON COLUMN "Ingredient".is_wet IS 'TRUE if the ingredient is primarily a liquid and contributes to hydration (e.g., water, milk). FALSE for dry ingredients like flour, salt.';
COMMENT ON COLUMN "Ingredient".created_at IS 'Timestamp of when the ingredient was created.';
COMMENT ON COLUMN "Ingredient".updated_at IS 'Timestamp of the last update to the ingredient information.';
COMMENT ON COLUMN "Ingredient".is_advanced IS 'TRUE if this ingredient is considered advanced and should be hidden in simplified view.';

-- 4. Recipe Table
CREATE TABLE "Recipe" (
    recipe_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES "User"(user_id) ON DELETE SET NULL,
    recipe_name TEXT NOT NULL,
    description TEXT,
    target_weight REAL NOT NULL,
    target_weight_unit_id INTEGER NOT NULL REFERENCES "Unit"(unit_id),
    target_hydration REAL NOT NULL, -- Represents final dough hydration
    target_salt_pct REAL NOT NULL, -- Represents salt % of total flour in final dough
    is_base_recipe BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_recipe_name UNIQUE (user_id, recipe_name)
);

COMMENT ON TABLE "Recipe" IS 'Stores overall information and targets for each recipe. Hydration and salt percentages apply to the final dough characteristics after all components (like preferments) are incorporated.';
COMMENT ON COLUMN "Recipe".recipe_id IS 'Unique identifier for the recipe.';
COMMENT ON COLUMN "Recipe".user_id IS 'ID of the user who created or owns the recipe. NULL for system-defined base/template recipes.';
COMMENT ON COLUMN "Recipe".recipe_name IS 'Name of the recipe. Must be unique per user if user_id is not NULL, and unique overall for base recipes (where user_id IS NULL).';
COMMENT ON COLUMN "Recipe".description IS 'Optional longer description of the recipe, its characteristics, or notes.';
COMMENT ON COLUMN "Recipe".target_weight IS 'Desired total weight of the final baked product(s).';
COMMENT ON COLUMN "Recipe".target_weight_unit_id IS 'Foreign key to the Unit table for the target_weight (e.g., grams).';
COMMENT ON COLUMN "Recipe".target_hydration IS 'Target hydration of the FINAL DOUGH, after all preferments are incorporated. Stored as a real number representing the percentage (e.g., 75 for 75%).';
COMMENT ON COLUMN "Recipe".target_salt_pct IS 'Target salt percentage relative to the TOTAL FLOUR in the final recipe (including flour from preferments). Stored as a real number representing the percentage (e.g., 2.0 for 2.0%).';
COMMENT ON COLUMN "Recipe".is_base_recipe IS 'TRUE if this is a predefined template recipe provided by the system, FALSE if user-created/customized.';
COMMENT ON COLUMN "Recipe".created_at IS 'Timestamp of when the recipe was created.';
COMMENT ON COLUMN "Recipe".updated_at IS 'Timestamp of the last update to the recipe.';

CREATE UNIQUE INDEX idx_uq_base_recipe_name ON "Recipe" (recipe_name) WHERE (user_id IS NULL);

-- 5. Step Table
CREATE TABLE "Step" (
    step_id SERIAL PRIMARY KEY,
    step_name TEXT UNIQUE NOT NULL,
    description TEXT,
    step_type TEXT NOT NULL CHECK (step_type IN ('preferment', 'main_mix', 'timing')),
    step_subtype TEXT, -- Optional: for display, e.g., 'Levain', 'Poolish'
    duration_minutes INTEGER,
    is_predefined BOOLEAN NOT NULL DEFAULT TRUE,
    is_advanced BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE "Step" IS 'Defines types or categories of recipe steps (e.g., ''Levain Build'', ''Autolyse'', ''Poolish Build''). These are templates for steps within a recipe.';
COMMENT ON COLUMN "Step".step_id IS 'Unique identifier for the predefined step type.';
COMMENT ON COLUMN "Step".step_name IS 'Name of the predefined step type (e.g., ''Mix Levain'', ''Bulk Fermentation'').';
COMMENT ON COLUMN "Step".description IS 'Optional description of what this type of step generally entails.';
COMMENT ON COLUMN "Step".step_type IS 'General category for the step, used for UI grouping or logic (e.g., ''preferment'', ''main_mix'', ''timing'').';
COMMENT ON COLUMN "Step".duration_minutes IS 'Default typical duration for this type of step, in minutes. Can be overridden at the RecipeStep level.';
COMMENT ON COLUMN "Step".is_predefined IS 'TRUE if this is a system-provided, globally available step definition.';
COMMENT ON COLUMN "Step".created_at IS 'Timestamp of when the step definition was created.';
COMMENT ON COLUMN "Step".updated_at IS 'Timestamp of the last update to the step definition.';
COMMENT ON COLUMN "Step".is_advanced IS 'TRUE if this step type is considered advanced and should be hidden in simplified view.';

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
    number_of_sf_sets INTEGER,
    timing_relation_type TEXT NOT NULL DEFAULT 'after_previous_completes'
        CHECK (timing_relation_type IN ('after_previous_completes', 'with_previous_start', 'manual_independent')),
    is_advanced BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_recipe_step_order UNIQUE (recipe_id, step_order)
);

COMMENT ON TABLE "RecipeStep" IS 'Links a Recipe to a specific predefined Step, defining an instance of that step within the recipe''s process. This is where component-specific (like preferment) characteristics are defined.';
COMMENT ON COLUMN "RecipeStep".recipe_step_id IS 'Unique identifier for this specific step within a recipe.';
COMMENT ON COLUMN "RecipeStep".recipe_id IS 'Foreign key to the Recipe this step instance belongs to.';
COMMENT ON COLUMN "RecipeStep".step_id IS 'Foreign key to the predefined Step type (e.g., ''Levain Build'', ''Mix Final Dough'').';
COMMENT ON COLUMN "RecipeStep".step_order IS 'The sequence number of this step within the recipe.';
COMMENT ON COLUMN "RecipeStep".contribution_pct IS 'For a preferment step (e.g., Levain, Poolish): The amount of this preferment''s flour as a percentage of the *final recipe''s total flour*. Stored as a real number (e.g., 20 for 20%). For other additive steps, interpretation may vary.';
COMMENT ON COLUMN "RecipeStep".target_hydration IS 'For a preferment step (e.g., Levain, Poolish) or a soaker: The internal hydration of *this specific component*, calculated against its own flour/dry ingredients. Stored as a real number (e.g., 100 for 100% hydration).';
COMMENT ON COLUMN "RecipeStep".notes IS 'User-added notes or specific instructions for this step instance in this recipe.';
COMMENT ON COLUMN "RecipeStep".duration_override IS 'User-defined duration in minutes for this instance of the step, overriding the default from the "Step" table if provided.';
COMMENT ON COLUMN "RecipeStep".target_temperature_celsius IS 'Target temperature (in Celsius) for the dough or environment during this step, if applicable.';
COMMENT ON COLUMN "RecipeStep".stretch_fold_interval_minutes IS 'If this step involves stretch and folds, this defines the interval in minutes between sets.';
COMMENT ON COLUMN "RecipeStep".number_of_sf_sets IS 'For a ''Bulk Fermentation with Stretch and Fold'' step type, this optionally specifies the exact number of stretch and fold sets to be performed. If NULL, the number of S&Fs might be inferred from duration and interval, or not applicable.';
COMMENT ON COLUMN "RecipeStep".created_at IS 'Timestamp of when this recipe step instance was created.';
COMMENT ON COLUMN "RecipeStep".updated_at IS 'Timestamp of the last update to this recipe step instance.';
COMMENT ON COLUMN "RecipeStep".timing_relation_type IS 'Defines how this step''s start time relates to the previous step or overall recipe flow.';

-- 7. StageIngredient Table
CREATE TABLE "StageIngredient" (
    stage_ingredient_id SERIAL PRIMARY KEY,
    recipe_step_id INTEGER NOT NULL REFERENCES "RecipeStep"(recipe_step_id) ON DELETE CASCADE,
    ingredient_id INTEGER NOT NULL REFERENCES "Ingredient"(ingredient_id) ON DELETE RESTRICT,
    percentage REAL,
    calculated_weight REAL,
    is_wet BOOLEAN NOT NULL DEFAULT FALSE,
    split_percentage REAL,
    is_advanced BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_recipe_step_ingredient UNIQUE (recipe_step_id, ingredient_id)
);

COMMENT ON TABLE "StageIngredient" IS 'Details each ingredient used in a specific RecipeStep, including defining flour compositions for preferments and the main dough.';
COMMENT ON COLUMN "StageIngredient".stage_ingredient_id IS 'Unique identifier for this ingredient entry within a recipe step.';
COMMENT ON COLUMN "StageIngredient".recipe_step_id IS 'Foreign key to the RecipeStep this ingredient belongs to.';
COMMENT ON COLUMN "StageIngredient".ingredient_id IS 'Foreign key to the Ingredient table, identifying the specific ingredient.';
COMMENT ON COLUMN "StageIngredient".percentage IS 'The proportion of this ingredient, stored as a real number (e.g., 70 for 70.0%, 2.5 for 2.5%).';
COMMENT ON COLUMN "StageIngredient".calculated_weight IS 'Actual weight of the ingredient, calculated by the application based on percentages and overall recipe parameters. Stored in the unit defined by Recipe.target_weight_unit_id (typically grams).';
COMMENT ON COLUMN "StageIngredient".is_wet IS 'TRUE if the ingredient contributes significantly to the dough''s hydration (e.g., water, milk), FALSE otherwise (e.g., flour, salt, seeds). Should align with Ingredient.is_wet.';
COMMENT ON COLUMN "StageIngredient".split_percentage IS 'Optional: If an ingredient is added in parts during the same step, this can denote the percentage of this specific addition. Its use requires careful implementation in the application logic.';
COMMENT ON COLUMN "StageIngredient".created_at IS 'Timestamp of when this stage ingredient entry was created.';
COMMENT ON COLUMN "StageIngredient".updated_at IS 'Timestamp of the last update to this stage ingredient entry.';
COMMENT ON COLUMN "StageIngredient".is_advanced IS 'Optional override for whether this ingredient instance is advanced. If NULL, falls back to Ingredient.is_advanced.';

-- 8. UserBakeLog Table
CREATE TABLE "UserBakeLog" (
    bake_log_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES "User"(user_id) ON DELETE CASCADE,
    recipe_id INTEGER NOT NULL REFERENCES "Recipe"(recipe_id) ON DELETE CASCADE,
    bake_start_timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    bake_end_timestamp TIMESTAMPTZ,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    user_overall_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE "UserBakeLog" IS 'Stores a log for each time a user initiates and follows a guided bake for a recipe.';
COMMENT ON COLUMN "UserBakeLog".bake_log_id IS 'Unique identifier for this specific baking session log.';
COMMENT ON COLUMN "UserBakeLog".user_id IS 'Foreign key to the User who performed this bake.';
COMMENT ON COLUMN "UserBakeLog".recipe_id IS 'Foreign key to the Recipe that was baked.';
COMMENT ON COLUMN "UserBakeLog".bake_start_timestamp IS 'Timestamp when the guided bake was officially started.';
COMMENT ON COLUMN "UserBakeLog".bake_end_timestamp IS 'Timestamp when the bake was marked as completed or abandoned.';
COMMENT ON COLUMN "UserBakeLog".status IS 'Current status of the baking session (e.g., ''active'', ''paused'', ''completed'', ''abandoned'').';
COMMENT ON COLUMN "UserBakeLog".user_overall_notes IS 'User''s general notes about the entire bake (e.g., overall results, lessons learned).';
COMMENT ON COLUMN "UserBakeLog".created_at IS 'Timestamp of when this bake log entry was created.';
COMMENT ON COLUMN "UserBakeLog".updated_at IS 'Timestamp of the last update to this bake log entry.';

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

COMMENT ON TABLE "UserBakeStepLog" IS 'Stores actual timings and user notes for each specific step as it is performed in a UserBakeLog.';
COMMENT ON COLUMN "UserBakeStepLog".bake_step_log_id IS 'Unique identifier for this logged instance of a recipe step.';
COMMENT ON COLUMN "UserBakeStepLog".bake_log_id IS 'Foreign key to the parent UserBakeLog this step instance belongs to.';
COMMENT ON COLUMN "UserBakeStepLog".recipe_step_id IS 'Foreign key to the original RecipeStep definition this log entry corresponds to.';
COMMENT ON COLUMN "UserBakeStepLog".step_order IS 'The order of this step in the bake, denormalized from RecipeStep for easier access during a bake.';
COMMENT ON COLUMN "UserBakeStepLog".step_name IS 'The name of the step, denormalized from the "Step" table (via RecipeStep) for historical record if step definitions change.';
COMMENT ON COLUMN "UserBakeStepLog".planned_duration_minutes IS 'The planned duration for this step at the time of baking, denormalized from RecipeStep (duration_override) or Step (duration_minutes).';
COMMENT ON COLUMN "UserBakeStepLog".actual_start_timestamp IS 'Timestamp when the user actually started this step during the bake.';
COMMENT ON COLUMN "UserBakeStepLog".actual_end_timestamp IS 'Timestamp when the user marked this step as completed.';
COMMENT ON COLUMN "UserBakeStepLog".user_step_notes IS 'User''s notes specific to how this step went during this particular bake.';
COMMENT ON COLUMN "UserBakeStepLog".created_at IS 'Timestamp of when this bake step log entry was created.';
COMMENT ON COLUMN "UserBakeStepLog".updated_at IS 'Timestamp of the last update to this bake step log entry.';

-- Indexes
CREATE INDEX idx_userbakelog_user_status ON "UserBakeLog"(user_id, status);
CREATE INDEX idx_userbakesteplog_bakelog_order ON "UserBakeStepLog"(bake_log_id, step_order);
CREATE INDEX idx_recipe_step_recipe_id ON "RecipeStep"(recipe_id);
CREATE INDEX idx_stage_ingredient_recipe_step_id ON "StageIngredient"(recipe_step_id);

-- End of schema.sql