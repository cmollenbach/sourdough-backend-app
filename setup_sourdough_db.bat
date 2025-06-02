@echo off
REM setup_sourdough_db.bat
REM Run this from your project root or adjust the paths as needed

SET PGUSER=sourdough_local_user
SET PGDATABASE=sourdough_local_db

echo Running schema.sql...
psql -U %PGUSER% -d %PGDATABASE% -f "DBsetup\schema.sql"
IF %ERRORLEVEL% NEQ 0 (
    echo Error running schema.sql
    exit /b %ERRORLEVEL%
)

echo Running populate_base_recipes.sql...
psql -U %PGUSER% -d %PGDATABASE% -f "DBsetup\populate_base_recipes.sql"
IF %ERRORLEVEL% NEQ 0 (
    echo Error running populate_base_recipes.sql
    exit /b %ERRORLEVEL%
)

echo Database setup complete!
pause