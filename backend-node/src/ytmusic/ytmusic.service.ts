import { HttpException, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Innertube } from 'youtubei.js';
import { findFile, readJson, removeFile } from '../common/paths';
import { ProviderAccountService } from '../providers/provider-account.service';

// node:sqlite es experimental; require() evita problemas de @types y funciona en runtime (Node >= 22).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite');

const LEGACY_YT_FILE = 'oauth.json'; // archivo de cookies del backend mono-usuario anterior

interface CookieAuth {
  cookie: string;
  [key: string]: any;
}

interface Track {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: string;
  duration_seconds?: number;
}

@Injectable()
export class YtmusicService {
  // Caché de cliente Innertube por usuario (auth por cookie).
  private musicClients = new Map<string, { client: any; sig: string }>();
  // El cliente de streaming es anónimo y compartido (el audio público no requiere auth).
  private streamClient: any = null;

  constructor(private readonly accounts: ProviderAccountService) {}

  // ───────────────────────── credenciales (por usuario) ─────────────────────────

  /** Carga la cookie del usuario desde la BD; migra el oauth.json legacy al usuario por defecto la 1ª vez. */
  private async loadCookieAuth(userId: string): Promise<CookieAuth | null> {
    let blob = await this.accounts.getAuth<CookieAuth>(userId, 'ytmusic');
    if (!blob) {
      const def = await this.accounts.defaultUserId();
      if (userId === def) {
        const legacy = readJson(LEGACY_YT_FILE);
        if (legacy?.cookie) {
          await this.accounts.setAuth(userId, 'ytmusic', legacy);
          removeFile(LEGACY_YT_FILE); // migrado y cifrado en BD → quitar el archivo plano
          blob = legacy;
        }
      }
    }
    return blob?.cookie ? blob : null;
  }

  async hasAuth(userId: string): Promise<boolean> {
    return !!(await this.loadCookieAuth(userId));
  }

  invalidate(userId: string): void {
    this.musicClients.delete(userId);
  }

  // ─────────────────── SAPISIDHASH para el origin de música ───────────────────
  private static getCookieValue(cookie: string, name: string): string | null {
    const m = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
    return m ? m[1] : null;
  }

  private static musicSapisidHash(cookie: string): string | null {
    const sid =
      YtmusicService.getCookieValue(cookie, 'SAPISID') ||
      YtmusicService.getCookieValue(cookie, '__Secure-3PAPISID');
    if (!sid) return null;
    const ts = Math.floor(Date.now() / 1000);
    const origin = 'https://music.youtube.com';
    const hash = crypto.createHash('sha1').update(`${ts} ${sid} ${origin}`).digest('hex');
    return `SAPISIDHASH ${ts}_${hash}`;
  }

  private static musicFetch(cookie: string) {
    return async (input: any, init: any) => {
      let url: string = typeof input === 'string' ? input : input.url;
      const headers = new Headers(init?.headers || (typeof input === 'object' ? input.headers : undefined));
      const auth = headers.get('Authorization');
      if (auth && auth.startsWith('SAPISIDHASH')) {
        url = url.replace('://www.youtube.com/', '://music.youtube.com/');
        const musicAuth = YtmusicService.musicSapisidHash(cookie);
        if (musicAuth) headers.set('Authorization', musicAuth);
        headers.set('Origin', 'https://music.youtube.com');
        headers.set('X-Origin', 'https://music.youtube.com');
        headers.set('X-Goog-AuthUser', '0');
      }
      const method = typeof input === 'string' ? init?.method || 'GET' : input.method;
      return fetch(url, { method, headers, body: init?.body, redirect: init?.redirect || 'follow' });
    };
  }

  // ───────────────────────── clientes ─────────────────────────

