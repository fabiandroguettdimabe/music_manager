import { HttpException, Injectable, Logger } from '@nestjs/common';
import { readJson, removeFile } from '../common/paths';
import { ProviderAccountService } from '../providers/provider-account.service';

const SPOTIFY_API = 'https://api.spotify.com/v1';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const LEGACY_FILE = 'spotify_token.json';

@Injectable()
export class SpotifyService {
  private readonly log = new Logger('Spotify');
  // Último 429 visto (de cualquier petición del backend), para saber cuánto esperar.
  private lastRateLimit: { until: number; retryAfter: number } | null = null;

  constructor(private readonly accounts: ProviderAccountService) {}

  /** Estado de rate-limit conocido (sin pedir nada): segundos restantes hasta poder reintentar. */
  rateLimitStatus(): { limited: boolean; retryAfter: number } {
    if (!this.lastRateLimit) return { limited: false, retryAfter: 0 };
    const remaining = Math.ceil((this.lastRateLimit.until - Date.now()) / 1000);
    if (remaining <= 0) {
      this.lastRateLimit = null;
      return { limited: false, retryAfter: 0 };
    }
    return { limited: true, retryAfter: remaining };
  }

  /** Sonda ligera (1 request) para medir el `Retry-After` actual del usuario. */
  async checkRateLimit(userId: string): Promise<{ limited: boolean; retryAfter: number }> {
    const known = this.rateLimitStatus();
    if (known.limited) return known; // ya lo sabemos, no gastar otra petición
    const token = await this.getAccessToken(userId);
    if (!token) return { limited: false, retryAfter: 0 };
    try {
      const resp = await fetch(`${SPOTIFY_API}/me/playlists?limit=1`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.status === 429) {
        const ra = Number(resp.headers.get('retry-after')) || 1;
        this.lastRateLimit = { until: Date.now() + ra * 1000, retryAfter: ra };
        this.log.warn(`rate-limit activo: Retry-After ${ra}s`);
        return { limited: true, retryAfter: ra };
      }
      return { limited: false, retryAfter: 0 };
    } catch {
      return { limited: false, retryAfter: 0 };
    }
  }

  /** Carga el token del usuario desde la BD; migra el archivo legacy al usuario por defecto la 1ª vez. */
  async loadToken(userId: string): Promise<any | null> {
    let data = await this.accounts.getAuth(userId, 'spotify');
    if (!data) {
      const def = await this.accounts.defaultUserId();
      if (userId === def) {
        const legacy = readJson(LEGACY_FILE);
        if (legacy?.access_token) {
          await this.accounts.setAuth(userId, 'spotify', legacy);
          removeFile(LEGACY_FILE); // migrado y cifrado en BD → quitar el archivo plano
          data = legacy;
        }
      }
    }
    return data;
  }

  async saveToken(userId: string, data: any): Promise<void> {
    await this.accounts.setAuth(userId, 'spotify', data);
  }

  async removeToken(userId: string): Promise<void> {
    await this.accounts.deleteAuth(userId, 'spotify');
  }

  async tokenExists(userId: string): Promise<boolean> {
    return !!(await this.loadToken(userId));
  }

  /** Devuelve un access token válido, refrescándolo automáticamente si hace falta. */
  async getAccessToken(userId: string): Promise<string | null> {
    const data = await this.loadToken(userId);
    if (!data) return null;

    const now = Date.now() / 1000;
    if (now >= (data.expires_at || 0) - 60) {
      const ok = await this.refreshAccessToken(data);
      if (!ok) return null;
      await this.saveToken(userId, data);
    }
    return data.access_token || null;
  }

