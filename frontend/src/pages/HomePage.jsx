import { useAuth } from '../context/AuthContext'
import { DashboardPage } from './DashboardPage'
import { StudentHomePage } from './StudentHomePage'

// "/" is the one route every role lands on after login, but it is two
// genuinely different pages rather than one page with a dozen role checks
// threaded through it:
//
//   - a student's home IS their whole portal — record, advice, charts and
//     tables on one scrolling page (pages/StudentHomePage.jsx).
//   - every staff role gets the tasks waiting for them, their role's quick
//     actions, the stat figures their role is allowed to see, and the risk
//     picture for their own scope (pages/DashboardPage.jsx).
//
// Splitting here keeps each page readable on its own, which matters more
// than saving a file: neither has to explain the other's layout.
export function HomePage() {
  const { user } = useAuth()
  return user.role === 'student' ? <StudentHomePage /> : <DashboardPage />
}
