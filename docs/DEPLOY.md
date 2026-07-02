# Despliegue en un VPS (Opción 3 — fuera de tu PC)

Deja la app corriendo 24/7 en un servidor propio, con HTTPS y URL fija, sin depender
de tu equipo. Un solo `docker compose up` levanta **API + frontend + Postgres + HTTPS**.

> ⚠️ **Riesgo #1 a validar primero (Paso 4b):** `youtubei.js` desde una IP de datacenter
> puede toparse con el "confirma que no eres un robot" de Google aunque uses tus cookies.
> Haz la prueba del Paso 4b **antes** de migrar todo. Si falla, ve a "Plan B" al final.

---

## Requisitos
- Un VPS Linux (Ubuntu 24.04). **Proveedor recomendado: Hetzner Cloud** (~€4/mes, fiable,
  20 TB de tráfico incluido). Los archivos Docker de este repo funcionan igual en cualquier VPS;
  solo el **Paso 1** cambia según el proveedor.
- Un dominio: gratis con **DuckDNS** (`algo.duckdns.org`) o el tuyo.
- Una clave SSH. Si no tienes, en tu PC (PowerShell):
  ```powershell
  ssh-keygen -t ed25519    # deja la ruta por defecto; copia el contenido de C:\Users\<tú>\.ssh\id_ed25519.pub
  ```

---

## Paso 1 — Crear el VPS en Hetzner
1. Crea cuenta en **https://console.hetzner.cloud** → *New project*.
2. **Add Server**:
   - **Location**: `Ashburn` o `Hillsboro` (EE. UU.) → menor latencia desde Chile que Alemania.
     (Si eliges EU, el tipo `CX22` es un poco más barato.)
   - **Image**: `Ubuntu 24.04`.
   - **Type**: según la ubicación —
     - EE. UU. → **CPX11** (2 vCPU / 2 GB / 40 GB / 20 TB, ~€4.35/mes). Con holgura: `CPX21` (3 vCPU / 4 GB).
     - Europa → **CX22** (2 vCPU / 4 GB / 40 GB / 20 TB, ~€3.79/mes).
     > 2 GB de RAM sobran: la app mide ~80 MB + Postgres ~100 MB. No pagues más de la cuenta.
   - **SSH key**: pega tu clave pública (evita contraseñas).
   - Deja IPv4 activada (Hetzner cobra ~€0.50/mes por ella).
3. **Firewall (en la consola de Hetzner, no en el SO)**: *Firewalls → Create* → reglas de entrada
   TCP para **22**, **80** y **443** → aplícalo al servidor. Con esto basta; Hetzner no bloquea en el SO.
4. Entra por SSH: `ssh root@IP_DEL_VPS`

> **Otros proveedores:** en **Oracle Always Free** usa forma `VM.Standard.A1.Flex` (ARM) y abre 80/443
> en la *Security List* + `sudo iptables -I INPUT -p tcp --dport 80/443 -j ACCEPT`. Del **Paso 2** en
> adelante todo es idéntico.

## Paso 2 — Instalar Docker
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
```

## Paso 3 — Apuntar el dominio al VPS
- **DuckDNS**: crea un subdominio en https://www.duckdns.org y ponle la IP pública del VPS.
- **Dominio propio**: registro **A** → IP del VPS.
- Verifica: `ping tuapp.duckdns.org` debe resolver a la IP del VPS.

## Paso 4 — Traer el código y configurar
Si tienes el repo en GitHub:
```bash
git clone <TU_REPO> app && cd app
```
Si NO tienes remoto, cópialo desde tu PC (sin node_modules; el build los reinstala):
```powershell
# en tu PC, dentro de la carpeta del proyecto:
scp -r Dockerfile docker-compose.yml Caddyfile .env.deploy.example backend-node frontend scripts root@IP_DEL_VPS:~/app/
# excluye node_modules antes si pesa: usa rsync o borra frontend/node_modules y backend-node/node_modules en el VPS.
```
Luego, en el VPS:
```bash
cd ~/app
cp .env.deploy.example .env
nano .env        # rellena POSTGRES_PASSWORD, JWT_SECRET, CREDENTIALS_ENC_KEY (¡la misma que en local!), SITE_ADDRESS, ALLOWED_ORIGINS
```

### Paso 4b — Validar YouTube desde esta IP (de-risking, ~10 min)
Antes de migrar tu BD, comprueba que Google no te bloquea desde el datacenter:
```bash
docker compose up -d --build db app     # levanta solo BD + app (sin Caddy)
docker compose logs -f app              # espera "Nest application successfully started"
```
En otra terminal, conéctate a la app por su puerto interno con un usuario nuevo de prueba
(regístrate desde la web temporalmente vía `http://IP_DEL_VPS:PUERTO` si abres el 8000, o
espera al Paso 6 con HTTPS) y conecta tu cuenta de YouTube.
- ✅ Si lista tus playlists → **luz verde**, sigue al Paso 5.
- ❌ Si sale bot-check / 429 → **Plan B** (abajo).

## Paso 5 — Migrar tu base de datos (conservar cuentas y listas)
En tu **PC** (Windows):
```powershell
.\scripts\dump-local-db.ps1                    # crea realshuffle.dump
scp realshuffle.dump root@IP_DEL_VPS:~/app/    # (Hetzner = root; en Oracle sería ubuntu@)
```
En el **VPS**:
```bash
# la BD debe estar arriba (Paso 4b la levantó). Restaura el volcado:
docker compose exec -T db pg_restore -U realshuffle -d realshuffle --clean --if-exists < ~/app/realshuffle.dump
docker compose restart app
```
> `CREDENTIALS_ENC_KEY` en `.env` debe ser idéntica a la de tu `.env` local, o las cookies
> restauradas no se podrán descifrar.

## Paso 6 — Levantar todo con HTTPS
```bash
docker compose up -d --build
docker compose logs -f caddy   # debe obtener el certificado sin errores
```
Abre `https://tuapp.duckdns.org` en el **Chrome del Motorola** → **Instalar app**. Listo. ✅

---

## Operación
- Ver estado / logs: `docker compose ps` · `docker compose logs -f app`
- Actualizar tras cambios: `git pull && docker compose up -d --build`
- Reiniciar: `docker compose restart` · Parar: `docker compose down` (los datos persisten en volúmenes)
- Backup de la BD: `docker compose exec -T db pg_dump -U realshuffle -Fc realshuffle > backup.dump`

## Plan B — si YouTube bloquea la IP del datacenter
1. **Refrescar cookies** más a menudo (a veces basta).
2. **Proxy residencial** para las llamadas de `youtubei.js` (añade costo; hay servicios por ~$).
3. **Híbrido**: deja SOLO el backend en tu casa (IP residencial) con auto-arranque + túnel, y
   el resto como quieras. Es la Opción 1 que mantiene a Google contento.
