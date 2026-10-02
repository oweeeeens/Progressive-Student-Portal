import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Forwards /api requests to the Express backend during local development
    // so the frontend can call relative paths like fetch('/api/hello').
    proxy: {
      '/api': 'http://localhost:5000',
    },
  },
})
