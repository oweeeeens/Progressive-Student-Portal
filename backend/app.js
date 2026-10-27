// Express app construction only — no listening, no database bootstrap.
// Split out of server.js so the integration test suite (test/integration/)
// can import the exact same app or request chain the real server uses,
// instead of re-mounting routes a second time and risking the two
// definitions drifting apart.
const path = require('path');
const express = require('express');
const cors = require('cors');
const { IS_PRODUCTION } = require('./config/environment');
const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/authRoutes');
const studentRoutes = require('./routes/studentRoutes');
const studentBulkImportRoutes = require('./routes/studentBulkImportRoutes');
const sectionRoutes = require('./routes/sectionRoutes');
const subjectRoutes = require('./routes/subjectRoutes');
const classOfferingRoutes = require('./routes/classOfferingRoutes');
const schoolYearRoutes = require('./routes/schoolYearRoutes');
const dailyAttendanceRoutes = require('./routes/dailyAttendanceRoutes');
const subjectAttendanceRoutes = require('./routes/subjectAttendanceRoutes');
const attendanceImportRoutes = require('./routes/attendanceImportRoutes');
const studentAttendanceRoutes = require('./routes/studentAttendanceRoutes');
const gradeRoutes = require('./routes/gradeRoutes');
const studentGradeRoutes = require('./routes/studentGradeRoutes');
const academicProgressRoutes = require('./routes/academicProgressRoutes');
const myProgressRoutes = require('./routes/myProgressRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const gradingPeriodRoutes = require('./routes/gradingPeriodRoutes');
const studentInterventionRoutes = require('./routes/studentInterventionRoutes');
const interventionRoutes = require('./routes/interventionRoutes');
const userRoutes = require('./routes/userRoutes');
const announcementRoutes = require('./routes/announcementRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

const app = express();

// Behind Railway's proxy every request arrives from the proxy's own address,
// so without this express-rate-limit keys every user on one counter: the
// login limit (10 per 15 minutes) becomes a budget for the whole school —
// one person fat-fingering their password locks out the staff room, while a
// real attacker is never throttled at all.
//
// Deliberately NOT set unconditionally. `trust proxy` tells Express to
// believe X-Forwarded-For, and a client talking to the server directly can
// forge that header, handing itself a fresh rate-limit bucket per request.
// So it is on only where there genuinely is a proxy in front: a production
// deployment, or a dev setup that says so explicitly.
if (IS_PRODUCTION || process.env.TRUST_PROXY === 'true') {
  // 1, not `true`: trust exactly one hop (the platform's own proxy) rather
  // than every address in the chain.
  app.set('trust proxy', 1);
}

// In production the API and the frontend are ONE service on ONE origin (see
// the static block at the bottom of this file), so the browser never makes a
// cross-origin request and CORS is simply not needed — leaving it wide open
// there would permit any site on the internet to call this API with a user's
// token. In development Vite serves the frontend on its own port, so it is
// genuinely cross-origin and CORS has to allow it. ALLOWED_ORIGIN covers the
// third case: a frontend deployed somewhere separate, named explicitly.
if (process.env.ALLOWED_ORIGIN) {
  app.use(cors({ origin: process.env.ALLOWED_ORIGIN }));
} else if (process.env.SERVE_FRONTEND !== 'true') {
  app.use(cors());
}

app.use(express.json());

app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/students/bulk-import', studentBulkImportRoutes);
app.use('/api/students/:studentId/attendance', studentAttendanceRoutes);
app.use('/api/sections', sectionRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/class-offerings', classOfferingRoutes);
app.use('/api/school-years', schoolYearRoutes);
app.use('/api/attendance/daily', dailyAttendanceRoutes);
app.use('/api/attendance/subject', subjectAttendanceRoutes);
// Bulk import of SF2-shaped attendance grids, for both registers above.
app.use('/api/attendance/bulk-import', attendanceImportRoutes);
app.use('/api/students/:studentId/grades', studentGradeRoutes);
app.use('/api/grades', gradeRoutes);
app.use('/api/academic-progress', academicProgressRoutes);
app.use('/api/my-progress', myProgressRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/grading-periods', gradingPeriodRoutes);
app.use('/api/students/:studentId/interventions', studentInterventionRoutes);
app.use('/api/interventions', interventionRoutes);
app.use('/api/users', userRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/dashboard', dashboardRoutes);

// An unknown /api path is an API call, so it gets an API answer. Without
// this it falls through to the SPA fallback below and a mistyped endpoint
// returns index.html with a 200, which looks like success to fetch().
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// --- The built frontend, served by this same service ------------------------
// One Railway service, one origin: the frontend calls /api/... with no host
// (see frontend/src/api/client.js), which only works if both come from the
// same place. It also halves the hosting bill, since Railway charges per
// service by memory and CPU.
//
// Off by default. In development Vite serves the frontend with hot reload
// and proxies /api here (frontend/vite.config.js), and pointing Express at a
// possibly-stale or missing dist/ would shadow that.
if (process.env.SERVE_FRONTEND === 'true') {
  const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');

  app.use(express.static(frontendDist));

  // Client-side routes (/my-grades, /students/42) are not files on disk, so
  // anything that reached here without matching a static file is handed
  // index.html for React Router to resolve. Written as middleware rather
  // than app.get('*') because Express 5's path parser rejects a bare '*'.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// Catches errors thrown/rejected from any route handler (Express 5 forwards
// async rejections here automatically) so the API always replies with JSON,
// never Express's default HTML error page.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

module.exports = app;
