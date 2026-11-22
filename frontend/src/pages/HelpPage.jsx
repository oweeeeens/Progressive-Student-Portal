import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Compass, GitBranch, Gauge, Keyboard, LifeBuoy } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { getNavSections } from '../utils/navigation'
import { roleLabel } from '../utils/roleLabel'
import { readShortcutsEnabled, writeShortcutsEnabled } from '../hooks/useShortcuts'
import './HelpPage.css'

// Help (HCI, 2026-11-22). Answers Nielsen's tenth heuristic — "help and
// documentation ... focused on the user's task, list concrete steps" — and
// WCAG 2.2 SC 3.2.6 "Consistent Help": it is reached from the same link in
// the top bar on every page.
//
// It is about THIS person. "Your pages" is built from the sidebar's own list
// (utils/navigation.js, the same visibility rules), so it never describes a
// page they cannot open, and the topics below appear only to the roles they
// concern. Nothing here is fetched: it is explanation, not data.

// One plain sentence per page: what it is for, in the school's own words.
const PAGE_PURPOSE = {
  '/my-grades': 'Your grade in each subject, term by term. Tap a subject to see the scores it came from and how it was computed.',
  '/my-attendance': 'Your attendance from the daily register: days present, absent and late, and your attendance rate.',
  '/my-record': 'Your student record on file. If something is wrong, tell the registrar.',
  '/my-registration': 'Your registration form: section, strand, adviser and the subjects you are enrolled in.',
  '/students': 'The learners you can see. Open one for their record, grades, attendance, class record and insights.',
  '/students/new': 'Add a learner’s record once they have enrolled on paper. Their portal account is a separate step, in User Management.',
  '/import': 'Bring in a spreadsheet: DepEd’s e-Class Record (scores), student records, or the SF2 attendance register. Each import shows what it will do before anything is saved.',
  '/attendance/daily': 'Mark the daily register (SF2) for your section. The attendance rate is one of the risk signals.',
  '/grades/entry': 'Your class record: written works, performance tasks and exams. The term grade is computed from the scores the DepEd way (DO 015, s. 2026). Submit sends it to the principal.',
  '/grades/verify': 'Grades submitted by subject teachers. Verify them, or return one with a remark the teacher will read.',
  '/grades/finalize': 'Grades the principal verified. Finalizing puts them in the official record — only finalized grades count toward the risk level.',
  '/academic-progress': 'Every learner in your scope, grouped as At Risk, Average / Steady or Performing Well, with the reason for each.',
  '/interventions': 'The follow-ups logged for advisory learners. Each is marked Resolved or Escalated automatically when the next term’s risk is calculated.',
  '/analytics': 'The overall picture: risk levels and their causes, attendance, the learner outlook and how well interventions worked. Exports to PDF and Excel.',
  '/reports/gradesheet': 'A section’s finalized grades, learners by subjects, one table per term. Exports to PDF and Excel.',
  '/reports/class-grades': 'The grades of the learners in one class — or all your classes — with where each is in the approval chain.',
  '/reports/enrolled-students': 'The list of enrolled learners, filterable by grade, section and strand, with counts.',
  '/users': 'Every portal account: edit, reset a password, deactivate or reactivate.',
  '/users/new': 'Create an account. The system gives a temporary password, which the person must change at first sign-in.',
  '/academic-setup/school-years': 'School years and their terms (grading periods).',
  '/academic-setup/sections': 'Sections, their grade level, strand and adviser.',
  '/academic-setup/subjects': 'Subjects, with their DepEd category and weight group.',
  '/academic-setup/class-offerings': 'Which subject is taught to which section, by whom, and in which term.',
}

// One topic: an icon heading and its body. A <section> labelled by its
// heading, so a screen reader can list and jump between topics.
function Topic({ id, icon: Icon, title, children }) {
  return (
    <section className="panel help-topic" aria-labelledby={id}>
      <h2 id={id}>
        <Icon size={18} strokeWidth={1.75} aria-hidden="true" /> {title}
      </h2>
      {children}
    </section>
  )
}

