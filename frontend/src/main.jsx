import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted (npm, bundled by Vite) rather than fetched from Google Fonts.
// Two reasons beyond the obvious privacy one: the school's connectivity is
// not guaranteed, and a webfont that fails to load silently falls back to a
// different metric, shifting every table in the app. Bundled, it either
// ships or the build fails. Only the weights actually used are imported.
// Latin + latin-ext only: enough for Filipino and English (including ñ and
// the accented forms that appear in names), without shipping the Cyrillic,
// Greek and Vietnamese subsets this school will never render.
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-sans/latin-700.css'
import '@fontsource/ibm-plex-sans/latin-ext-400.css'
import '@fontsource/ibm-plex-sans/latin-ext-500.css'
import '@fontsource/ibm-plex-sans/latin-ext-600.css'
import '@fontsource/ibm-plex-sans/latin-ext-700.css'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
