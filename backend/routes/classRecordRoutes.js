// Mounted at /api/class-record.
//
// No role gate here on purpose: who may read or change a class record is
// decided by assignment (class_offerings.teacher_id, sections.adviser_id)
// inside the controller — the same reasoning as gradeRoutes.js. A role
// check would lock out an adviser who also teaches, the school's ordinary
// case.
const express = require('express');
const {
  getClassRecord,
  createItem,
  updateItem,
  deleteItem,
  saveScores,
  submitClassRecord,
} = require('../controllers/classRecordController');
const { requireAuth } = require('../middleware/authMiddleware');
const { uploadSpreadsheet } = require('../middleware/bulkImportUploadMiddleware');
const { parseImport, commitImport } = require('../controllers/classRecordImportController');

const router = express.Router();
router.use(requireAuth);

router.get('/', getClassRecord);
router.post('/items', createItem);
router.patch('/items/:id', updateItem);
router.delete('/items/:id', deleteItem);
router.put('/scores', saveScores);
router.post('/submit', submitClassRecord);

// Importing the school's DepEd e-Class Record workbook (classRecordImportController.js).
router.post('/import/parse', uploadSpreadsheet, parseImport);
router.post('/import/commit', commitImport);

module.exports = router;
