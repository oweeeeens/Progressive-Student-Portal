# `services/` — logic with no HTTP

Everything here can be reasoned about, and tested, without a request. Most
of it needs no database either. This is where the parts worth defending to a
panel live.

## The calculator / engine split

The most important pattern in the codebase:

- **`riskCalculator.js`** is pure. Give it four numbers, it returns a score,
  a level and which factors triggered. No database, no I/O. It is the formula
  from CLAUDE.md written out, and it can be read top to bottom in one sitting.
- **`riskEngine.js`** is the database-facing half: fetch a learner's history,
  hand the numbers to the calculator, store the result, then resolve or
  escalate any open interventions.

Testing the formula therefore needs no fixtures at all
(`scripts/testRiskCalculator.js`), and the formula cannot be accidentally
changed by someone editing a query.

`academicProgressCalculator.js` follows the same rule, and is layered **on
top of** `riskCalculator.evaluateFactors` rather than re-deriving the
factors — so the band and the reasons behind it can never disagree.

Both importers repeat the split: `*Parser.js` answers "what is literally in
this spreadsheet", `*Validator.js` answers "what of it can be imported, and
why not", and neither touches the database.

## Things to know

- **The formula is rule-based on purpose.** Fixed thresholds, fixed advisory
  text, no AI. Two reasons: it has to be explainable under questioning, and
  it would otherwise mean sending minors' academic data to a third party.
- **Risk is recalculated once per grading period, never once per date.** The
  result depends on a learner's whole history, so recalculating per date
  recomputes the same answer N times — about 8,000 queries for a 40-day
  import.
- **Every threshold comes from `config/`**, never a literal here. Where a
  learner is told a number to aim at, it is read from the same constant the
  formula checks, so the target cannot drift from the rule.
- **`emailService.canSendEmail()`** is asked before the forgot-password flow
  is offered at all. Telling someone a reset link was sent when it went to a
  log file is worse than saying the feature is unavailable.
