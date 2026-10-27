# Frontend — React + Vite

The browser half of the Student Portal. See the [repo README](../README.md)
for what the system does and how to run both halves, and
[CLAUDE.md](../CLAUDE.md) for the specification.

```
npm install
npm run dev      # http://localhost:5173, proxies /api to :5000
npm run lint     # oxlint
npm run build    # production bundle — run before every push
```

**Run `npm run build` before pushing.** The dev server does not minify, so it
will happily serve CSS that the production build rejects outright. That has
already cost one broken deploy.

## Layout

```
src/
  pages/        one component per route
  components/   shared UI; table/ and charts/ hold the bigger families
  context/      AuthContext (session) and ThemeContext (light/dark)
  api/client.js the single fetch wrapper every page uses
  index.css     design tokens and every shared style
```

## Things worth knowing before editing

**`api/client.js` is the only place that talks to the server.** It attaches
the token, parses the response and throws a plain `Error` carrying the
server's message, so pages can `try/catch`. It also handles `401` globally:
any expired or rejected token clears the session and returns to login with
an explanation, rather than leaving a page of silently empty dropdowns.

**Styles are tokens, not literals.** Colours, spacing, radii, shadows and
durations are custom properties defined once at the top of `index.css` and
redefined for dark mode. A raw hex in a component is almost always a
mistake. Note that a `var()` nested inside another token resolves where the
token is *declared*, not where it is used — which has caused a real bug here
before.

**The band colours are deliberate** and documented in CLAUDE.md: a single
hue deepening with severity, not a traffic light. Do not "fix" them back.

**`ErrorBoundary` wraps the whole app.** Without it a render-time throw
unmounts everything to a blank white page.

**Status values render as pill badges**, never bare text — `StatusPill`, with
the variant chosen by the page rather than by the component, so each domain
keeps its own mapping.

## Tests

There are none. The system's behaviour is covered by the backend integration
suite (`npm test` at the repo root, 72 tests against the real app), and the
UI has been verified by scripted browser passes across roles, themes and
widths rather than by unit tests. Worth adding if this project continues.
