// Usa collectCookies()/syncCookiesToBackend() de cookies.js (cargado antes en popup.html).

const statusEl = document.getElementById('status');
const btn = document.getElementById('connect');
const detectBtn = document.getElementById('detect-token');
const backendEl = document.getElementById('backend');
const tokenEl = document.getElementById('token');
const autoEl = document.getElementById('auto-status');

function fmtAuto({ time, ok, count, error } = {}) {
  if (!time) return 'Auto-sync: aún no corrió (cada 3 h en segundo plano).';
  const when = new Date(time).toLocaleString();
  return ok
    ? `Auto-sync: ✅ ${when} (${count} cookies)`
    : `Auto-sync: ❌ ${when} — ${error}`;
}

chrome.storage.local.get(['backend', 'token', 'lastAutoSync']).then(({ backend, token, lastAutoSync }) => {
  if (backend) backendEl.value = backend;
  if (token) tokenEl.value = token;
  autoEl.textContent = fmtAuto(lastAutoSync);
});

// Busca `rsp_token` en el localStorage de cada pestaña abierta (donde sea que tengas
// Noir cargado) — así no hay que copiarlo a mano. Necesita "scripting"+"tabs".
detectBtn.addEventListener('click', async () => {
  detectBtn.disabled = true;
  statusEl.textContent = 'Buscando Noir en tus pestañas abiertas…';
  try {
    const tabs = await chrome.tabs.query({});
    let found = null;
    for (const tab of tabs) {
      if (!tab.id || !/^https?:/.test(tab.url || '')) continue;
      try {
        const [{ result } = {}] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => { try { return localStorage.getItem('rsp_token'); } catch { return null; } },
        });
        if (result) { found = { token: result, origin: new URL(tab.url).origin }; break; }
      } catch {
        // pestaña no scripteable (chrome://, web store, etc.) — sigue con la próxima
      }
    }
    if (found) {
      tokenEl.value = found.token;
      if (!backendEl.value.trim()) backendEl.value = found.origin;
      statusEl.textContent = `✅ Token detectado (de ${found.origin}). Ahora pulsa "Conectar".`;
    } else {
      statusEl.textContent = '❌ No encontré Noir abierto y logueado en ninguna pestaña. Ábrelo, inicia sesión, y reintenta (o pégalo a mano).';
    }
  } finally {
    detectBtn.disabled = false;
  }
});

btn.addEventListener('click', async () => {
  const backend = backendEl.value.trim().replace(/\/+$/, '');
  const token = tokenEl.value.trim();
  if (!backend) { statusEl.textContent = '❌ Escribe la URL del backend.'; return; }
  if (!token) { statusEl.textContent = '❌ Pega tu token de sesión (rsp_token).'; return; }

  btn.disabled = true;
  statusEl.textContent = 'Leyendo cookies…';
  await chrome.storage.local.set({ backend, token });
  const result = await syncCookiesToBackend(backend, token);
  if (result.ok) {
    statusEl.textContent = `✅ ¡Conectado! Se enviaron ${result.count} cookies.\nDe ahora en más se reenvía sola cada 3 h.`;
  } else {
    statusEl.textContent =
      '❌ ' + result.error +
      (/fetch|failed|networkerror/i.test(result.error)
        ? '\n\n¿El backend está encendido y la URL es correcta? Para el VPS añade el origen de la extensión a ALLOWED_ORIGINS o usa localhost.'
        : '');
  }
  btn.disabled = false;
});
