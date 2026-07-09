# Noir · Refresco automático de cookie de YouTube Music (VPS)

Mantiene **fresca** la cookie de YT Music del backend sin intervención y **sin guardar tu
contraseña de Google**. Ataca el problema real: la cookie expira porque Google rota los
tokens. Aquí un contexto persistente de Playwright, ya logueado, se mantiene "caliente" y
re-sube cookies frescas al backend cada pocas horas.

## Cómo funciona

```
1. LOGIN (humano, UNA vez)   →  login.mjs headful, resuelves 2FA como persona.
                                 Se guardan solo cookies en ./profile (sin contraseña).
2. REFRESCO (automático)     →  refresh.mjs por systemd/cron en el VPS: navega YouTube
                                 (Google rota los tokens) y POST /api/save-auth con la
                                 cookie fresca. Firma su propio JWT corto con JWT_SECRET.
3. CONSUMO                   →  VPS y app Android leen la MISMA cookie del backend.
```

La seguridad clave: **nunca se guarda la contraseña**. Si comprometen el VPS solo obtienen
cookies rotativas (revocables con un logout), no tu cuenta Google completa.

## Requisitos

- Node 18+ en el VPS (ya lo tienes por el backend).
- `JWT_SECRET`: el **mismo** secreto del backend Noir.
- `sub`: el `userId` de tu cuenta Noir (lo detecta `login.mjs` desde tu token).

## Paso 1 — Login semilla (en tu PC, con pantalla)

El VPS suele ser headless, así que este paso se hace en tu máquina:

```bash
cd vps-cookie-refresher
npm install                       # instala Playwright + Chromium
npm run login -- --token "<JWT de Noir>"
```

El `<JWT de Noir>` sale de tu navegador: DevTools → Application → Local Storage → `rsp_token`.
Se abre Chromium: inicia sesión en Google (usuario, contraseña, 2FA). Cuando llegues a
`music.youtube.com` logueado, el script detecta la sesión, guarda `./profile` y cierra.

## Paso 2 — Copiar el perfil al VPS

```bash
# desde tu PC
scp -r ./profile ./config.json  usuario@tu-vps:/opt/noir/vps-cookie-refresher/
```

En el VPS, dentro de `/opt/noir/vps-cookie-refresher`:

```bash
npm install
npx playwright install --with-deps chromium   # navegador + libs del SO
cp refresh.env.example refresh.env && chmod 600 refresh.env
# edita refresh.env: pon el JWT_SECRET real del backend
```

## Paso 3 — Probar el refresco a mano

```bash
JWT_SECRET=... node refresh.mjs
# → ✓ Cookie refrescada (N valores) y guardada en http://127.0.0.1:8000 para <sub>.
```

## Paso 4 — Programarlo (systemd, recomendado)

```bash
sudo cp noir-cookie-refresh.service /etc/systemd/system/
sudo cp noir-cookie-refresh.timer   /etc/systemd/system/
# ajusta WorkingDirectory / User / rutas dentro del .service
sudo systemctl daemon-reload
sudo systemctl enable --now noir-cookie-refresh.timer
sudo systemctl list-timers | grep noir     # verifica el próximo disparo
journalctl -u noir-cookie-refresh.service -n 30   # ver el último resultado
```

### Alternativa cron

```cron
0 */6 * * *  cd /opt/noir/vps-cookie-refresher && JWT_SECRET=xxx node refresh.mjs >> refresh.log 2>&1
```

## Cuándo hay que re-loguear

Casi nunca. Si Google cierra la sesión del todo (cambio de contraseña, revocación manual),
`refresh.mjs` sale con código 3 y un mensaje claro. Ahí repites el Paso 1 (un login humano) y
re-copias `./profile`. Nunca vuelves a tocar la contraseña en automático.

## Códigos de salida (para monitoreo)

| Código | Significado |
|-------:|-------------|
| 0 | Cookie refrescada y guardada. |
| 2 | Falta config (JWT_SECRET o sub). |
| 3 | La sesión del perfil murió → re-loguear (Paso 1). |
| 4 | El backend rechazó `/api/save-auth`. |
| 1 | Error inesperado (ver log). |
