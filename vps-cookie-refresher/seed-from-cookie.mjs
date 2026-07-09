#!/usr/bin/env node
// Siembra el perfil persistente A PARTIR de una cookie ya válida (la que el backend tiene
// en la BD), sin necesidad de un login humano con 2FA. Inyecta las cookies en el contexto,
// navega YouTube para que Google "sane" y persista el jar, y verifica que hay sesión.
//
// Uso (la cookie NUNCA se pasa por argv para no filtrarla a los logs):
//   SEED_COOKIE="SID=...; SAPISID=...; LOGIN_INFO=..." node seed-from-cookie.mjs --sub <userId>
//
// Después, refresh.mjs mantiene esa sesión fresca (rota los tokens al navegar).

import { chromium } from 'playwright';
import { arg, userDataDir, hasSession, writeConfig } from './lib.mjs';

const WARM_URLS = ['https://music.youtube.com/', 'https://www.youtube.com/'];
const YEAR = 400 * 24 * 60 * 60; // Chrome tope ~400 días

function parseCookieHeader(str) {
  const out = [];
  for (const part of String(str || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out.push({ name, value });
  }
  return out;
}

function toPlaywrightCookies(pairs) {
  // Cada cookie va a AMBOS dominios (google y youtube); redundante pero inofensivo. La
  // primera navegación deja que Google fije dominio/flags correctos y los persista.
  const expires = Math.floor(Date.now() / 1000) + YEAR;
  const cookies = [];
  for (const domain of ['.google.com', '.youtube.com']) {
    for (const { name, value } of pairs) {
      cookies.push({
        name,
        value,
        domain,
        path: '/',
        secure: true,
        httpOnly: false,
        sameSite: 'None',
        expires,
      });
    }
  }
  return cookies;
}

async function main() {
  const sub = arg('sub', process.env.NOIR_SUB || '');
  const raw = process.env.SEED_COOKIE || '';
  if (!sub) {
    console.error('Falta --sub <userId de Noir>.');
    process.exit(2);
  }
  const pairs = parseCookieHeader(raw);
  if (pairs.length === 0) {
    console.error('SEED_COOKIE vacío. Pásalo por variable de entorno (no por argumento).');
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
    await context.addCookies(toPlaywrightCookies(pairs));
    for (const url of WARM_URLS) {
      const page = context.pages()[0] || (await context.newPage());
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => {
        console.warn(`  aviso: no cargó ${url}: ${e?.message || e}`);
      });
      await page.waitForTimeout(2500);
    }

    const cookies = await context.cookies();
    if (!hasSession(cookies)) {
      console.error('✗ Inyecté la cookie pero Google no reconoció la sesión (¿cookie ya expirada?).');
      process.exit(3);
    }
    writeConfig({ sub, seededAt: new Date().toISOString(), seededFrom: 'backend-cookie' });
    console.log(`✓ Perfil sembrado desde la cookie del backend. Cuenta Noir: ${sub}`);
  } finally {
    await context.close();
  }
}

main().catch((e) => {
  console.error('Error en seed:', e?.message || e);
  process.exit(1);
});