  private async getMusicClient(userId: string): Promise<any> {
    const blob = await this.loadCookieAuth(userId);
    const sig = blob ? crypto.createHash('sha1').update(blob.cookie).digest('hex') : 'anon';
    const cached = this.musicClients.get(userId);
    if (cached && cached.sig === sig) return cached.client;

    let client: any;
    if (blob) {
      client = await Innertube.create({
        cookie: blob.cookie,
        retrieve_player: false,
        fetch: YtmusicService.musicFetch(blob.cookie),
      });
    } else {
      client = await Innertube.create({ retrieve_player: false });
    }
    this.musicClients.set(userId, { client, sig });
    return client;
  }

  /** Streaming: sesión anónima con player. Mandar cookie/SAPISIDHASH al player IOS lo hace responder 400. */
  private async getStreamClient(): Promise<any> {
    if (!this.streamClient) this.streamClient = await Innertube.create({ retrieve_player: true });
    return this.streamClient;
  }

  // ───────────────────────── mappers ─────────────────────────
  private static mapTrack(it: any): Track {
    const artist =
      it.artists?.[0]?.name || it.author?.name || it.authors?.[0]?.name || 'Artista Desconocido';
    const thumbs = it.thumbnails || [];
    return {
      id: it.id,
      title: it.title || 'Canción Desconocida',
      artist,
      thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : '',
      duration: it.duration?.text || '?',
      duration_seconds: it.duration?.seconds || 0,
    };
  }

  // ───────────────────────── raw browse ─────────────────────────
  private static sections(resp: any): any[] {
    return (
      resp?.data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
        ?.sectionListRenderer?.contents || []
    );
  }

  private static isSignedOut(resp: any): boolean {
    const secs = YtmusicService.sections(resp);
    return secs.some((x: any) => x.itemSectionRenderer?.contents?.some((c: any) => c.messageRenderer));
  }

  private async rawBrowse(userId: string, browseId: string): Promise<any> {
    const yt = await this.getMusicClient(userId);
    return yt.actions.execute('/browse', { browseId, client: 'YTMUSIC', parse: false });
  }

  // ───────────────────────── API pública ─────────────────────────

  async search(userId: string, q: string): Promise<{ query: string; tracks: Track[] }> {
    const yt = await this.getMusicClient(userId);
    let res = await yt.music.search(q, { type: 'song' });
    let items: any[] = res.songs?.contents || [];
    if (!items.length) {
      res = await yt.music.search(q, { type: 'video' });
      items = res.videos?.contents || [];
    }
    const tracks: Track[] = items
      .filter((it) => it.id)
      .map((it) => {
        const artist =
          (it.artists || []).map((a: any) => a.name).filter(Boolean).join(', ') ||
          it.author?.name ||
          'Artista Desconocido';
        const thumbs = it.thumbnails || [];
        return {
          id: it.id,
          title: it.title || 'Desconocido',
          artist,
          thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : '',
          duration: it.duration?.text || '',
        };
      });
    return { query: q, tracks };
  }

