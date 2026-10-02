import { Route, BrowserRouter as Router, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { StudentListPage } from './pages/StudentListPage'
import { StudentDetailPage } from './pages/StudentDetailPage'
import { StudentFormPage } from './pages/StudentFormPage'
import { DailyAttendancePage } from './pages/DailyAttendancePage'
import { SubjectAttendancePage } from './pages/SubjectAttendancePage'
import { EnrollmentQueuePage } from './pages/EnrollmentQueuePage'
import { GradeEntryPage } from './pages/GradeEntryPage'
import { GradeFinalizationPage } from './pages/GradeFinalizationPage'
import { RiskDashboardPage } from './pages/RiskDashboardPage'
import { InterventionsPage } from './pages/InterventionsPage'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { CreateStaffAccountPage } from './pages/CreateStaffAccountPage'
import { StaffAccountsPage } from './pages/StaffAccountsPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route
              path="/change-password"
              element={
                <ProtectedRoute>
                  <ChangePasswordPage />
                </ProtectedRoute>
              }
            />
            <Route
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<DashboardPage />} />
              <Route path="/staff" element={<StaffAccountsPage />} />
              <Route path="/staff/new" element={<CreateStaffAccountPage />} />
              <Route path="/students" element={<StudentListPage />} />
              <Route path="/students/new" element={<StudentFormPage />} />
              <Route path="/students/:id" element={<StudentDetailPage />} />
              <Route path="/students/:id/edit" element={<StudentFormPage />} />
              <Route path="/attendance/daily" element={<DailyAttendancePage />} />
              <Route path="/attendance/subject" element={<SubjectAttendancePage />} />
              <Route path="/enrollment" element={<EnrollmentQueuePage />} />
              <Route path="/grades/entry" element={<GradeEntryPage />} />
              <Route path="/grades/finalize" element={<GradeFinalizationPage />} />
              <Route path="/risk-dashboard" element={<RiskDashboardPage />} />
              <Route path="/interventions" element={<InterventionsPage />} />
            </Route>
          </Routes>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
