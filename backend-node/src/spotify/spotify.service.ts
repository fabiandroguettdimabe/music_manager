import { Injectable } from '@nestjs/common';
import { readJson, removeFile } from '../common/paths';
import { ProviderAccountService } from '../providers/provider-account.service';

const SPOTIFY_API = 'https://api.spotify.com/v1';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const LEGACY_FILE = 'spotify_token.json';

@Injectable()
export class SpotifyService {
  constructor(private readonly accounts: ProviderAccountService) {}

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
        if (!resp.ok) throw new Error(`refresh failed: ${resp.status}`);
        const tok: any = await resp.json();
        data.access_token = tok.access_token;
        data.expires_at = Math.floor(now) + (tok.expires_in || 3600);
        if (tok.refresh_token) data.refresh_token = tok.refresh_token;
        if (tok.scope) data.scope = tok.scope;
        await this.saveToken(userId, data);
      } catch (e: any) {
        console.warn('[spotify] token refresh failed:', e?.message);
        return null;
      }
    }
    return data.access_token || null;
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
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
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
