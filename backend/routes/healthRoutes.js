// Routes for the hello-world/health-check endpoints. Kept separate from
// student/attendance/etc. routes so each module's routing stays single-purpose.
const express = require('express');
const { getHello, getHealth } = require('../controllers/healthController');

const router = express.Router();

router.get('/hello', getHello);
router.get('/health', getHealth);

module.exports = router;
