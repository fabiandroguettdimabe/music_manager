# Real Shuffle Player — Backend (NestJS + youtubei.js)

Backend en **TypeScript / NestJS** que reemplaza al antiguo backend Python (FastAPI +
`ytmusicapi` + `yt-dlp`). Expone exactamente la misma API bajo `/api`, en el puerto
**8000**, por lo que el frontend (React/Vite) funciona sin cambios.

## Stack

- **NestJS 10** (Express) — framework HTTP.
- **youtubei.js** — cliente de la API interna de YouTube (InnerTube). Reemplaza a la vez
  a `ytmusicapi` (búsqueda, playlists, biblioteca) y a `yt-dlp` (extracción del stream de audio).
- **fetch nativo de Node 24** — para Spotify y para el proxy de audio.

## Requisitos

- Node.js **>= 20** (probado en v24).

## Puesta en marcha

```bash
cd backend-node
npm install
npm run build       # compila a dist/
npm start           # node dist/main.js  (escucha en 0.0.0.0:8000)
```

O simplemente usa el launcher de la raíz, que compila la primera vez y arranca backend + frontend:

```bash
python run.py
```

Para desarrollo con recarga: `npm run start:dev`.

## Archivos de credenciales

Se guardan en la **raíz del proyecto** (el proceso Node corre con cwd = raíz):

| Archivo               | Contenido                                              |
| --------------------- | ------------------------------------------------------ |
| `oauth.json`          | Cookies/cabeceras de YouTube Music (auth por cookie).  |
| `yt_oauth.json`       | Tokens OAuth2 (device flow de YouTube TV), si se usa.  |
| `spotify_token.json`  | Tokens de Spotify.                                     |

> ⚠️ Contienen credenciales de sesión. No los subas a control de versiones.

## API (sin cambios respecto al backend Python)

YouTube Music: `GET /api/status`, `POST /api/save-auth`, `POST /api/logout`,
`POST /api/oauth/init`, `POST /api/oauth/verify`, `POST /api/auth/browser-capture`,
`GET /api/playlists`, `GET /api/liked-songs`, `GET /api/playlist/:id`, `GET /api/search?q=`,
`GET /api/stream-audio/:videoId`.
Spotify: `GET /api/spotify/{status,auth-url,token,playlists,liked,playlist/:id}`,
`POST /api/spotify/{exchange,logout}`.

## Notas de la migración (importante)

1. **Autenticación de YouTube Music por cookie.** youtubei.js calcula el `SAPISIDHASH`
   ligado a `www.youtube.com`, pero los endpoints privados de YT Music exigen que esté
   ligado a `music.youtube.com`. El servicio usa un `fetch` propio que recalcula ese
   header y redirige al host de música para las peticiones autenticadas
   (ver `ytmusic.service.ts`).

2. **Streaming anónimo con cliente IOS.** El cliente WEB ya no entrega URLs de audio sin
   PoToken; `getInfo(videoId, { client: 'IOS' })` devuelve una URL directa lista para hacer
   proxy con soporte de `Range` (seek). Se usa una sesión **sin autenticación** para streaming:
   el audio público no la necesita y enviar cookie/SAPISIDHASH al endpoint del player IOS lo
   hace responder 400.

3. **Auto-captura de cookies desde Firefox** (recomendado para autenticarse). `POST
   /api/auth/browser-capture {"browser":"firefox"}` lee `cookies.sqlite` (sin cifrar) vía
   `node:sqlite`, **escanea todos los perfiles y elige el que tenga sesión activa de YouTube**
   (`LOGIN_INFO`), y filtra a las ~25 cookies relevantes (las cientos de `ST-*` revientan el
   límite de cabecera → HTTP 413). Chrome/Edge/Brave usan cifrado *app-bound* en Windows y no
   son legibles desde Node → ahí se usa el método manual (pegar cabeceras).

4. **OAuth está deshabilitado.** El OAuth nativo de youtubei.js usa el cliente *YouTube TV* de
   Google, cuyo token **es rechazado por los endpoints de YT Music** (WEB_REMIX → 400
   INVALID_ARGUMENT; solo sirve para el cliente TVHTML5). Por eso no da acceso a la biblioteca.
   `oauth/init` y `oauth/verify` devuelven un mensaje claro en vez de un flujo roto.

5. **La sesión por cookie puede expirar** (los tokens de Google rotan). La búsqueda y el
   streaming funcionan sin sesión; playlists/biblioteca y "me gusta" requieren una válida —
   re-captura desde Firefox con un clic cuando haga falta.

El backend Python original se conserva en `../backend/` como respaldo / referencia.
