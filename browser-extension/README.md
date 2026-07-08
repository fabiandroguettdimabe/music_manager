# Noir — Extensión "Conectar YouTube Music"

Mini-extensión (Chrome / Edge / Brave) que captura tu sesión de YouTube Music y la
envía a tu backend con **un clic**. Reemplaza al copiado manual de cabeceras.

**¿Por qué una extensión y no el botón "Detectar" del backend?** Chrome/Edge/Brave 127+
usan **App-Bound Encryption** y bloquean el archivo de cookies mientras el navegador está
abierto → un proceso externo (el backend) ya **no puede** leerlas. Una extensión corre
*dentro* del navegador y recibe las cookies ya descifradas, sin bloqueos.

## Instalar (una sola vez)

1. Abre `chrome://extensions` (o `edge://extensions` / `brave://extensions`).
2. Activa **"Modo de desarrollador"** (arriba a la derecha).
3. Pulsa **"Cargar descomprimida"** y elige esta carpeta `browser-extension/`.
4. (Opcional) Fija la extensión a la barra con el icono de puzzle.

## Usar

1. Inicia sesión en **music.youtube.com** en ese mismo navegador.
2. Pulsa el icono de la extensión.
3. Escribe la **URL del backend**:
   - Tu **PC**: `http://localhost:8000` (recomendado para el modo híbrido: así el streaming, que corre en tu PC, queda autenticado).
   - El **VPS**: `https://84-247-174-216.sslip.io` (solo arregla el listado de playlists en la nube; ver nota CORS abajo).
4. Pulsa **"Conectar YouTube Music"** → debe decir `✅ ¡Conectado!`.

Desde ahí queda solo: un service worker en segundo plano reenvía la sesión cada
3 horas automáticamente (sin abrir el popup ni visitar music.youtube.com), así el
backend nunca se queda con cookies vencidas. El popup muestra cuándo corrió la
última vez ("Auto-sync: ✅ ...").

## Nota CORS (solo si apuntas al VPS)

El VPS tiene `ALLOWED_ORIGINS` fijo a su dominio, así que rechazará el origen
`chrome-extension://…`. Para permitirlo, añade a `ALLOWED_ORIGINS` en el `.env` del VPS
el id de la extensión (o déjalo vacío para reflejar cualquier origen). Contra `localhost`
funciona sin tocar nada.

## Privacidad

Las cookies se envían **solo** a la URL de backend que tú escribes. Nada sale a terceros.
La extensión solo pide permiso de `cookies` y hace un `POST /api/save-auth`.
