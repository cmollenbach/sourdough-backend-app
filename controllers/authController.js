// controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db'); // Import the pool
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error("🔴 FATAL ERROR: JWT_SECRET is not defined. Check .env file for JWT_SECRET in authController.");
  process.exit(1);
}

exports.registerUser = async (req, res) => {
  const { email, password } = req.body;
  const username = email; // Using email as username for simplicity

  console.log(`POST /auth/register - Attempting to register: ${username}`);
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }
  if (!email.includes('@')) {
    return res.status(400).json({ message: "Invalid email format." });
  }
  if (password.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters." });
  }

  try {
    const userExistsQuery = 'SELECT * FROM "User" WHERE username = $1 OR email = $2';
    const existingUser = await pool.query(userExistsQuery, [username, email]);
    if (existingUser.rows.length > 0) {
      console.log(`   Registration failed: User already exists - ${username}`);
      return res.status(409).json({ message: "User already exists with this email." });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    console.log(`   Password hashed for: ${username}`);

    const insertUserQuery = `
      INSERT INTO "User" (username, email, password_hash, auth_provider)
      VALUES ($1, $2, $3, $4)
      RETURNING user_id, username, email, created_at;
    `;
    const newUserResult = await pool.query(insertUserQuery, [
      username,
      email,
      passwordHash,
      "email",
    ]);
    const newUser = newUserResult.rows[0];

    console.log(`   User registered: ${newUser.username} (ID: ${newUser.user_id})`);
    res.status(201).json({
      message: "User registered successfully!",
      user: {
        userId: newUser.user_id,
        username: newUser.username,
        email: newUser.email,
        createdAt: newUser.created_at,
      },
    });
  } catch (error) {
    console.error("🔴 Error in POST /auth/register:", error.stack);
    res.status(500).json({ message: "Server error during registration." });
  }
};

exports.loginUser = async (req, res) => {
  const { email, password } = req.body;
  const username = email;

  console.log(`POST /auth/login - Attempting login: ${username}`);
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  try {
    const findUserQuery = 'SELECT * FROM "User" WHERE username = $1 AND auth_provider = $2';
    const userResult = await pool.query(findUserQuery, [username, "email"]);

    if (userResult.rows.length === 0) {
      console.log(`   Login failed: User not found - ${username}`);
      return res.status(401).json({ message: "Invalid credentials." });
    }
    const user = userResult.rows[0];

    if (!user.password_hash) {
      console.log(`   Login failed: User ${username} has no password set (possibly OAuth user).`);
      return res.status(401).json({ message: "Invalid credentials." });
    }

    const isPasswordMatch = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordMatch) {
      console.log(`   Login failed: Password incorrect for user - ${username}`);
      return res.status(401).json({ message: "Invalid credentials." });
    }

    const expiresIn = "1h"; // Token expiration time
    const token = jwt.sign(
      { userId: user.user_id, username: user.username },
      JWT_SECRET,
      { expiresIn }
    );

    console.log(`   Login successful, token generated for: ${username}`);
    res.status(200).json({
      message: "Login successful!",
      token,
      user: {
        userId: user.user_id,
        username: user.username,
        email: user.email,
      },
      expiresIn,
    });
  } catch (error) {
    console.error("🔴 Error in POST /auth/login:", error.stack);
    res.status(500).json({ message: "Server error during login." });
  }
};