  /**
   * Refresca `data.access_token` in-place. Reintenta ante fallos transitorios
   * (red, 429, 5xx) con backoff; NO reintenta si el refresh_token fue revocado
   * (400 invalid_grant) — eso requiere reconexión del usuario. Conserva el
   * refresh_token y el scope anteriores si la respuesta no los reenvía.
   * Devuelve true si el token quedó válido.
   */
  private async refreshAccessToken(data: any): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const resp = await fetch(SPOTIFY_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: data.refresh_token,
            client_id: data._client_id,
            client_secret: data._client_secret,
          }),
        });
        if (resp.ok) {
          const tok: any = await resp.json();
          data.access_token = tok.access_token;
          data.expires_at = Math.floor(Date.now() / 1000) + (tok.expires_in || 3600);
          if (tok.refresh_token) data.refresh_token = tok.refresh_token;
          if (tok.scope) data.scope = tok.scope;
          return true;
        }
        // 400 = invalid_grant: el refresh_token caducó/se revocó → terminal, no reintentar.
        if (resp.status === 400) {
          console.warn('[spotify] refresh rechazado (sesión revocada); requiere reconexión');
          return false;
        }
        console.warn(`[spotify] refresh intento ${attempt + 1}: HTTP ${resp.status}`);
      } catch (e: any) {
        console.warn(`[spotify] refresh intento ${attempt + 1} falló:`, e?.message);
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
    return false;
  }

  async spotifyGet(userId: string, path: string, params?: Record<string, any>): Promise<any> {
    const token = await this.getAccessToken(userId);
    if (!token) throw new Error('Spotify: no autenticado');

    const url = new URL(`${SPOTIFY_API}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    for (let attempt = 0; ; attempt++) {
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      // 429 (rate limit) o 5xx transitorio → esperar y reintentar, respetando
      // `Retry-After` de Spotify (con tope de 15 s y hasta 3 reintentos).
      if ((resp.status === 429 || resp.status >= 500) && attempt < 3) {
        const ra = Number(resp.headers.get('retry-after'));
        const secs = Number.isFinite(ra) && ra > 0 ? ra : 2 ** attempt;
        if (resp.status === 429) {
          this.lastRateLimit = { until: Date.now() + secs * 1000, retryAfter: secs };
          this.log.warn(`429 en ${path} — Retry-After ${secs}s (intento ${attempt + 1})`);
        }
        await new Promise((r) => setTimeout(r, Math.min(secs, 15) * 1000));
        continue;
      }
      if (!resp.ok) {
        let msg = resp.statusText;
        try {
          const body: any = await resp.json();
          msg = body?.error?.message || msg;
        } catch {
          /* ignore */
        }
        throw new Error(`Spotify ${resp.status}: ${msg}`);
      }
      return resp.json();
    }
  }

  /** POST/PUT a la Web API de Spotify (escritura). Mismo manejo de 429/5xx que spotifyGet. */
  async spotifyWrite(
    userId: string,
    path: string,
    body: any,
    method: 'POST' | 'PUT' = 'POST',
  ): Promise<any> {
    const token = await this.getAccessToken(userId);
    if (!token) throw new Error('Spotify: no autenticado');

    const url = `${SPOTIFY_API}${path}`;
    for (let attempt = 0; ; attempt++) {
      const resp = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      if ((resp.status === 429 || resp.status >= 500) && attempt < 3) {
        const ra = Number(resp.headers.get('retry-after'));
        const secs = Number.isFinite(ra) && ra > 0 ? ra : 2 ** attempt;
        if (resp.status === 429) {
          this.lastRateLimit = { until: Date.now() + secs * 1000, retryAfter: secs };
          this.log.warn(`429 en ${method} ${path} — Retry-After ${secs}s (intento ${attempt + 1})`);
        }
        await new Promise((r) => setTimeout(r, Math.min(secs, 15) * 1000));
        continue;
      }
      if (!resp.ok) {
        let msg = resp.statusText;
        try {
          const b: any = await resp.json();
          msg = b?.error?.message || msg;
        } catch {
          /* ignore */
        }
        const err: any = new Error(`Spotify ${resp.status}: ${msg}`);
        err.status = resp.status;
        throw err;
      }
      // Crear playlist devuelve JSON; añadir pistas devuelve snapshot_id; algunos 200 van vacíos.
      try {
        return await resp.json();
      } catch {
        return {};
      }
    }
  }

  /**
   * Crea una playlist nueva en la cuenta de Spotify del usuario. Las pistas que ya son de
   * Spotify usan su URI directa; las de otro origen (p.ej. YouTube) se RESUELVEN buscando su
   * equivalente en Spotify (`/search`). Requiere el scope `playlist-modify-*`; si falta,
   * Spotify responde 403 y devolvemos un mensaje pidiendo reconectar. Añade en tandas de 100.
   */
  async createSpotifyPlaylist(
    userId: string,
    name: string,
    tracks: Array<{ id?: string; uri?: string; title?: string; artist?: string; source?: string }>,
    isPublic = false,
  ): Promise<{ id: string; url: string; title: string; count: number; matched: number; skipped: number }> {
    const title = (name || '').trim();
    if (!title) throw new HttpException({ detail: 'Falta el nombre de la playlist.' }, 422);

    const items = (tracks || []).filter((t) => t && (t.uri || t.id || t.title));
    if (!items.length) throw new HttpException({ detail: 'No hay canciones para subir.' }, 422);

    const uriOf = (t: any): string | null => {
      if (typeof t?.uri === 'string' && t.uri.startsWith('spotify:track:')) return t.uri;
      if (t?.source === 'spotify' && typeof t?.id === 'string' && t.id.startsWith('spotify:track:')) return t.id;
      return null;
    };

    const resolved: (string | null)[] = new Array(items.length).fill(null);
    const toSearch: Array<{ idx: number; q: string }> = [];
    items.forEach((t, idx) => {
      const u = uriOf(t);
      if (u) resolved[idx] = u;
      else if (t.title) toSearch.push({ idx, q: `${t.title} ${t.artist || ''}`.trim() });
    });

    // Resuelve las foráneas buscándolas en Spotify (pool concurrente, con tope de coste).
    const SEARCH_CAP = 200;
    const searchList = toSearch.slice(0, SEARCH_CAP);
    const skippedNoSearch = toSearch.length - searchList.length;
    let matched = 0;
    let s = 0;
    const worker = async () => {
      while (s < searchList.length) {
        const { idx, q } = searchList[s++];
        try {
          const r = await this.spotifyGet(userId, '/search', { q, type: 'track', limit: 1 });
          const hit = r?.tracks?.items?.[0];
          if (hit?.uri) {
            resolved[idx] = hit.uri;
            matched++;
          }
        } catch {
          /* pista que no resuelve → se omite */
        }
      }
    };
    await Promise.all(Array.from({ length: 3 }, () => worker()));

    const seen = new Set<string>();
    const list: string[] = [];
    for (const u of resolved) if (u && !seen.has(u)) { seen.add(u); list.push(u); }
    if (!list.length) {
      throw new HttpException(
        { detail: 'No se encontró ninguna canción equivalente en Spotify para subir.' },
        422,
      );
    }
    const skipped = items.length - list.length + skippedNoSearch;

    let me: any;
    try {
      me = await this.spotifyGet(userId, '/me');
    } catch (e: any) {
      throw new HttpException(
        { detail: `No se pudo identificar tu usuario de Spotify: ${e?.message || e}` },
        502,
      );
    }
    const spUserId = me?.id;
    if (!spUserId) throw new HttpException({ detail: 'Spotify no devolvió tu id de usuario.' }, 502);

    let playlist: any;
    try {
      playlist = await this.spotifyWrite(userId, `/users/${encodeURIComponent(spUserId)}/playlists`, {
        name: title,
        public: isPublic,
        description: 'Creada desde Real Shuffle Player',
      });
    } catch (e: any) {
      if (e?.status === 403) {
        throw new HttpException(
          {
            detail:
              'Faltan permisos de escritura en Spotify. Reconecta tu cuenta de Spotify ' +
              'para habilitar la creación de playlists (scope playlist-modify).',
          },
          403,
        );
      }
      throw new HttpException(
        { detail: `No se pudo crear la playlist en Spotify: ${e?.message || e}` },
        502,
      );
    }
    const playlistId = playlist?.id;
    if (!playlistId) throw new HttpException({ detail: 'Spotify no devolvió el id de la playlist.' }, 502);

    let added = 0;
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100);
      // Esta versión de la API usa `/items`; caemos a `/tracks` (clásico) por compatibilidad.
      try {
        await this.spotifyWrite(userId, `/playlists/${playlistId}/items`, { uris: chunk });
        added += chunk.length;
      } catch {
        try {
          await this.spotifyWrite(userId, `/playlists/${playlistId}/tracks`, { uris: chunk });
          added += chunk.length;
        } catch (e: any) {
          this.log.warn(`add tracks falló para un lote: ${e?.message || e}`);
        }
      }
    }

    return { id: playlistId, url: playlist?.external_urls?.spotify || '', title, count: added, matched, skipped };
  }

  formatTrack(t: any): any {
    const artists = (t.artists || []).map((a: any) => a.name).join(', ');
    const imgs = t.album?.images || [];
    const ms = t.duration_ms || 0;
    const s = Math.floor(ms / 1000);
    return {
      id: t.uri || '',
      title: t.name || 'Desconocido',
      artist: artists || 'Artista Desconocido',
      thumbnail: imgs.length ? imgs[0].url : '',
      duration: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`,
      duration_seconds: s,
      uri: t.uri || '',
    };
  }
}
