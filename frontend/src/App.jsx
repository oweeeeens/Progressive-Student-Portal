import { Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/LoginPage'
import { StudentListPage } from './pages/StudentListPage'
import { StudentDetailPage } from './pages/StudentDetailPage'
import { StudentFormPage } from './pages/StudentFormPage'
import { BulkImportStudentsPage } from './pages/BulkImportStudentsPage'
import { DailyAttendancePage } from './pages/DailyAttendancePage'
import { SubjectAttendancePage } from './pages/SubjectAttendancePage'
import { BulkImportAttendancePage } from './pages/BulkImportAttendancePage'
import { GradeEntryPage } from './pages/GradeEntryPage'
import { VerifyGradesPage } from './pages/VerifyGradesPage'
import { GradeFinalizationPage } from './pages/GradeFinalizationPage'
import { AcademicProgressPage } from './pages/AcademicProgressPage'
import { HomePage } from './pages/HomePage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { InterventionsPage } from './pages/InterventionsPage'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { CreateAccountPage } from './pages/CreateAccountPage'
import { UserManagementPage } from './pages/UserManagementPage'
import { SchoolYearsPage } from './pages/SchoolYearsPage'
import { SectionsPage } from './pages/SectionsPage'
import { SubjectsPage } from './pages/SubjectsPage'
import { ClassOfferingsPage } from './pages/ClassOfferingsPage'
import { StudentGradesPage } from './pages/StudentGradesPage'
import { StudentAttendancePage } from './pages/StudentAttendancePage'
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
              <Route path="/" element={<HomePage />} />
              <Route path="/users" element={<UserManagementPage />} />
              <Route path="/users/new" element={<CreateAccountPage />} />
              <Route path="/students" element={<StudentListPage />} />
              <Route path="/students/new" element={<StudentFormPage />} />
              <Route path="/students/bulk-import" element={<BulkImportStudentsPage />} />
              <Route path="/students/:id" element={<StudentDetailPage />} />
              <Route path="/students/:id/edit" element={<StudentFormPage />} />
              {/* A student has three pages and no deeper nesting: Home
                  carries the figures, the advice and the trends — what a
                  flagged student must see on arrival — while the detail
                  they come looking for on purpose lives on its own page.
                  This replaced six routes behind two collapsible sidebar
                  parents, and then a single four-screen page once that page
                  had grown. Every old path still redirects so existing
                  links and bookmarks keep working. */}
              <Route path="/my-grades" element={<StudentGradesPage />} />
              <Route path="/my-attendance" element={<StudentAttendancePage />} />
              <Route path="/my-record" element={<Navigate to="/" replace />} />
              <Route path="/my-profile/*" element={<Navigate to="/" replace />} />
              <Route path="/my-progress/*" element={<Navigate to="/" replace />} />
              <Route path="/attendance/daily" element={<DailyAttendancePage />} />
              <Route path="/attendance/subject" element={<SubjectAttendancePage />} />
              <Route path="/attendance/bulk-import" element={<BulkImportAttendancePage />} />
              <Route path="/grades/entry" element={<GradeEntryPage />} />
              <Route path="/grades/verify" element={<VerifyGradesPage />} />
              <Route path="/grades/finalize" element={<GradeFinalizationPage />} />
              <Route path="/academic-progress" element={<AcademicProgressPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/interventions" element={<InterventionsPage />} />
              <Route path="/academic-setup/school-years" element={<SchoolYearsPage />} />
              <Route path="/academic-setup/sections" element={<SectionsPage />} />
              <Route path="/academic-setup/subjects" element={<SubjectsPage />} />
              <Route path="/academic-setup/class-offerings" element={<ClassOfferingsPage />} />
            </Route>
          </Routes>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
