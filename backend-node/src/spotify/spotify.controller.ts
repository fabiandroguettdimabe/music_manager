import { Body, Controller, Get, Headers, HttpException, Param, Post, Query } from '@nestjs/common';
import * as crypto from 'crypto';
import { SpotifyService } from './spotify.service';
import { ProviderAccountService } from '../providers/provider-account.service';

const SPOTIFY_AUTH_BASE = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_SCOPES =
  'streaming user-read-email user-read-private ' +
  'user-library-read playlist-read-private playlist-read-collaborative ' +
  'user-read-playback-state user-modify-playback-state';

const REQUIRED_SCOPES = new Set([
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'streaming',
  'user-read-private',
  'user-read-email',
  'user-read-playback-state',
  'user-modify-playback-state',
]);

@Controller('spotify')
export class SpotifyController {
  private pendingStates = new Map<string, { clientId: string; createdAt: number }>();

  constructor(
    private readonly spotify: SpotifyService,
    private readonly accounts: ProviderAccountService,
  ) {}

  @Get('status')
  async status(@Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    const data = await this.spotify.loadToken(userId);
    if (!data) return { authenticated: false, token_exists: false };

    const token = await this.spotify.getAccessToken(userId);
    if (!token) return { authenticated: false, token_exists: true };

    const storedScopes = new Set<string>((data.scope || '').split(' ').filter(Boolean));
    const missing = [...REQUIRED_SCOPES].filter((s) => !storedScopes.has(s));

    try {
      const resp = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        const user: any = await resp.json();
        const imgs = user.images || [];
        return {
          authenticated: true,
          user_name: user.display_name || 'Usuario',
          product: user.product || 'unknown',
          image: imgs.length ? imgs[0].url : '',
          needs_reauth: missing.length > 0,
          missing_scopes: missing,
        };
      }
    } catch (e: any) {
      console.warn('[spotify] status error:', e?.message);
    }
    return { authenticated: false, token_exists: true };
  }

  @Get('auth-url')
  authUrl(@Query('client_id') clientId: string, @Query('redirect_uri') redirectUri: string) {
    if (!clientId || !redirectUri) {
      throw new HttpException({ detail: 'Faltan client_id o redirect_uri' }, 400);
    }
    const state = crypto.randomBytes(16).toString('base64url');
    const now = Date.now();
    this.pendingStates.set(state, { clientId, createdAt: now });
    for (const [k, v] of this.pendingStates) {
      if (now - v.createdAt > 600_000) this.pendingStates.delete(k);
    }
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: SPOTIFY_SCOPES,
      state,
    });
    return { url: `${SPOTIFY_AUTH_BASE}?${params.toString()}`, state };
  }

  @Post('exchange')
  async exchange(@Body() body: any, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    const code = (body?.code || '').trim();
    const state = (body?.state || '').trim();
    const clientId = (body?.client_id || '').trim();
    const clientSecret = (body?.client_secret || '').trim();
    const redirectUri = (body?.redirect_uri || '').trim();

    if (!code || !clientId || !clientSecret || !redirectUri) {
      throw new HttpException({ detail: 'Faltan parámetros requeridos' }, 400);
    }

    // Verifica el state anti-CSRF (un solo uso) generado en /auth-url. Si el backend
    // se reinició entre el inicio y el callback, el state se pierde → reiniciar conexión.
    if (!state || !this.pendingStates.has(state)) {
      throw new HttpException(
        { detail: 'Estado de autorización inválido o caducado. Reinicia la conexión con Spotify.' },
        400,
      );
    }
    this.pendingStates.delete(state);

    const resp = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!resp.ok) {
      let detail = 'Error al intercambiar el código de autorización';
      try {
        const err: any = await resp.json();
        detail = err.error_description || detail;
      } catch {
        /* ignore */
      }
      throw new HttpException({ detail }, 400);
    }

    const tok: any = await resp.json();
    await this.spotify.saveToken(userId, {
      _client_id: clientId,
      _client_secret: clientSecret,
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (tok.expires_in || 3600),
      scope: tok.scope || '',
    });
    return { status: 'ok' };
  }

  @Get('token')
  async token(@Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    const token = await this.spotify.getAccessToken(userId);
    if (!token) throw new HttpException({ detail: 'No autenticado con Spotify' }, 401);
    return { access_token: token };
  }

  /**
   * Estado de rate-limit { limited, retryAfter }. Por defecto devuelve lo CONOCIDO
   * (sin pedir nada a Spotify); con ?measure=1 hace una sonda para medirlo.
   */
  @Get('ratelimit')
  async ratelimit(@Query('measure') measure?: string, @Headers('authorization') authHeader?: string) {
    if (measure === '1') {
      const userId = await this.accounts.resolveUserId(authHeader);
      return this.spotify.checkRateLimit(userId);
    }
    return this.spotify.rateLimitStatus();
  }

  @Get('playlists')
  async playlists(@Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    try {
      const data = await this.spotify.spotifyGet(userId, '/me/playlists', { limit: 50 });
      const out = (data.items || [])
        .filter(Boolean)
        .map((p: any) => {
          const imgs = p.images || [];
          return {
            id: p.id,
            title: p.name || 'Sin título',
            // Feb-2026: Spotify renombró `tracks` → `items` en el objeto playlist.
            count: (p.items ?? p.tracks)?.total || 0,
            thumbnail: imgs.length ? imgs[0].url : '',
          };
        });
      return { playlists: out };
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes('401')) throw new HttpException({ detail: 'Sesión de Spotify expirada' }, 401);
      throw new HttpException({ detail: msg }, 500);
    }
  }

  @Get('liked')
  async liked(@Query('limit') limitStr?: string, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    const limit = limitStr ? parseInt(limitStr, 10) : 500;
    try {
      const tracks: any[] = [];
      let offset = 0;
      while (tracks.length < limit) {
        const batch = Math.min(50, limit - tracks.length);
        const data = await this.spotify.spotifyGet(userId, '/me/tracks', { limit: batch, offset });
        const items = data.items || [];
        if (!items.length) break;
        for (const item of items) {
          const t = item.track;
          if (t && t.type === 'track') tracks.push(this.spotify.formatTrack(t));
        }
        if (items.length < batch) break;
        offset += batch;
      }
      return { title: 'Canciones que te gustan', tracks };
    } catch (e: any) {
      throw new HttpException({ detail: String(e?.message || e) }, 500);
    }
  }

  @Get('playlist/:id')
  async playlist(
    @Param('id') id: string,
    @Query('limit') limitStr?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const userId = await this.accounts.resolveUserId(authHeader);
    const limit = limitStr ? parseInt(limitStr, 10) : 500;
    try {
      const pl = await this.spotify.spotifyGet(userId, `/playlists/${id}`, { market: 'from_token' });
      const title = pl.name || 'Playlist';
      const tracks: any[] = [];
      let offset = 0;
      while (tracks.length < limit) {
        const batch = Math.min(100, limit - tracks.length);
        // Feb-2026: endpoint renombrado `/tracks` → `/items`; cada elemento `.track` → `.item`.
        const data = await this.spotify.spotifyGet(userId, `/playlists/${id}/items`, {
          limit: batch,
          offset,
          market: 'from_token',
        });
        const items = data.items || [];
        if (!items.length) break;
        for (const item of items) {
          const t = item.item ?? item.track;
          if (t && t.type === 'track') tracks.push(this.spotify.formatTrack(t));
        }
        if (items.length < batch) break;
        offset += batch;
      }
      return { title, tracks };
    } catch (e: any) {
      const msg = String(e?.message || e);
      console.warn('[spotify] playlist tracks error:', msg);
      if (msg.includes('403')) throw new HttpException({ detail: msg }, 403);
      if (msg.includes('401'))
        throw new HttpException({ detail: 'Sesión de Spotify expirada. Reconecta tu cuenta.' }, 401);
      throw new HttpException({ detail: msg }, 500);
    }
  }

  @Post('logout')
  async logout(@Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    await this.spotify.removeToken(userId);
    return { status: 'ok' };
  }
}