  async getLibraryPlaylists(userId: string): Promise<{ playlists: any[] }> {
    const resp = await this.rawBrowse(userId, 'FEmusic_liked_playlists');
    if (YtmusicService.isSignedOut(resp)) {
      throw new HttpException(
        { detail: 'Sesión expirada o sin autenticación. Reconecta tu cuenta de YouTube Music.' },
        401,
      );
    }

    const out: any[] = [];
    const seen = new Set<string>();

    const pushTwoRow = (r: any) => {
      if (!r) return;
      const browseId = r.navigationEndpoint?.browseEndpoint?.browseId;
      if (!browseId || !/^(VL)?(PL|LM|RDCLAK|OLAK)/.test(browseId)) return;
      const id = browseId.replace(/^VL/, '');
      if (seen.has(id)) return;
      seen.add(id);
      const thumbs = r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
      const subtitle = (r.subtitle?.runs || []).map((x: any) => x.text).join('');
      const countMatch = subtitle.match(/(\d+)\s*(songs|song|canciones|canción|pistas|tracks)/i);
      out.push({
        id,
        title: r.title?.runs?.[0]?.text || 'Sin título',
        count: countMatch ? parseInt(countMatch[1], 10) : 0,
        thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : '',
      });
    };

    const pushResponsive = (r: any) => {
      if (!r) return;
      const browseId = r.navigationEndpoint?.browseEndpoint?.browseId;
      if (!browseId) return;
      const id = browseId.replace(/^VL/, '');
      if (seen.has(id)) return;
      seen.add(id);
      const title =
        r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text ||
        'Sin título';
      const thumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
      out.push({ id, title, count: 0, thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : '' });
    };

    for (const sec of YtmusicService.sections(resp)) {
      const inner = sec.itemSectionRenderer?.contents || [sec];
      for (const node of inner) {
        const grid = node.gridRenderer;
        const shelf = node.musicShelfRenderer || node.musicPlaylistShelfRenderer;
        const carousel = node.musicCarouselShelfRenderer;
        if (grid) for (const it of grid.items || []) pushTwoRow(it.musicTwoRowItemRenderer);
        if (carousel) for (const it of carousel.contents || []) pushTwoRow(it.musicTwoRowItemRenderer);
        if (shelf) for (const it of shelf.contents || []) pushResponsive(it.musicResponsiveListItemRenderer);
      }
    }

    if (!out.length) {
      throw new HttpException(
        {
          detail:
            'No se encontraron playlists. Tu sesión puede haber expirado. Reconecta tu cuenta de YouTube Music.',
        },
        401,
      );
    }
    return { playlists: out };
  }

  async getLikedSongs(userId: string, limit = 5000): Promise<{ title: string; tracks: Track[] }> {
    const yt = await this.getMusicClient(userId);
    let pl: any;
    try {
      pl = await yt.music.getPlaylist('LM');
    } catch {
      pl = null;
    }
    const items: any[] = (pl?.items || []).filter((i: any) => i.id);

    let guard = 0;
    while (pl?.has_continuation && items.length < limit && guard < 100) {
      pl = await pl.getContinuation();
      items.push(...(pl?.items || []).filter((i: any) => i.id));
      guard++;
    }

    return {
      title: 'Canciones que te gustan',
      tracks: items.slice(0, limit).map((it) => YtmusicService.mapTrack(it)),
    };
  }

  async getPlaylist(userId: string, playlistId: string, limit = 5000): Promise<{ title: string; tracks: Track[] }> {
    const yt = await this.getMusicClient(userId);
    const id = playlistId.replace(/^VL/, '');
    let pl = await yt.music.getPlaylist(id);

    // El título sale de la 1ª página: getContinuation() no trae header.
    const header = pl.header || {};
    const title = header.title?.text || header.title?.toString?.() || 'Playlist';

    const items: any[] = (pl.items || []).filter((i: any) => i.id);
    let guard = 0;
    while (pl.has_continuation && items.length < limit && guard < 100) {
      pl = await pl.getContinuation();
      items.push(...(pl.items || []).filter((i: any) => i.id));
      guard++;
    }

    return { title, tracks: items.slice(0, limit).map((it) => YtmusicService.mapTrack(it)) };
  }

  /** Resuelve una URL de audio directa (cliente IOS anónimo). */
  async resolveAudioUrl(videoId: string): Promise<string> {
    const yt = await this.getStreamClient();
    const info = await yt.getInfo(videoId, { client: 'IOS' });
    const fmt = info.chooseFormat({ type: 'audio', quality: 'best' });
    let url: string | undefined = fmt?.url;
    if (!url && fmt?.decipher) {
      try {
        url = fmt.decipher(yt.session.player);
      } catch {
        /* fall through */
      }
    }
    if (!url) throw new Error('No se pudo resolver la URL de audio');
    return url;
  }

  // ───────────────────────── status / gestión de auth ─────────────────────────