export function HelpPage() {
  const { user, navAssignments: assignments } = useAuth()
  const role = user?.role
  const isStudent = role === 'student'
  const [shortcutsOn, setShortcutsOn] = useState(readShortcutsEnabled)

  // The same pages, in the same groups, as this person's sidebar.
  const groups = getNavSections(role, assignments)
    .map((section) => ({ ...section, items: section.items.filter((item) => item.show) }))
    .filter((section) => section.items.length > 0)

  const handlesGrades = !isStudent
  const readsRisk = isStudent || ['admin', 'principal', 'adviser', 'guidance_counselor'].includes(role) || (assignments?.sections ?? 0) > 0

  function toggleShortcuts(event) {
    setShortcutsOn(event.target.checked)
    writeShortcutsEnabled(event.target.checked)
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Help' }]} />

      <div className="page-header">
        <h1>Help</h1>
      </div>

      <p className="help-text help-page__intro">
        What each of your pages is for, and where to turn when something is not right. You are signed in as {roleLabel(role)}, so
        this page covers what that account can do.
      </p>

      <div className="help-page">
        <Topic id="help-pages" icon={Compass} title="Your pages">
          <p className="help-text">The same pages as your menu, in the same groups.</p>
          <dl className="help-pages">
            <div className="help-pages__item">
              <dt>
                <Link to="/">Home</Link>
              </dt>
              <dd>{isStudent ? 'How you are doing this term, your subjects and your record at a glance.' : 'What needs you today, and the learners who need attention.'}</dd>
            </div>
            <div className="help-pages__item">
              <dt>
                <Link to="/profile">Your profile</Link>
              </dt>
              <dd>
                Your name, email and password{isStudent ? '' : ', and the section and classes you are assigned'}. Open it from your name in
                the top bar or the sidebar.
              </dd>
            </div>
          </dl>
          {groups.map((group) => (
            <div className="help-pages__group" key={group.key || group.label}>
              {group.label && <h3>{group.label}</h3>}
              <dl className="help-pages">
                {group.items.map((item) => (
                  <div className="help-pages__item" key={item.to}>
                    <dt>
                      <Link to={item.to}>{item.label}</Link>
                    </dt>
                    <dd>{PAGE_PURPOSE[item.to] || ''}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </Topic>

        {handlesGrades && (
          <Topic id="help-grades" icon={GitBranch} title="How a grade becomes official">
            <ol className="help-steps">
              <li>
                <strong>Subject teacher — Submitted.</strong> The term grade is computed from the class record’s scores and submitted. A
                learner with any score missing has no grade yet; a blank is not a zero.
              </li>
              <li>
                <strong>Principal — Verified,</strong> or returned to the teacher with a remark to fix and resubmit.
              </li>
              <li>
                <strong>Adviser — Finalized.</strong> The grade enters the official record. It can no longer be resubmitted, and the
                learner’s risk level is recalculated.
              </li>
            </ol>
            <p className="help-text">
              Only finalized grades count toward a learner’s risk level, so a grade still in the chain does not move it yet.
            </p>
          </Topic>
        )}

        {isStudent && (
          <Topic id="help-grades" icon={GitBranch} title="Why a grade says “Provisional”">
            <p>
              A provisional grade is computed from your teacher’s class record but is not yet official. It becomes official after your
              teacher submits it, the principal verifies it and your adviser finalizes it. Your term grade can still change until then.
            </p>
          </Topic>
        )}

        {readsRisk && (
          <Topic id="help-risk" icon={Gauge} title={isStudent ? 'What “How you’re doing” is based on' : 'How a risk level is decided'}>
            <p>Four signals are checked each term, from finalized grades and the daily register only:</p>
            <ul className="help-list">
              <li>a current average grade below 75 (DepEd’s passing mark);</li>
              <li>a grade that is falling by 5 or more points per term;</li>
              <li>an attendance rate below the school’s threshold;</li>
              <li>an attendance rate falling by 5 or more points per term.</li>
            </ul>
            <p>
              {isStudent
                ? 'If none of them applies, you are Average / Steady, or Performing Well with an average of 90 or more or a grade rising by 5 or more points per term. If one applies, your Home page names it and what would clear it.'
                : 'Each signal adds 2 points: 0–2 is Low, 3–5 Medium, 6 or more High. A learner with no signal is Average / Steady, or Performing Well with an average of 90 or more or a grade rising by 5 or more points per term.'}
            </p>
          </Topic>
        )}

        <Topic id="help-keys" icon={Keyboard} title="Keyboard shortcuts">
          <table className="help-keys">
            <tbody>
              <tr>
                <th scope="row">
                  <kbd>/</kbd>
                </th>
                <td>Jump to the search box on a list page</td>
              </tr>
              <tr>
                <th scope="row">
                  <kbd>?</kbd>
                </th>
                <td>Open this Help page</td>
              </tr>
              <tr>
                <th scope="row">
                  <kbd>Esc</kbd>
                </th>
                <td>Close a dialog or menu without doing anything</td>
              </tr>
              <tr>
                <th scope="row">
                  <kbd>Tab</kbd>
                </th>
                <td>Move between controls; every one shows where you are</td>
              </tr>
            </tbody>
          </table>
          {/* WCAG 2.2 SC 2.1.4: single-key shortcuts must be possible to
              turn off (speech input can trigger them by accident). */}
          <label className="help-keys__toggle">
            <input type="checkbox" checked={shortcutsOn} onChange={toggleShortcuts} />
            Use the <kbd>/</kbd> and <kbd>?</kbd> shortcuts in this browser
          </label>
        </Topic>

        <Topic id="help-people" icon={LifeBuoy} title="When to ask a person">
          <ul className="help-list">
            <li>
              <strong>Forgot your password?</strong> Use “Forgot password” on the sign-in page, or ask the admin or the registrar for a
              temporary one.
            </li>
            {isStudent ? (
              <>
                <li>
                  <strong>Something wrong in your record?</strong> Tell the registrar. You can see what is on file in My Record.
                </li>
                <li>
                  <strong>A question about a grade or a score?</strong> Ask your subject teacher; for attendance, your adviser.
                </li>
              </>
            ) : (
              <>
                <li>
                  <strong>Missing a section or a class?</strong> Your advisory section and classes are linked to your account by the admin.
                </li>
                <li>
                  <strong>A learner’s details are wrong?</strong> The registrar keeps the student records.
                </li>
                <li>
                  <strong>A grade was returned?</strong> The principal’s remark is on the class record; fix it and submit again.
                </li>
              </>
            )}
          </ul>
        </Topic>
      </div>
    </div>
  )
}
