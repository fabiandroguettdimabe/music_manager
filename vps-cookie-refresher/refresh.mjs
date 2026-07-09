#!/usr/bin/env node
// Refresco AUTOMÁTICO — se corre por cron/systemd en el VPS, cada X horas.
// Abre el perfil persistente ya logueado (creado por login.mjs), navega por YouTube para
// que Google ROTE los tokens de sesión, y sube las cookies frescas al backend vía
// /api/save-auth. Como corre en el VPS, firma su propio JWT corto con JWT_SECRET
// (no depende de un token de 30 días que expiraría).
//
// Uso:
//   JWT_SECRET=... npm run refresh                 # BASE_URL=http://127.0.0.1:8000 por defecto
//   JWT_SECRET=... node refresh.mjs --base https://tu-vps  --sub <userId>
//
// Salida distinta de 0 => algo falló (útil para que systemd/cron lo reporte).

import { chromium } from 'playwright';
import jwt from 'jsonwebtoken';
import { arg, userDataDir, hasSession, buildCookieHeader, readConfig } from './lib.mjs';

const BASE = (arg('base', process.env.BASE_URL || 'http://127.0.0.1:8000')).replace(/\/$/, '');
const JWT_SECRET = process.env.JWT_SECRET || '';
const SUB = arg('sub', process.env.NOIR_SUB || readConfig().sub || '');

// Navegar por estas fuerza a Google a emitir Set-Cookie con tokens rotados y frescos.
const WARM_URLS = ['https://music.youtube.com/', 'https://www.youtube.com/'];

async function main() {
  if (!JWT_SECRET) {
    console.error('Falta JWT_SECRET (el mismo del backend). Es lo que permite firmar el token del refresco.');
    process.exit(2);
  }
  if (!SUB) {
    console.error('Falta la cuenta Noir (sub). Corre login.mjs primero, o pasa --sub / NOIR_SUB.');
    process.exit(2);
  }

  const dir = userDataDir();
  const context = await chromium.launchPersistentContext(dir, {
    headless: true,
    channel: process.env.NOIR_CHROME_CHANNEL || undefined,
    viewport: { width: 1280, height: 900 },
    args: ['--no-first-run'],
  });

  try {
    const page = context.pages()[0] || (await context.newPage());
    for (const url of WARM_URLS) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => {
        console.warn(`  aviso: no cargó ${url}: ${e?.message || e}`);
      });
      await page.waitForTimeout(2500); // deja que corran los XHR que rotan cookies
    }

    const cookies = await context.cookies();
    if (!hasSession(cookies)) {
      console.error(
        '✗ El perfil YA NO tiene sesión de YouTube (Google la cerró). ' +
          'Vuelve a correr login.mjs (un solo login humano) y re-copia ./profile al VPS.',
      );
      process.exit(3);
    }

    const cookie = buildCookieHeader(cookies);
    const token = jwt.sign({ sub: SUB }, JWT_SECRET, { expiresIn: '5m' });

    const res = await fetch(`${BASE}/api/save-auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content: { cookie } }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`✗ /api/save-auth respondió HTTP ${res.status}: ${data.detail || JSON.stringify(data)}`);
      process.exit(4);
    }

    const count = cookie.split(';').length;
    console.log(`✓ Cookie refrescada (${count} valores) y guardada en ${BASE} para ${SUB}. ${new Date().toISOString()}`);
  } finally {
    await context.close();
  }
}

main().catch((e) => {
  console.error('Error en refresh:', e?.message || e);
  process.exit(1);
});
