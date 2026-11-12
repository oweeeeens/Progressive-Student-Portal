// Gives the live demo its sample class records when the server starts on a
// deployment (Railway) — the backfill, then the fill for learners with no
// record yet. See scripts/backfillClassRecords.js and
// scripts/fillDemoClassRecords.js for what each creates and why repeating
// them is safe.
//
// WHY AT START-UP AND NOT IN THE PRE-DEPLOY STEP. It was first run from
// railway.json's pre-deploy command, and its output never showed in the
// service's Deploy Logs, so nobody could tell whether it had run. Run here,
// every line lands in the same log as the server's own start-up, prefixed
// [class-records], so "did it run, and what did it do" is one search away.
//
// It runs AFTER the server is listening, in the background: the site is up
// (and the health check passes) while it works, and a failure is logged,
// never fatal. It only runs on a deployment, never on a developer's machine
// or in the tests, and BACKFILL_CLASS_RECORDS=false switches it off — which
// is what to set once the school uses the System with real learners.
const { IS_PRODUCTION } = require('../config/environment');

function shouldRun() {
  const onDeployment = IS_PRODUCTION || Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME);
  const switchedOff = String(process.env.BACKFILL_CLASS_RECORDS).toLowerCase() === 'false';
  return { onDeployment, switchedOff };
}

async function ensureDemoClassRecords() {
  const { onDeployment, switchedOff } = shouldRun();
  if (!onDeployment) return;
  if (switchedOff) {
    console.log('[class-records] Skipped: BACKFILL_CLASS_RECORDS=false.');
    return;
  }
  try {
    console.log('[class-records] Checking that every current learner has a class record...');
    const { backfillClassRecords } = require('../scripts/backfillClassRecords');
    const { fillDemoClassRecords } = require('../scripts/fillDemoClassRecords');
    const backfill = await backfillClassRecords();
    console.log(`[class-records] ${backfill.summary}`);
    const fill = await fillDemoClassRecords();
    console.log(`[class-records] ${fill.summary}`);
  } catch (err) {
    console.error('[class-records] Failed; the site keeps running without it:', err);
  }
}

module.exports = { ensureDemoClassRecords };
