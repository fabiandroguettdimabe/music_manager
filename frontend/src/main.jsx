import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { installAuthInterceptor } from './auth/apiClient'
import { registerPwa } from './pwa'

// Adjunta el JWT a las peticiones /api antes de que la app haga cualquier fetch.
installAuthInterceptor()

// Registro del service worker + aviso de actualización + invitación a instalar.
registerPwa()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
