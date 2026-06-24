# Plan técnico — Gestor multi-servicio (YouTube Music · Spotify · Deezer · …)

Documento de diseño para evolucionar **Real Shuffle Player** de un reproductor dual
(YT Music + Spotify) a un **gestor unificado multi-servicio** que administre y reproduzca
canciones desde varios proveedores.

> Estado actual: backend **NestJS + youtubei.js** (`backend-node/`), frontend **React/Vite**
> (`frontend/`), auth por cookie (YT Music) y OAuth (Spotify), reproducción YT vía proxy de
> audio + Spotify Web Playback SDK. Bolsas de shuffle mixtas YT+Spotify ya funcionan.

---

## 0. Realidad de la reproducción (define el diseño)

| Servicio | Metadatos / biblioteca | Audio completo | Estrategia |
|---|---|---|---|
| YouTube Music | youtubei.js ✅ | proxy de audio ✅ | `yt-stream` |
| Spotify | Web API ✅ | Web Playback SDK (Premium, sin extraer audio) ✅ | `spotify-sdk` |
| Deezer | API OAuth ✅ | SDK descontinuado → preview 30s | `preview` + fallback YT |
| Apple Music | MusicKit JS | requiere token Apple + suscripción | `apple-sdk` (futuro) |

**Principio rector:** separar **metadatos/biblioteca** (cada proveedor) de la **reproducción**
(motor por canción). Cuando un servicio no permita reproducir oficialmente, se **empareja la
canción con un video de YouTube** (por ISRC o título+artista) y se usa el audio de YT. Eso hace
que *todo* sea reproducible reutilizando lo que ya existe.

---

## 1. Modelo de datos unificado

```ts
// backend-node/src/providers/provider.interface.ts
export type ProviderId = 'ytmusic' | 'spotify' | 'deezer';
export type PlaybackKind = 'yt-stream' | 'spotify-sdk' | 'preview' | 'match-needed';

export interface UnifiedTrack {
  uid: string;          // `${provider}:${providerId}` — id ESTABLE y único
  provider: ProviderId;
  providerId: string;   // videoId / cola del uri Spotify / id Deezer
  title: string;
  artists: string[];
  album?: string;
  durationMs: number;
  isrc?: string;        // clave de emparejamiento entre servicios
  thumbnail: string;
  playable: PlaybackKind;
  uri?: string;         // p.ej. spotify:track:...
  previewUrl?: string;  // Deezer/Spotify 30s
}

export interface UnifiedPlaylist {
  uid: string; provider: ProviderId; providerId: string;
  title: string; trackCount: number; thumbnail: string;
}
```

> Bonus: `uid` único por instancia resuelve también el bug ya detectado de IDs duplicados en la
> bolsa de shuffle (usar `uid` + índice de instancia como key de cola/historial).

---

## 2. Interfaz de proveedor

```ts
export interface MusicProvider {
  readonly id: ProviderId;
  readonly playbackKind: PlaybackKind;
  isAuthenticated(): Promise<boolean>;
  status(): Promise<{ authenticated: boolean; user?: string; needsReauth?: boolean }>;
  search(q: string, opts?: { type?: 'track' | 'playlist'; limit?: number }): Promise<UnifiedTrack[]>;
  getLibraryPlaylists(): Promise<UnifiedPlaylist[]>;
  getPlaylistTracks(providerId: string, limit?: number): Promise<{ title: string; tracks: UnifiedTrack[] }>;
  getLikedSongs(limit?: number): Promise<{ title: string; tracks: UnifiedTrack[] }>;
  resolveStreamUrl?(track: UnifiedTrack): Promise<string>; // solo proveedores 'yt-stream'
}
```

La **autenticación** queda en controladores por-proveedor (cookie vs OAuth vs Deezer-OAuth
difieren demasiado para forzar una sola interfaz).

---

## 3. Estructura de archivos (backend)

```
backend-node/src/
  providers/
    provider.interface.ts        # tipos + interfaz MusicProvider
    provider.registry.ts         # id -> instancia; resuelve desde :provider
    ytmusic/ytmusic.provider.ts  # envuelve el YtmusicService actual
    spotify/spotify.provider.ts  # envuelve el SpotifyService actual
    deezer/deezer.provider.ts    # nuevo
  music/
    music.controller.ts          # endpoints genéricos /api/:provider/*
    universal.controller.ts      # /api/search (fan-out), /api/playlists/convert
    matching.service.ts          # emparejar a YouTube + caché
  db/
    db.module.ts
    db.service.ts                # acceso a SQLite
  ytmusic/  spotify/  stream/    # se mantienen (auth + proxy de audio)
```

Estrategia *strangler*: los endpoints genéricos conviven con los actuales; se migra el frontend
gradualmente y luego se deprecan los viejos.

---

## 4. Esquema de base de datos (SQLite)

