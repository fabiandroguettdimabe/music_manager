// Ciclo de vida de la PWA: registro del service worker, aviso de nueva versión
// e invitación a instalar. Todo con DOM plano (sin depender de React) para que
// funcione aunque la app aún no haya montado, y con estilos acordes a Noir.

const BAR_STYLE = `
  position:fixed;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom));
  z-index:2147483647;display:flex;gap:12px;align-items:center;
  padding:12px 16px;border-radius:14px;
  background:rgba(20,20,22,.96);color:#fff;border:1px solid rgba(255,51,70,.35);
  box-shadow:0 10px 40px rgba(0,0,0,.6);backdrop-filter:blur(8px);
  font:500 14px/1.3 Inter,system-ui,sans-serif;max-width:min(92vw,420px);
`;
const BTN_STYLE = `
  cursor:pointer;border:0;border-radius:10px;padding:8px 14px;white-space:nowrap;
  background:linear-gradient(135deg,#ff3346,#7a0606);color:#fff;font:600 14px Inter,sans-serif;
`;
const GHOST_STYLE = 'cursor:pointer;border:0;background:none;color:#9aa;font:500 13px Inter,sans-serif;padding:6px;';

function showBar(text, actionLabel, onAction, id) {
  if (document.getElementById(id)) return;
  const bar = document.createElement('div');
  bar.id = id;
  bar.setAttribute('style', BAR_STYLE);
  bar.setAttribute('role', 'status');

  const span = document.createElement('span');
  span.textContent = text;
  span.style.flex = '1';

  const action = document.createElement('button');
  action.textContent = actionLabel;
  action.setAttribute('style', BTN_STYLE);
  action.onclick = () => { onAction(); bar.remove(); };

  const dismiss = document.createElement('button');
  dismiss.textContent = 'Ahora no';
  dismiss.setAttribute('style', GHOST_STYLE);
  dismiss.onclick = () => bar.remove();

  bar.append(span, action, dismiss);
  document.body.appendChild(bar);
  return bar;
}

export function registerPwa() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;

  // --- Registro + aviso de actualización ---
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // Si aparece un worker nuevo y ya había uno controlando la página → hay update.
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            showBar('Hay una versión nueva de Noir.', 'Actualizar', () => {
              nw.postMessage('SKIP_WAITING');
            }, 'noir-update-bar');
          }
        });
      });
      // Busca actualizaciones al recuperar el foco (p.ej. al volver a abrir la PWA).
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(console.error);

    // Cuando el worker nuevo toma el control, recarga una sola vez para estrenarlo.
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });

  // --- Invitación a instalar (Android/Chrome) ---
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    if (isStandalone) return;
    showBar('Instala Noir para reproducir en pantalla completa.', 'Instalar', async () => {
      e.prompt();
      await e.userChoice.catch(() => {});
    }, 'noir-install-bar');
  });
  window.addEventListener('appinstalled', () => {
    document.getElementById('noir-install-bar')?.remove();
  });
}
