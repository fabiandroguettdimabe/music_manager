#!/usr/bin/env node
// Login SEMILLA — se corre UNA sola vez, de forma interactiva (headful), tú resolviendo
// 2FA/CAPTCHA como humano. NO se guarda tu contraseña: Google la valida en el navegador
// real y solo persistimos las cookies de sesión en el perfil (userDataDir).
//
// Uso (en una máquina CON pantalla; normalmente tu PC, no el VPS headless):
//   npm run login -- --token "<JWT de Noir>"     # de DevTools → Local Storage → rsp_token
//   npm run login -- --sub  "<userId de Noir>"    # alternativa si conoces el id directo
//
// Después copias la carpeta ./profile al VPS (ver README) y el refresco corre solo allí.

import { chromium } from 'playwright';
import { arg, userDataDir, hasSession, writeConfig, subFromToken } from './lib.mjs';

const START_URL = 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F';
const POLL_MS = 3000;
const TIMEOUT_MS = 10 * 60 * 1000; // 10 min para completar el login a mano

async function main() {
  const token = arg('token');
  const sub = arg('sub') || (token ? subFromToken(token) : null);
  if (!sub) {
    console.error(
      'Falta identificar tu cuenta Noir. Pasa --token "<JWT>" (de Local Storage → rsp_token) ' +
        'o --sub "<userId>". El refresco lo necesita para saber a qué usuario guardar la cookie.',
    );
    process.exit(1);
  }

  const dir = userDataDir();
  console.log(`Perfil del navegador: ${dir}`);
  const context = await chromium.launchPersistentContext(dir, {
    headless: false,
    channel: process.env.NOIR_CHROME_CHANNEL || undefined, // 'chrome' si tienes Chrome real
    viewport: { width: 1280, height: 900 },
    args: ['--no-first-run'],
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(START_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});

  console.log('\n▶ Inicia sesión en la ventana del navegador (usuario, contraseña, 2FA).');
  console.log('  Cuando llegues a music.youtube.com ya logueado, detecto la sesión solo.\n');

  const deadline = Date.now() + TIMEOUT_MS;
  let ok = false;
  while (Date.now() < deadline) {
    const cookies = await context.cookies().catch(() => []);
    if (hasSession(cookies) && cookies.some((c) => c.name === 'LOGIN_INFO')) {
      ok = true;
      break;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  if (!ok) {
    console.error('\n✗ No detecté una sesión de YouTube iniciada dentro del tiempo límite.');
    await context.close();
    process.exit(1);
  }

  writeConfig({ sub, seededAt: new Date().toISOString() });
  console.log('\n✓ Sesión detectada y guardada en el perfil. Cuenta Noir:', sub);
  console.log('  Cerrando navegador… ya puedes copiar ./profile al VPS y programar el refresco.');
  await context.close();
}

main().catch((e) => {
  console.error('Error en login:', e?.message || e);
  process.exit(1);
});
