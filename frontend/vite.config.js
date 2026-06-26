import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Puerto del dev server y backend al que se proxea /api.
// Configurables por entorno para correr varias instancias en paralelo
// (p.ej. estable en 5173->8000 y desarrollo en 5174->8001).
const port = Number(process.env.VITE_PORT) || 5173
const apiTarget = process.env.VITE_API_TARGET || 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      }
    }
  }
})
