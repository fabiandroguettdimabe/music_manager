# Noir — App Android (Kotlin + Compose + Media3)

Cliente Android nativo del backend **Real Shuffle Player**. Reproduce el audio proxeado
por el backend (`/api/stream-audio`) con **ExoPlayer/Media3**: segundo plano, controles
de **pantalla bloqueada reales**, gapless y seek nativos. El **orden del barajado lo
decide el servidor** (módulo `queue`), así el cliente es delgado.

## Estado (Fase 1 — vertical slice)

Funciona de punta a punta:
- **Configuración**: pega la URL del backend (Tailscale `100.x.x.x:8000` o LAN `192.168.x.x:8000`).
- **Login opcional**: sin cuenta usa la conexión compartida del servidor; con cuenta
  (JWT) queda listo para sincronizar estado con la web.
- **Biblioteca**: playlists de YT Music + "Me gusta". Chip **Bolsa / Reorden**.
- **Buscar**: canciones; toca una para reproducir la lista como cola.
- **Reproductor**: mini-player + Now Playing a pantalla completa (carátula, slider,
  prev/play/next, "a continuación"), notificación y lockscreen nativos.

Pendiente (Fase 2+): ecualizador nativo, letras, estadísticas, favoritos sincronizados,
asistente IA, "espiar la siguiente"/rerol, discover/radio, Spotify, sleep timer, acento
dinámico del arte.

## Cómo compilar

> En este equipo **no había Android SDK ni Android Studio**. El proyecto está completo y
> listo; solo necesitas Android Studio para compilar/instalar.

1. Instala **Android Studio** (Ladybug o superior).
2. `File > Open` → carpeta `android/`. Studio hará el *Gradle sync* y te pedirá instalar
   el SDK (Android 15 / API 35) y el build-tools si faltan. Acepta.
   - Se creará `android/local.properties` con `sdk.dir=...` (no se versiona).
3. Conecta un teléfono (Depuración USB) o usa un emulador con **Google APIs**.
4. `Run 'app'`. Al abrir, pega la URL del backend.

### Desde línea de comandos (opcional)
Con el SDK instalado y `ANDROID_HOME` apuntando a él:
```
cd android
./gradlew assembleDebug      # genera app/build/outputs/apk/debug/app-debug.apk
./gradlew installDebug       # instala en el dispositivo conectado
```
El wrapper (`gradlew`, `gradle/wrapper/gradle-wrapper.jar`) ya está incluido.

## Conexión con el backend

- El backend debe estar **encendido en el PC** (`npm run start:dev` en `backend-node/`,
  puerto **8000**).
- Para escuchar **fuera de casa**, expón el PC con **Tailscale** y usa su IP `100.x.x.x`.
- La app permite HTTP en claro (`usesCleartextTraffic`) porque el backend personal va por
  HTTP en la red privada.

## Arquitectura

```
data/net      Retrofit + DTOs + ApiProvider (baseUrl dinámica, JWT por interceptor)
data/prefs    SettingsStore (DataStore: URL + sesión)  ·  data/repo  NoirRepository
di            AppContainer (DI manual)  ·  PlaybackQueue (sessionId)  ·  PlaybackStarter
playback      PlaybackService (MediaSessionService + ExoPlayer con "lookahead" al servidor)
              PlaybackConnection (MediaController → StateFlow)  ·  MediaItems
ui/*          Compose: setup, library, search, settings, player (Mini + NowPlaying), theme
```

**Lookahead**: el servicio mantiene siempre 1 pista por delante pidiéndola a
`POST /api/queue/next`. Así los controles nativos (next/prev/gapless/notificación)
funcionan sin trucos y el barajado real vive en el backend.
