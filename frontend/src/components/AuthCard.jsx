import '../pages/LoginPage.css'

// The shared shell for every logged-out auth screen (login, forgot/reset
// password, forced change-password) — one navy brand panel plus one form
// panel, so the brand presentation can't drift between these four pages the
// way it did when each one inlined its own copy of this markup.
export function AuthCard({ heading, children }) {
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-card__brand">
          <img src="/logo.png" alt="" className="login-card__logo" />
          <h1 className="login-card__title">Progressive SHS</h1>
          <p className="login-card__subtitle">Student Portal</p>
          <span className="login-card__accent-rule" aria-hidden="true" />
          <p className="login-card__tagline">DepEd Progressive Senior High School — Bacoor City</p>
        </div>

        <div className="login-card__form-panel">
          {heading && <h2 className="login-card__form-heading">{heading}</h2>}
          {children}
        </div>
      </div>
    </div>
  )
}
