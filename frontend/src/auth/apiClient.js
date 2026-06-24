// Cliente de autenticación de la app + interceptor de fetch que adjunta el JWT
// SOLO a las peticiones a /api (las externas a Spotify/YouTube quedan intactas).

const TOKEN_KEY = 'rsp_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
};

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
  return data.user;
}

export const apiLogin = (email, password) => postAuth('login', { email, password });
export const apiRegister = (email, password, name) => postAuth('register', { email, password, name });

export async function apiMe() {
  if (!getToken()) return null;
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) {
      if (res.status === 401) setToken(null);
      return null;
    }
    return await res.json();
  } catch {
    return null;
  }
}

export function apiLogout() {
  setToken(null);
}
