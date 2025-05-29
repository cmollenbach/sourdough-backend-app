// routes/bakeRoutes.js
const express = require('express');
const router = express.Router();
const bakeController = require('../controllers/bakeController');
const authenticateToken = require('../middleware/authenticateToken');

router.post('/start', authenticateToken, bakeController.startBake);
router.post('/:bakeLogId/steps/complete', authenticateToken, bakeController.completeBakeStep);
router.put('/:bakeLogId/status', authenticateToken, bakeController.updateBakeStatus);
router.get('/active', authenticateToken, bakeController.getActiveBakes);

module.exports = router;