Hoy todo es JSON suelto (`oauth.json`, `spotify_token.json`) + `localStorage`/IndexedDB. Para un
gestor real conviene persistencia con esquema:

```sql
-- cuentas conectadas (reemplaza los .json de tokens)
accounts(provider TEXT PRIMARY KEY, auth_json TEXT, user TEXT, connected_at INTEGER)

-- caché de catálogo
track_cache(uid TEXT PRIMARY KEY, provider TEXT, provider_id TEXT, title TEXT,
            artists TEXT, album TEXT, duration_ms INTEGER, isrc TEXT, thumbnail TEXT,
            json TEXT, fetched_at INTEGER)
playlist_cache(uid TEXT PRIMARY KEY, provider TEXT, provider_id TEXT, title TEXT,
               track_count INTEGER, thumbnail TEXT, tracks_json TEXT, fetched_at INTEGER)

-- emparejamiento cross-servicio para "smart play"
match_cache(source_uid TEXT PRIMARY KEY, isrc TEXT, yt_video_id TEXT, score REAL, matched_at INTEGER)

-- estadísticas (reemplaza rsp_stats de localStorage)
play_stats(uid TEXT PRIMARY KEY, title TEXT, artist TEXT, count INTEGER, last_played INTEGER)

-- playlists propias de la app (cross-servicio)
user_playlists(id INTEGER PRIMARY KEY, name TEXT, created_at INTEGER)
user_playlist_tracks(playlist_id INTEGER, uid TEXT, position INTEGER)
```

**Opciones de implementación** (decisión abierta):
- **Prisma** — tipado + migraciones, ideal si el esquema crecerá. (+dep, +genera cliente)
- **better-sqlite3** — síncrono, simple, muy rápido.
- **node:sqlite** — cero dependencias (ya lo usamos para Firefox), con un DAO fino.

---

## 5. Endpoints (genéricos)

```
GET  /api/providers                       -> [{id, authenticated, playbackKind, user}]
GET  /api/:provider/status
GET  /api/:provider/search?q=
GET  /api/:provider/playlists
GET  /api/:provider/playlist/:id
GET  /api/:provider/liked
GET  /api/stream-audio/:videoId           (sin cambios)
POST /api/play/resolve   {track}          -> {kind:'yt-stream'|'spotify-sdk'|'preview', url?|uri?}
GET  /api/search?q=&providers=ytmusic,spotify   (universal: fusiona + dedup por ISRC)
POST /api/playlists/convert  {fromPlaylistUid, toProvider}
```

Auth se mantiene por-proveedor (`/api/auth/...`, `/api/oauth/...`, `/api/spotify/...`,
`/api/deezer/...`).

---

## 6. Reproducción unificada ("smart play")

`matching.service.resolve(track)`:
1. `provider === 'ytmusic'` → `yt-stream` (ya).
2. `provider === 'spotify'` y Premium → `spotify-sdk` (play uri).
3. Si no → **emparejar con YouTube**: buscar `"${title} ${artists}"`, elegir el mejor por
   cercanía de duración + similitud de título (Levenshtein), cachear en `match_cache` →
   `yt-stream`.
4. Sin match → `preview` (Deezer/Spotify 30s) o marcar `match-needed`.

El frontend pide `/api/play/resolve` y enchufa el motor correcto.

---

## 7. Frontend (romper el monolito de ~1800 líneas)

```
frontend/src/
  player/
    PlayerContext.jsx     # provee usePlayer(): cola, shuffle, currentTrack, controles
    engines/
      ytAudioEngine.js    # <audio> + proxy
      ytIframeEngine.js    # IFrame API
      spotifyEngine.js     # Web Playback SDK
      previewEngine.js     # 30s
  store/playerStore.js    # Zustand (revivir; arreglar el shuffle sesgado)
  components/
    PlayerBar.jsx  QueuePanel.jsx  LibraryPanel.jsx  ProvidersPanel.jsx  SearchView.jsx
```

Refactor incremental (strangler): extraer una pieza a la vez de `App.jsx`, manteniéndolo
funcional en cada paso.

---

## 8. Fases (cada una desplegable por separado)

| Fase | Entregable | Riesgo |
|---|---|---|
| **0. Fundación** | `provider.interface` + `UnifiedTrack`; envolver YT/Spotify como providers; endpoints genéricos en paralelo a los actuales. Frontend intacto. | Bajo |
| **1. Persistencia** | Capa SQLite; mover caché de playlists/tracks y stats; (opcional) tokens. | Bajo-medio |
| **2. Player Context** | `usePlayer()` + motores + modularizar `App.jsx`. | Medio (refactor grande) |
| **3. Deezer** | Proveedor Deezer (metadatos + biblioteca + preview). | Bajo |
| **4. Smart play** | Emparejamiento Spotify/Deezer → audio YT + caché. | Medio (calidad del match) |
| **5. Cross-provider** | Búsqueda universal + conversión/sincronización de playlists por ISRC. | Medio |
| **6. Pulido** | PWA/offline, cuentas, multi-dispositivo. | Variable |

