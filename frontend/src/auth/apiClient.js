// Cliente de autenticación de la app + interceptor de fetch que adjunta el JWT
// SOLO a las peticiones a /api (las externas a Spotify/YouTube quedan intactas).

const TOKEN_KEY = 'rsp_token';
const USER_KEY = 'rsp_user';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
};

// Último usuario confirmado por el backend. Permite mantener la sesión visible
// mientras el backend está reiniciando (sin él, un reinicio mandaría al login
// aunque el token siga vigente).
export const getCachedUser = () => {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
};
const setCachedUser = (u) => {
  if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
  else localStorage.removeItem(USER_KEY);
};

// Cierra sesión de verdad: solo cuando el token es inválido (401) o el usuario
// pulsa "salir". NUNCA por un error de red.
function clearSession() {
  setToken(null);
  setCachedUser(null);
}

let installed = false;
export function installAuthInterceptor() {
  if (installed) return;
  installed = true;
  const orig = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url;
    const isApi = typeof url === 'string' && url.startsWith('/api');
    const token = getToken();
    if (isApi && token) {
      const headers = new Headers(init.headers || (typeof input === 'object' ? input.headers : undefined));
      if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
      init = { ...init, headers };
    }
    return orig(input, init);
  };
}

async function postAuth(path, body) {
  const res = await fetch(`/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || 'Error de autenticación');
  setToken(data.token);
  setCachedUser(data.user);
  return data.user;
}

export const apiLogin = (email, password) => postAuth('login', { email, password });
export const apiRegister = (email, password, name) => postAuth('register', { email, password, name });

/**
 * Resuelve el usuario actual de la app distinguiendo tres casos:
 *  · sin token            → null (no hay sesión; mostrar login).
 *  · /me responde 200     → usuario (sesión válida; se cachea).
 *  · /me responde 401     → token inválido/caducado → cerrar sesión → null.
 *  · backend inalcanzable → reintenta con backoff; si sigue sin responder,
 *    devuelve el usuario cacheado para NO sacar al usuario de la sesión por un
 *    simple reinicio del backend (el token de 30 días sigue siendo válido).
 */
export async function apiMe({ retries = 4 } = {}) {
  if (!getToken()) return null;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const u = await res.json();
        setCachedUser(u);
        return u;
      }
      if (res.status === 401) {
        clearSession();
        return null;
      }
      // 5xx u otro estado no terminal (p.ej. el proxy de Vite mientras el
      // backend arranca) → reintentar.
    } catch {
      // Error de red: backend caído o reiniciando → reintentar.
    }
    if (attempt >= retries) {
      // No se pudo confirmar, pero el token sigue presente: mantener la sesión
      // con el usuario cacheado (null solo si nunca llegó a cachearse).
      return getCachedUser();
    }
    await new Promise((r) => setTimeout(r, Math.min(2000, 300 * 2 ** attempt)));
  }
}

export function apiLogout() {
  clearSession();
}
