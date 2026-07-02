import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Puerto del dev server y backend al que se proxea /api.
// Configurables por entorno para correr varias instancias en paralelo
// (p.ej. estable en 5173->8000 y desarrollo en 5174->8001).
const port = Number(process.env.VITE_PORT) || 5173
const previewPort = Number(process.env.VITE_PREVIEW_PORT) || 4173
const apiTarget = process.env.VITE_API_TARGET || 'http://127.0.0.1:8000'

// Proxy de /api al backend (incluye el stream de audio, que también va bajo /api).
const apiProxy = { '/api': { target: apiTarget, changeOrigin: true } }

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Separa librerías grandes en chunks propios: cargan en paralelo y se cachean
        // aparte del código de la app (que cambia mucho más seguido). Rolldown exige función.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/motion/') || id.includes('/framer-motion/')) return 'motion'
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react-vendor'
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port,
    proxy: apiProxy,
    // Permite el Host del túnel (Cloudflare/Tailscale) sin "Blocked request".
    allowedHosts: true,
  },
  // `npm run preview` sirve el build de producción (con service worker) y también
  // proxea /api → sirve para probar/instalar la PWA a través de un túnel HTTPS.
  preview: {
    host: '0.0.0.0',
    port: previewPort,
    proxy: apiProxy,
    allowedHosts: true,
  },
})