---

## 9. Seguridad de la migración
- Mantener endpoints viejos hasta migrar el frontend.
- Cada fase es independiente y reversible.
- El monitor de errores del backend sigue activo durante todo.

---

## 10. Decisiones tomadas (2026-06-24)
1. **Base de datos**: ✅ **Prisma + PostgreSQL**.
2. **Deezer**: ✅ **reproducción real vía fallback a YouTube** (smart-play por ISRC/título).
3. **Multi-usuario**: ✅ **sí** — la app tiene su propio login y guarda credenciales de cada
   servicio **por usuario** en la BD (se eliminan los archivos globales `oauth.json` /
   `spotify_token.json` / `yt_oauth.json`).
4. **Despliegue**: ✅ **con HTTPS** (servicio web desplegable; habilita Spotify SDK y acceso móvil).
5. **Alcance**: ✅ **uso personal** confirmado.
6. **App-login (por confirmar)**: por defecto **email + contraseña con JWT**; ampliable a
   "Sign in with Google" después.

## 11. Implicaciones de multi-usuario (nuevo eje central)

Esto reescribe el modelo de autenticación actual (hoy mono-usuario con archivos globales):

- **Auth de la app**: tabla `User`, registro/login, sesiones por **JWT**, hash de contraseña
  (bcrypt/argon2), guard de Nest que inyecta `userId` en cada request.
- **Credenciales por usuario**: tabla `ProviderAccount(userId, provider, authJson)` reemplaza los
  `.json` globales. Los servicios (`YtmusicService`, `SpotifyService`, …) pasan a recibir un
  `userId` y cargar/guardar credenciales desde la BD.
- **Cada endpoint** de datos/biblioteca queda protegido por el guard y opera sobre el usuario
  autenticado.
- **OAuth de proveedores**: el flujo de conexión (cookies YT / OAuth Spotify / OAuth Deezer)
  guarda el resultado contra el `userId` actual.

### Esquema Prisma (resumen)
`User` · `ProviderAccount` (unique userId+provider) · `TrackCache` · `PlaylistCache` ·
`MatchCache` · `PlayStat` (por usuario) · `UserPlaylist` + `UserPlaylistTrack`.

### Orden de construcción revisado (por multi-usuario)
1. **Postgres + Prisma** (schema + migrate). ← requiere `DATABASE_URL`.
2. **Auth de la app** (User, registro/login, JWT, guard).
3. **Providers por-usuario** (credenciales desde BD; refactor de los servicios actuales).
4. **Abstracción de proveedor** + endpoints genéricos (con guard).
5. **Deezer** + **smart-play** (match a YouTube).
6. **Frontend** (login, gestión de cuentas conectadas, player unificado).

## 12. Pendientes que solo el usuario puede aportar
- **`DATABASE_URL`** de PostgreSQL (rol + base dedicados).
- **Credenciales de app Deezer** (registrar app en developers.deezer.com para OAuth) — fase Deezer.
- **Dominio/cert HTTPS** y destino de despliegue — fase de deploy.

## 13. App móvil

**Restricción clave:** el **Spotify Web Playback SDK NO funciona en navegadores móviles** (es solo
desktop). En móvil, reproducir Spotify completo requiere su **SDK nativo** (iOS/Android) o
controlar otro dispositivo vía **Spotify Connect**. En cambio, el **audio de YouTube (nuestro
proxy) sí funciona en móvil** — por eso la estrategia de *smart-play* (fallback a YT) es la que
hace viable la reproducción universal en el teléfono.

| Enfoque | Reutiliza el frontend | Spotify nativo | Audio en background | Esfuerzo |
|---|---|---|---|---|
| **PWA** (la web actual, instalable) | 100% | ❌ (SDK no corre en móvil) | limitado (iOS) | Bajo |
| **Capacitor** (envuelve la web + plugins nativos) | ~95% | ✅ vía plugin SDK nativo | ✅ | Medio |
| **React Native / Expo** (app nativa) | lógica sí, UI nueva | ✅ | ✅ | Alto |

**Recomendación: Capacitor.** Reutiliza todo el frontend React, añade audio en segundo plano
nativo y (opcional) el SDK nativo de Spotify; **una sola base de código** para web + iOS +
Android. La **PWA** es el primer escalón gratis (ya hay service worker). React Native solo si se
quiere app 100% nativa desde cero.

Impacto en la arquitectura: el backend ya queda como **API HTTPS multi-usuario**, que es
exactamente lo que consume tanto la web como la app móvil. La capa de reproducción del frontend
(`PlayerContext` + motores) debe abstraer "motor web" vs "motor nativo" para que Capacitor pueda
enchufar plugins nativos sin reescribir la UI.
```
