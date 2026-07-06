// Lee las cookies de sesión de Google/YouTube (ya descifradas por el navegador,
// sortea App-Bound Encryption y el bloqueo del archivo) y las envía al backend.

const RELEVANT = new Set([
  'SID', 'HSID', 'SSID', 'APISID', 'SAPISID', 'LOGIN_INFO', 'SIDCC', 'YSC',
  'VISITOR_INFO1_LIVE', 'VISITOR_PRIVACY_METADATA', 'PREF', 'CONSENT', 'NID',
]);
const AUTH_KEYS = ['SAPISID', '__Secure-3PAPISID', 'SID', '__Secure-1PSID', '__Secure-3PSID'];

function isRelevant(name) {
  return RELEVANT.has(name) || name.startsWith('__Secure-');
}

async function collectCookies() {
  const map = new Map();
  // .youtube.com primero (LOGIN_INFO) y luego .google.com (SAPISID, __Secure-*).
  for (const domain of ['youtube.com', 'google.com']) {
    let cookies = [];
    try {
      cookies = await chrome.cookies.getAll({ domain });
    } catch (e) {
      // continúa con el otro dominio
    }
    for (const c of cookies) {
      if (!isRelevant(c.name)) continue;
      if (!map.has(c.name)) map.set(c.name, c.value);
    }
  }
  return map;
}

const statusEl = document.getElementById('status');
const btn = document.getElementById('connect');
const backendEl = document.getElementById('backend');

chrome.storage.local.get('backend').then(({ backend }) => {
  if (backend) backendEl.value = backend;
});

btn.addEventListener('click', async () => {
  const backend = backendEl.value.trim().replace(/\/+$/, '');
  if (!backend) { statusEl.textContent = '❌ Escribe la URL del backend.'; return; }

  btn.disabled = true;
  statusEl.textContent = 'Leyendo cookies…';
  try {
    const map = await collectCookies();
    if (!AUTH_KEYS.some((k) => map.has(k))) {
      statusEl.textContent =
        '❌ No hay sesión de YouTube en este navegador.\nAbre music.youtube.com, inicia sesión y reintenta.';
      return;
    }
    const cookie = [...map].map(([k, v]) => `${k}=${v}`).join('; ');
    await chrome.storage.local.set({ backend });

    statusEl.textContent = `Enviando ${map.size} cookies a ${backend}…`;
    const res = await fetch(`${backend}/api/save-auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { cookie } }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);

    statusEl.textContent = `✅ ¡Conectado! Se enviaron ${map.size} cookies.\nYa puedes cerrar esto.`;
  } catch (e) {
    const msg = String(e.message || e);
    statusEl.textContent =
      '❌ ' + msg +
      (/fetch|Failed|NetworkError/i.test(msg)
        ? '\n\n¿El backend está encendido y la URL es correcta? Para el VPS añade el origen de la extensión a ALLOWED_ORIGINS o usa localhost.'
        : '');
  } finally {
    btn.disabled = false;
  }
});
