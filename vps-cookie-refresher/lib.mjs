// Utilidades compartidas entre login.mjs y refresh.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// El mismo filtro que usa el backend/extensión: solo estas cookies (+ __Secure-*).
// Mandar los cientos de ST-* revienta el parser de YT Music, por eso se filtran.
const RELEVANT = new Set([
  'SID', 'HSID', 'SSID', 'APISID', 'SAPISID', 'LOGIN_INFO', 'SIDCC', 'YSC',
  'VISITOR_INFO1_LIVE', 'VISITOR_PRIVACY_METADATA', 'PREF', 'CONSENT', 'NID',
]);

// Sin al menos una de estas NO hay sesión de Google iniciada.
const AUTH_KEYS = ['SAPISID', '__Secure-3PAPISID', 'SID', '__Secure-1PSID', '__Secure-3PSID'];

export function isRelevant(name) {
  return RELEVANT.has(name) || name.startsWith('__Secure-');
}

/** ¿El array de cookies de Playwright representa una sesión de Google iniciada? */
export function hasSession(cookies) {
  const names = new Set(cookies.map((c) => c.name));
  return AUTH_KEYS.some((k) => names.has(k));
}

/** Construye el header `Cookie` (name=value; ...) a partir de las cookies del contexto. */
export function buildCookieHeader(cookies) {
  const map = new Map();
  for (const c of cookies) {
    if (!isRelevant(c.name)) continue;
    if (!map.has(c.name)) map.set(c.name, c.value);
  }
  return [...map].map(([k, v]) => `${k}=${v}`).join('; ');
}

export function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : def;
}

/** Carpeta del perfil persistente del navegador (userDataDir). Se reusa entre login y refresh. */
export function userDataDir() {
  return arg('profile', process.env.NOIR_PROFILE_DIR || path.join(HERE, 'profile'));
}

const CONFIG_PATH = path.join(HERE, 'config.json');

export function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

export function writeConfig(patch) {
  const cur = readConfig();
  const next = { ...cur, ...patch };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2) + '\n');
  return next;
}

/** Extrae el `sub` (userId de Noir) del payload de un JWT SIN verificar firma (solo decode). */
export function subFromToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload?.sub || null;
  } catch {
    return null;
  }
}