  async getStatus(userId: string): Promise<{ authenticated: boolean; oauth_exists: boolean; user_name: string | null }> {
    if (!(await this.hasAuth(userId))) {
      return { authenticated: false, oauth_exists: false, user_name: null };
    }
    try {
      const resp = await this.rawBrowse(userId, 'FEmusic_liked_playlists');
      if (YtmusicService.isSignedOut(resp)) {
        return { authenticated: false, oauth_exists: true, user_name: 'Sesión expirada' };
      }
      return { authenticated: true, oauth_exists: true, user_name: null };
    } catch (e: any) {
      console.warn('[ytmusic] status check error:', e?.message);
      return { authenticated: false, oauth_exists: true, user_name: null };
    }
  }

  private parseAuthContent(content: any): { cookie?: string; visitorId?: string; clientVersion?: string } {
    let cookie: string | undefined;
    let visitorId: string | undefined;
    let clientVersion: string | undefined;

    if (content && typeof content === 'object') {
      cookie = content.cookie || content.Cookie;
      visitorId = content['x-goog-visitor-id'] || content['X-Goog-Visitor-Id'];
      clientVersion = content['x-youtube-client-version'];
      return { cookie, visitorId, clientVersion };
    }

    const text = String(content || '').trim();
    if (text.startsWith('{')) {
      try {
        return this.parseAuthContent(JSON.parse(text));
      } catch {
        /* fall through */
      }
    }
    for (const line of text.split('\n')) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      if (key === 'cookie') cookie = value;
      else if (key === 'x-goog-visitor-id') visitorId = value;
      else if (key === 'x-youtube-client-version') clientVersion = value;
    }
    return { cookie, visitorId, clientVersion };
  }

  async saveAuth(userId: string, content: any): Promise<{ status: string; message: string }> {
    if (!content) {
      throw new HttpException({ detail: 'Contenido de autenticación vacío' }, 400);
    }
    const { cookie, visitorId, clientVersion } = this.parseAuthContent(content);
    if (!cookie) {
      throw new HttpException(
        {
          detail:
            'No se encontró ninguna cookie en el contenido. Asegúrate de pegar las cabeceras de music.youtube.com (debe incluir la línea Cookie).',
        },
        400,
      );
    }
    const payload: CookieAuth = { cookie };
    if (visitorId) payload['x-goog-visitor-id'] = visitorId;
    if (clientVersion) payload['x-youtube-client-version'] = clientVersion;
    await this.accounts.setAuth(userId, 'ytmusic', payload);
    this.invalidate(userId);
    return { status: 'ok', message: 'Auth configuration saved.' };
  }

  async logout(userId: string): Promise<{ status: string; message: string }> {
    await this.accounts.deleteAuth(userId, 'ytmusic');
    this.invalidate(userId);
    return { status: 'ok', message: 'Logged out.' };
  }

  // ───────────────────────── auto-captura de cookies (Firefox) ─────────────────────────

  private static AUTH_COOKIE_KEYS = ['SAPISID', '__Secure-3PAPISID', 'SID', '__Secure-1PSID', '__Secure-3PSID'];

  private static RELEVANT_COOKIES = new Set([
    'SID', 'HSID', 'SSID', 'APISID', 'SAPISID', 'LOGIN_INFO', 'SIDCC', 'YSC',
    'VISITOR_INFO1_LIVE', 'VISITOR_PRIVACY_METADATA', 'PREF', 'CONSENT', 'NID',
  ]);

  private static isRelevantCookie(name: string): boolean {
    return YtmusicService.RELEVANT_COOKIES.has(name) || name.startsWith('__Secure-');
  }

  private readFirefoxCookies(cookiesPath: string): Map<string, string> {
    const tmp = path.join(os.tmpdir(), `rsp_ff_${process.pid}_${crypto.randomBytes(4).toString('hex')}.sqlite`);
    const map = new Map<string, string>();
    try {
      fs.copyFileSync(cookiesPath, tmp);
      if (fs.existsSync(cookiesPath + '-wal')) {
        try {
          fs.copyFileSync(cookiesPath + '-wal', tmp + '-wal');
        } catch {
          /* ignore */
        }
      }
      const db = new DatabaseSync(tmp);
      const rows: Array<{ name: string; value: string; host: string }> = db
        .prepare(
          "SELECT name, value, host FROM moz_cookies WHERE host LIKE '%youtube.com' OR host LIKE '%google.com' ORDER BY (host LIKE '%youtube.com') DESC",
        )
        .all();
      db.close();
      for (const r of rows) {
        if (!YtmusicService.isRelevantCookie(r.name)) continue;
        if (!map.has(r.name)) map.set(r.name, r.value);
      }
    } finally {
      for (const f of [tmp, tmp + '-wal']) {
        try {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        } catch {
          /* ignore */
        }
      }
    }
    return map;
  }

  async captureFromFirefox(userId: string): Promise<{ status: string; message: string; cookie_count: number }> {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const profilesDir = path.join(appData, 'Mozilla', 'Firefox', 'Profiles');
    if (!fs.existsSync(profilesDir)) {
      throw new HttpException({ detail: 'No se encontró una instalación de Firefox en este equipo.' }, 404);
    }

    const profileNames = fs
      .readdirSync(profilesDir)
      .filter((n) => fs.existsSync(path.join(profilesDir, n, 'cookies.sqlite')));
    if (!profileNames.length) {
      throw new HttpException({ detail: 'No se encontró cookies.sqlite en ningún perfil de Firefox.' }, 404);
    }

    let best: { name: string; map: Map<string, string>; hasLogin: boolean } | null = null;
    let sawGoogleAuth = false;
    for (const name of profileNames) {
      let map: Map<string, string>;
      try {
        map = this.readFirefoxCookies(path.join(profilesDir, name, 'cookies.sqlite'));
      } catch {
        continue;
      }
      if (!YtmusicService.AUTH_COOKIE_KEYS.some((k) => map.has(k))) continue;
      sawGoogleAuth = true;
      const hasLogin = map.has('LOGIN_INFO');
      if (!best || (hasLogin && !best.hasLogin) || (hasLogin === best.hasLogin && map.size > best.map.size)) {
        best = { name, map, hasLogin };
      }
    }

    if (!best) {
      throw new HttpException(
        {
          detail: sawGoogleAuth
            ? 'Se encontraron cookies de Google pero sin sesión activa de YouTube. Inicia sesión en music.youtube.com en Firefox.'
            : 'No se encontró ninguna sesión de Google en Firefox. Inicia sesión en YouTube Music en Firefox primero.',
        },
        401,
      );
    }

    const cookieStr = [...best.map].map(([k, v]) => `${k}=${v}`).join('; ');
    await this.accounts.setAuth(userId, 'ytmusic', { cookie: cookieStr }, `Firefox: ${best.name}`);
    this.invalidate(userId);

    const warn = best.hasLogin ? '' : ' (atención: sin LOGIN_INFO, la sesión podría estar incompleta)';
    return {
      status: 'ok',
      message: `¡Conectado exitosamente desde Firefox! (perfil ${best.name}, ${best.map.size} cookies)${warn}`,
      cookie_count: best.map.size,
    };
  }

  // ───────────────────────── OAuth (deshabilitado) ─────────────────────────
  // El OAuth nativo de youtubei.js usa el cliente YouTube-TV, rechazado por YT Music (400).
  private static readonly OAUTH_UNSUPPORTED =
    'El login por OAuth no da acceso a YouTube Music (el token del cliente TV de Google es ' +
    'rechazado por los endpoints de YT Music). Usa la captura automática desde Firefox o pega ' +
    'las cabeceras de music.youtube.com.';

  async oauthInit(): Promise<never> {
    throw new HttpException({ detail: YtmusicService.OAUTH_UNSUPPORTED }, 400);
  }

  async oauthVerify(_deviceCode: string): Promise<never> {
    throw new HttpException({ detail: YtmusicService.OAUTH_UNSUPPORTED }, 400);
  }
}
