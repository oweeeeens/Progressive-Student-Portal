// Importing a DepEd e-Class Record into the Class Record.
//
//   POST /api/class-record/import/parse   (multipart: file, classOfferingId)
//        Reads the workbook (services/eclassRecordParser.js) and returns the
//        parsed terms plus the review plan. Writes nothing.
//   POST /api/class-record/import/commit  ({ classOfferingId, terms, decisions, fileName })
//        Rebuilds the plan from the parsed terms on the server — the
//        browser's copy is not trusted — then writes the ready terms.
//
// Only the teacher of the class (class_offerings.teacher_id) or the admin may
// import into it — the same write rule as typing scores on the Class Record.
const assessmentModel = require('../models/assessmentModel');
const { parseEclassRecord } = require('../services/eclassRecordParser');
const { buildImportPlan, commitImportPlan, DECISIONS } = require('../services/eclassRecordImport');

async function loadWritableOffering(req, res, classOfferingId) {
  const id = Number(classOfferingId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Choose the class this e-Class Record belongs to.' });
    return null;
  }
  const offering = await assessmentModel.getOfferingContext(id);
  if (!offering) {
    res.status(404).json({ error: 'Class not found.' });
    return null;
  }
  if (req.user.role !== 'admin' && offering.teacher_id !== req.user.id) {
    res.status(403).json({ error: 'Only the teacher of this class can import its e-Class Record.' });
    return null;
  }
  return offering;
}

async function parseImport(req, res) {
  const offering = await loadWritableOffering(req, res, req.body.classOfferingId);
  if (!offering) return;
  let parsed;
  try {
    parsed = await parseEclassRecord(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const plan = await buildImportPlan(offering, parsed.terms);
  res.json({
    fileName: req.file.originalname,
    offering: { id: offering.id, subjectName: offering.subject_name, sectionName: offering.section_name, gradeLevel: offering.grade_level, weightGroup: offering.weight_group },
    terms: parsed.terms,
    plan,
  });
}

async function commitImport(req, res) {
  const offering = await loadWritableOffering(req, res, req.body.classOfferingId);
  if (!offering) return;
  const plan = await buildImportPlan(offering, req.body.terms);
  const ready = plan.terms.filter((t) => t.status === 'ready');
  if (ready.length === 0) {
    return res.status(400).json({ error: 'No term in this workbook can be imported. See the review step for why.' });
  }
  const decisions = req.body.decisions && typeof req.body.decisions === 'object' ? req.body.decisions : {};
  const undecided = ready.filter((t) => t.needsDecision && !DECISIONS.includes(decisions[t.sequence]));
  if (undecided.length > 0) {
    return res.status(409).json({
      error: 'Some terms already have a class record. Choose whether to replace or skip each one.',
      terms: undecided.map((t) => t.periodName),
    });
  }
  if (ready.every((t) => t.needsDecision && decisions[t.sequence] === 'skip')) {
    return res.status(400).json({ error: 'Every term was skipped, so there is nothing to import.' });
  }
  const result = await commitImportPlan({ offering, rawTerms: req.body.terms, plan, decisions, userId: req.user.id, fileName: req.body.fileName });
  res.status(201).json(result);
}

module.exports = { parseImport, commitImport };
