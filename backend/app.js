// Express app construction only — no listening, no database bootstrap.
// Split out of server.js so the integration test suite (test/integration/)
// can import the exact same app or request chain the real server uses,
// instead of re-mounting routes a second time and risking the two
// definitions drifting apart.
const express = require('express');
const cors = require('cors');
const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/authRoutes');
const studentRoutes = require('./routes/studentRoutes');
const sectionRoutes = require('./routes/sectionRoutes');
const subjectRoutes = require('./routes/subjectRoutes');
const classOfferingRoutes = require('./routes/classOfferingRoutes');
const schoolYearRoutes = require('./routes/schoolYearRoutes');
const dailyAttendanceRoutes = require('./routes/dailyAttendanceRoutes');
const subjectAttendanceRoutes = require('./routes/subjectAttendanceRoutes');
const studentAttendanceRoutes = require('./routes/studentAttendanceRoutes');
const gradeRoutes = require('./routes/gradeRoutes');
const studentGradeRoutes = require('./routes/studentGradeRoutes');
const riskDashboardRoutes = require('./routes/riskDashboardRoutes');
const gradingPeriodRoutes = require('./routes/gradingPeriodRoutes');
const studentInterventionRoutes = require('./routes/studentInterventionRoutes');
const interventionRoutes = require('./routes/interventionRoutes');
const userRoutes = require('./routes/userRoutes');
const announcementRoutes = require('./routes/announcementRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/students/:studentId/attendance', studentAttendanceRoutes);
app.use('/api/sections', sectionRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/class-offerings', classOfferingRoutes);
app.use('/api/school-years', schoolYearRoutes);
app.use('/api/attendance/daily', dailyAttendanceRoutes);
app.use('/api/attendance/subject', subjectAttendanceRoutes);
app.use('/api/students/:studentId/grades', studentGradeRoutes);
app.use('/api/grades', gradeRoutes);
app.use('/api/risk-dashboard', riskDashboardRoutes);
app.use('/api/grading-periods', gradingPeriodRoutes);
app.use('/api/students/:studentId/interventions', studentInterventionRoutes);
app.use('/api/interventions', interventionRoutes);
app.use('/api/users', userRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Catches errors thrown/rejected from any route handler (Express 5 forwards
// async rejections here automatically) so the API always replies with JSON,
// never Express's default HTML error page.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

module.exports = app;
