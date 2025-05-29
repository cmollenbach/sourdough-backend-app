// middleware/authenticateToken.js
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error("🔴 FATAL ERROR: JWT_SECRET is not defined. Check .env file for JWT_SECRET in middleware.");
  process.exit(1); // Critical for auth
}

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (token == null) {
    // console.log("Auth middleware: No token provided."); // Kept for debugging if needed
    return res.status(401).json({ message: "Access token is required." });
  }

  jwt.verify(token, JWT_SECRET, (err, decodedTokenPayload) => {
    if (err) {
      console.log("Auth middleware: Token verification failed.", err.message);
      return res.status(403).json({ message: "Token is invalid or expired." });
    }
    req.user = decodedTokenPayload; // Add user payload to request object
    // console.log( // Kept for debugging
    //   "Auth middleware: Token verified successfully for user:",
    //   req.user.username,
    //   "(ID:", req.user.userId, ")"
    // );
    next();
  });
};

module.exports = authenticateToken;