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
  // Caché de cliente Innertube por usuario (auth por cookie) para YouTube Music.
  private musicClients = new Map<string, { client: any; sig: string }>();
  // Cliente Innertube de YouTube "normal" (sin reescribir a music.youtube.com).
  // Necesario para playlists/videos que no existen en YouTube Music.
  private youtubeClients = new Map<string, { client: any; sig: string }>();
  // El cliente de streaming es anónimo y compartido (el audio público no requiere auth).
  private streamClient: any = null;
  // Caché de URLs de audio resueltas (anónimas). Las URLs de googlevideo caducan
  // (param "expire", ~6 h); guardarlas evita re-resolver en cada seek/reintento y
  // reduce las llamadas a YouTube (menos throttling). Se invalida ante un 403.
  private audioUrlCache = new Map<string, { url: string; expiresAt: number }>();

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
    this.youtubeClients.delete(userId);
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

  /**
   * Cliente de YouTube "normal" (no Music). Usa la misma cookie pero con el fetch
   * por defecto: youtubei.js calcula el SAPISIDHASH contra www.youtube.com y NO se
   * reescribe a music.youtube.com, así que autentica correctamente la sesión de
   * YouTube. Sirve para listar las playlists del usuario y cargar videos que YouTube
   * Music no tiene (p.ej. videos no-musicales).
   */
  private async getYoutubeClient(userId: string): Promise<any> {
    const blob = await this.loadCookieAuth(userId);
    const sig = blob ? crypto.createHash('sha1').update(blob.cookie).digest('hex') : 'anon';
    const cached = this.youtubeClients.get(userId);
    if (cached && cached.sig === sig) return cached.client;

    const client = blob
      ? await Innertube.create({ cookie: blob.cookie, retrieve_player: false })
      : await Innertube.create({ retrieve_player: false });
    this.youtubeClients.set(userId, { client, sig });
    return client;
  }

  /** Streaming: sesión anónima con player. Mandar cookie/SAPISIDHASH al player IOS lo hace responder 400. */
  private async getStreamClient(): Promise<any> {
    if (!this.streamClient) this.streamClient = await Innertube.create({ retrieve_player: true });
    return this.streamClient;
  }

  // ───────────────────────── mappers ─────────────────────────

  /**
   * Devuelve siempre un string. youtubei.js a veces entrega títulos/nombres como
   * string (items de YT Music) y a veces como objeto Text (PlaylistVideo de YouTube
   * normal); sin esto, un Text se serializa como {text, runs, …} en el JSON.
   */
  private static textOf(v: any): string {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v?.text === 'string') return v.text;
    return '';
  }

  private static mapTrack(it: any): Track {
    const artist =
      YtmusicService.textOf(it.artists?.[0]?.name) ||
      YtmusicService.textOf(it.author?.name) ||
      YtmusicService.textOf(it.authors?.[0]?.name) ||
      'Artista Desconocido';
    const thumbs = it.thumbnails || [];
    return {
      id: it.id,
      title: YtmusicService.textOf(it.title) || 'Canción Desconocida',
      artist,
      thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : '',
      duration: YtmusicService.textOf(it.duration?.text) || '?',
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
    return YtmusicService.withRetry(
      () => yt.actions.execute('/browse', { browseId, client: 'YTMUSIC', parse: false }),
      `browse:${browseId}`,
    );
  }

  // ───────────────────────── API pública ─────────────────────────

  async search(userId: string, q: string): Promise<{ query: string; tracks: Track[] }> {
    const yt = await this.getMusicClient(userId);
    let res = await YtmusicService.withRetry(() => yt.music.search(q, { type: 'song' }), 'search:song');
    let items: any[] = res.songs?.contents || [];
    if (!items.length) {
      res = await YtmusicService.withRetry(() => yt.music.search(q, { type: 'video' }), 'search:video');
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
      // Acepta separadores de miles ("1,381" / "1.381") y los quita antes de parsear,
      // si no "1,381 canciones" se truncaba a 381.
      const countMatch = subtitle.match(/([\d.,]+)\s*(songs|song|canciones|canción|pistas|tracks)/i);
      out.push({
        id,
        title: r.title?.runs?.[0]?.text || 'Sin título',
        count: countMatch ? parseInt(countMatch[1].replace(/[.,]/g, ''), 10) || 0 : 0,
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

  async getLikedSongs(userId: string, limit = 5000): Promise<{ title: string; tracks: Track[]; unavailable: number }> {
    const yt = await this.getMusicClient(userId);
    let pl: any;
    try {
      pl = await YtmusicService.withRetry(() => yt.music.getPlaylist('LM'), 'liked');
    } catch {
      pl = null;
    }
    const items: any[] = (pl?.items || []).filter((i: any) => i.id);
    let rawCount = (pl?.items || []).length;

    let guard = 0;
    while (pl?.has_continuation && items.length < limit && guard < 200) {
      try {
        pl = await YtmusicService.withRetry(() => pl.getContinuation(), `liked:cont:${guard}`);
      } catch (e: any) {
        console.warn(`[ytmusic] liked: continuación falló en pág ${guard + 1}:`, e?.message);
        break; // devolver lo recogido en vez de tumbar toda la carga
      }
      rawCount += (pl?.items || []).length;
      items.push(...(pl?.items || []).filter((i: any) => i.id));
      guard++;
    }
    const unavailable = Math.max(0, rawCount - items.length);
    console.log(`[ytmusic] liked: ${items.length}/${rawCount} reproducibles (cont=${guard}, ${unavailable} sin id)`);

    return {
      title: 'Canciones que te gustan',
      tracks: items.slice(0, limit).map((it) => YtmusicService.mapTrack(it)),
      unavailable,
    };
  }

  async getPlaylist(userId: string, playlistId: string, limit = 5000): Promise<{ title: string; tracks: Track[]; unavailable: number }> {
    const yt = await this.getMusicClient(userId);
    const id = playlistId.replace(/^VL/, '');
    let pl = await YtmusicService.withRetry(() => yt.music.getPlaylist(id), `playlist:${id}`);

    // El título sale de la 1ª página: getContinuation() no trae header.
    const header = pl.header || {};
    const title = header.title?.text || header.title?.toString?.() || 'Playlist';

    const items: any[] = (pl.items || []).filter((i: any) => i.id);
    let rawCount = (pl.items || []).length;
    let guard = 0;
    while (pl.has_continuation && items.length < limit && guard < 200) {
      try {
        pl = await YtmusicService.withRetry(() => pl.getContinuation(), `playlist:cont:${guard}`);
      } catch (e: any) {
        console.warn(`[ytmusic] playlist ${id}: continuación falló en pág ${guard + 1}:`, e?.message);
        break; // devolver lo recogido en vez de tumbar toda la carga
      }
      rawCount += (pl.items || []).length;
      items.push(...(pl.items || []).filter((i: any) => i.id));
      guard++;
    }
    const unavailable = Math.max(0, rawCount - items.length);
    console.log(`[ytmusic] playlist ${id}: ${items.length}/${rawCount} reproducibles (cont=${guard}, hasMore=${!!pl.has_continuation}, ${unavailable} sin id)`);

    return { title, tracks: items.slice(0, limit).map((it) => YtmusicService.mapTrack(it)), unavailable };
  }

  // ───────────────────────── radio / autoplay ─────────────────────────

  /** Mapea un PlaylistPanelVideo (cola automix de watch-next) a nuestra Track. */
  private static mapRadioItem(it: any): Track {
    const artist =
      (it.artists || [])
        .map((a: any) => YtmusicService.textOf(a?.name))
        .filter(Boolean)
        .join(', ') ||
      YtmusicService.textOf(it.author?.name) ||
      'Artista Desconocido';
    // PlaylistPanelVideo expone la miniatura en `thumbnail` (array); otros nodos en `thumbnails`.
    const thumbs = it.thumbnail || it.thumbnails || [];
    return {
      id: it.video_id || it.id || '',
      title: YtmusicService.textOf(it.title) || 'Canción Desconocida',
      artist,
      thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : '',
      duration: YtmusicService.textOf(it.duration?.text) || '?',
      duration_seconds: it.duration?.seconds || 0,
    };
  }

  /**
   * Radio infinita: dado un videoId semilla, devuelve pistas afines usando la cola
   * "automix" de YouTube Music (watch-next / getUpNext). Sirve para prolongar la
   * bolsa de shuffle con temas relacionados cuando se está agotando, sin que la
   * música pare. Best-effort: si la semilla no genera cola, devuelve lista vacía.
   */
  async getRadio(userId: string, videoId: string, limit = 25): Promise<{ seed: string; tracks: Track[] }> {
    const yt = await this.getMusicClient(userId);
    let panel: any = null;
    try {
      panel = await YtmusicService.withRetry(() => yt.music.getUpNext(videoId), `radio:${videoId}`);
    } catch (e: any) {
      console.warn(`[ytmusic] radio getUpNext falló para ${videoId}:`, e?.message);
    }

    const seen = new Set<string>([videoId]); // excluye la propia semilla
    const tracks: Track[] = [];
    for (const it of panel?.contents || []) {
      const id = it?.video_id || it?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const t = YtmusicService.mapRadioItem(it);
      if (!t.id) continue;
      tracks.push(t);
      if (tracks.length >= limit) break;
    }
    console.log(`[ytmusic] radio ${videoId}: ${tracks.length} relacionadas`);
    return { seed: videoId, tracks };
  }

  // ───────────────────────── YouTube "normal" (no Music) ─────────────────────────

  /** Normaliza un nodo de playlist (GridPlaylist/Playlist clásicos o el nuevo LockupView). */
  private static mapYtPlaylist(
    p: any,
  ): { id: string; title: string; count: number; thumbnail: string } | null {
    const id: string | undefined = p?.id || p?.content_id;
    if (!id) return null;

    const title: string =
      p?.title?.text || p?.metadata?.title?.text || p?.title?.toString?.() || 'Sin título';

    // GridPlaylist/Playlist exponen .thumbnails; LockupView usa content_image
    // (CollectionThumbnailView con .primary_thumbnail, o ThumbnailView con .image).
    let thumbs: any[] = [];
    if (Array.isArray(p?.thumbnails) && p.thumbnails.length) {
      thumbs = p.thumbnails;
    } else if (p?.content_image) {
      const ci = p.content_image;
      const tv = ci.primary_thumbnail || ci;
      thumbs = tv?.image || tv?.thumbnails || [];
    }
    const thumbnail = thumbs.length ? thumbs[thumbs.length - 1].url : '';

    let count = 0;
    const m = String(p?.video_count?.text || '').match(/[\d.,]+/);
    if (m) count = parseInt(m[0].replace(/[.,]/g, ''), 10) || 0;

    return { id: String(id), title: String(title), count, thumbnail };
  }

  /** Lista las playlists de la cuenta de YouTube del usuario (browse FEplaylist_aggregation). */
  async getYouTubePlaylists(userId: string): Promise<{ playlists: any[] }> {
    const yt = await this.getYoutubeClient(userId);
    let feed: any;
    try {
      feed = await yt.getPlaylists();
    } catch (e: any) {
      throw new HttpException(
        { detail: `No se pudieron obtener tus playlists de YouTube: ${e?.message || e}` },
        502,
      );
    }

    const out: any[] = [];
    const seen = new Set<string>();
    for (const node of feed?.playlists || []) {
      const pl = YtmusicService.mapYtPlaylist(node);
      if (!pl || seen.has(pl.id)) continue;
      seen.add(pl.id);
      out.push(pl);
    }
    return { playlists: out };
  }

  /**
   * Crea una playlist NUEVA en la cuenta del usuario con los videoIds dados. YouTube y
   * YouTube Music comparten cuenta, así que aparece en ambas bibliotecas. youtubei.js 17.x
   * expone `yt.playlist.create/addVideos`; la cookie guardada da `logged_in=true`, por lo
   * que NO hace falta re-autorizar. Devuelve el id de la playlist creada.
   */
  async createYouTubePlaylist(
    userId: string,
    name: string,
    videoIds: string[],
  ): Promise<{ id: string; title: string; count: number }> {
    const title = (name || '').trim();
    if (!title) throw new HttpException({ detail: 'Falta el nombre de la playlist.' }, 422);

    // Solo IDs de video de YouTube válidos (11 chars), sin duplicados y preservando el orden.
    const ids = Array.from(
      new Set((videoIds || []).filter((v) => typeof v === 'string' && /^[A-Za-z0-9_-]{11}$/.test(v))),
    );
    if (!ids.length) {
      throw new HttpException({ detail: 'No hay canciones de YouTube válidas para subir.' }, 422);
    }

    const yt = await this.getYoutubeClient(userId);
    if (!yt?.session?.logged_in) {
      throw new HttpException(
        { detail: 'Tu sesión de YouTube no está autenticada; reconfigura tu cookie de YT Music.' },
        401,
      );
    }

    // create() acepta un lote inicial; el resto se añade en tandas para no exceder límites.
    const FIRST = 200;
    let playlistId: string | undefined;
    try {
      const res: any = await yt.playlist.create(title, ids.slice(0, FIRST));
      playlistId = res?.playlist_id || res?.playlistId;
      if (!playlistId) throw new Error('respuesta sin playlist_id');
    } catch (e: any) {
      throw new HttpException(
        { detail: `No se pudo crear la playlist en YouTube: ${e?.message || e}` },
        502,
      );
    }

    // Añade el resto en tandas de 100 (no aborta si un lote falla: la playlist ya existe).
    const rest = ids.slice(FIRST);
    let added = Math.min(ids.length, FIRST);
    for (let i = 0; i < rest.length; i += 100) {
      const chunk = rest.slice(i, i + 100);
      try {
        await yt.playlist.addVideos(playlistId, chunk);
        added += chunk.length;
      } catch (e: any) {
        console.warn(`[ytmusic] addVideos falló para un lote: ${e?.message || e}`);
      }
    }

    return { id: playlistId, title, count: added };
  }

  private static parseHms(s: string): number {
    const parts = String(s).split(':').map((x) => parseInt(x, 10));
    if (!parts.length || parts.some((x) => isNaN(x))) return 0;
    return parts.reduce((acc, v) => acc * 60 + v, 0);
  }

  /**
   * Normaliza un nodo de video de una playlist de YouTube. Soporta el PlaylistVideo
   * clásico (vía mapTrack) y el nuevo LockupView (content_id/metadata/overlays), que
   * es lo que YouTube devuelve hoy y con lo que el getter `pl.items` de youtubei.js
   * lanza excepción.
   */
  private static mapYtVideo(n: any): Track | null {
    if (n?.id) return YtmusicService.mapTrack(n); // PlaylistVideo clásico

    const id: string | undefined = n?.content_id;
    const ct = n?.content_type;
    if (!id || (ct && ct !== 'VIDEO' && ct !== 'MOVIE')) return null;

    const title = n?.metadata?.title?.text || 'Video';

    let artist = 'YouTube';
    for (const row of n?.metadata?.metadata?.metadata_rows || []) {
      const part = (row?.metadata_parts || []).find((p: any) => p?.text?.text);
      if (part) {
        artist = part.text.text;
        break;
      }
    }

    const tv = n?.content_image?.primary_thumbnail || n?.content_image;
    const thumbs = tv?.image || [];
    const thumbnail = thumbs.length ? thumbs[thumbs.length - 1].url : '';

    let duration = '';
    for (const ov of n?.content_image?.overlays || []) {
      for (const b of ov?.badges || []) {
        const txt = String(b?.text || '').trim();
        if (/^\d+(:\d{2})+$/.test(txt)) {
          duration = txt;
          break;
        }
      }
      if (duration) break;
    }

    return {
      id: String(id),
      title: String(title),
      artist: String(artist),
      thumbnail,
      duration: duration || '?',
      duration_seconds: duration ? YtmusicService.parseHms(duration) : 0,
    };
  }

  /** Carga los videos de una playlist de YouTube (incluye los que no están en YT Music). */
  async getYouTubePlaylist(
    userId: string,
    playlistId: string,
    limit = 5000,
  ): Promise<{ title: string; tracks: Track[] }> {
    const yt = await this.getYoutubeClient(userId);
    const id = playlistId.replace(/^VL/, '');
    let pl = await yt.getPlaylist(id);
    const title = pl.info?.title || 'Playlist';

    const seen = new Set<string>();
    const tracks: Track[] = [];
    const collect = (feed: any) => {
      let nodes: any[] = [];
      try {
        nodes = feed.videos || []; // .videos sí incluye LockupView; .items lanza excepción
      } catch {
        nodes = [];
      }
      for (const n of nodes) {
        const t = YtmusicService.mapYtVideo(n);
        if (!t || seen.has(t.id)) continue;
        seen.add(t.id);
        tracks.push(t);
      }
    };

    collect(pl);
    let guard = 0;
    while (tracks.length < limit && guard < 100) {
      let hasCont = false;
      try {
        hasCont = pl.has_continuation;
      } catch {
        hasCont = false;
      }
      if (!hasCont) break;
      try {
        pl = await pl.getContinuation();
      } catch {
        break; // un error de parseo en la paginación no debe tumbar toda la carga
      }
      collect(pl);
      guard++;
    }

    return { title, tracks: tracks.slice(0, limit) };
  }

  /** Reintenta una llamada de red transitoria con backoff exponencial (300ms, 600ms). */
  private static async withRetry(fn: () => Promise<any>, label = 'call', attempts = 3): Promise<any> {
    let lastErr: any;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (e: any) {
        lastErr = e;
        const status = e?.info?.status_code || e?.status || 0;
        // Errores "definitivos" (auth/argumento/no encontrado): no tiene sentido reintentar.
        if (status === 400 || status === 401 || status === 403 || status === 404) break;
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, 300 * 2 ** i));
      }
    }
    console.warn(`[ytmusic] ${label} falló tras reintentos:`, lastErr?.message || lastErr);
    throw lastErr;
  }

  /** Momento (ms epoch) en que conviene re-resolver una URL de googlevideo. */
  private static urlExpiry(url: string): number {
    const m = url.match(/[?&]expire=(\d+)/);
    // Hasta la expiración real menos 5 min de margen; si no la trae, 5 h conservadoras.
    if (m) return parseInt(m[1], 10) * 1000 - 5 * 60 * 1000;
    return Date.now() + 5 * 60 * 60 * 1000;
  }

  private static formatUrl(fmt: any, player: any): string | undefined {
    if (!fmt) return undefined;
    if (fmt.url) return fmt.url;
    try {
      return fmt.decipher?.(player);
    } catch {
      return undefined;
    }
  }

  /**
   * Resuelve una URL de audio directa, anónima, lista para reproducir en un
   * elemento <audio> del navegador.
   *
   * Importante: el <audio> sin MSE solo reproduce MP4 *progresivo* (faststart).
   * El cliente IOS solo entrega audio adaptativo FRAGMENTADO (brand "dash"), que
   * el navegador rechaza con NotSupportedError. El cliente ANDROID sí expone el
   * formato progresivo muxed (itag 18, mp4 AAC, brand "mp42") con URL directa —
   * el <audio> reproduce su pista de audio sin problema. Por eso se prefiere
   * ANDROID-progresivo y se deja IOS como último recurso.
   */
  async resolveAudioUrl(videoId: string, forceRefresh = false): Promise<string> {
    if (!forceRefresh) {
      const cached = this.audioUrlCache.get(videoId);
      if (cached && cached.expiresAt > Date.now()) return cached.url;
    }
    const url = await this.resolveAudioUrlFresh(videoId);
    this.audioUrlCache.set(videoId, { url, expiresAt: YtmusicService.urlExpiry(url) });
    return url;
  }

  /** Descarta la URL cacheada de un video (p.ej. cuando googlevideo devolvió 403). */
  invalidateAudioUrl(videoId: string): void {
    this.audioUrlCache.delete(videoId);
  }

  private async resolveAudioUrlFresh(videoId: string): Promise<string> {
    const tryAndroid = async (yt: any): Promise<string | undefined> => {
      const info = await YtmusicService.withRetry(
        () => yt.getInfo(videoId, { client: 'ANDROID' }),
        'getInfo:ANDROID',
      );
      const progressive = (info.streaming_data?.formats || []).filter((f: any) => f.has_audio);
      const best = progressive.find((f: any) => f.itag === 18) || progressive[0];
      return YtmusicService.formatUrl(best, yt.session.player);
    };
    const tryIos = async (yt: any): Promise<string | undefined> => {
      const info = await YtmusicService.withRetry(
        () => yt.getInfo(videoId, { client: 'IOS' }),
        'getInfo:IOS',
      );
      const fmt = info.chooseFormat({ type: 'audio', quality: 'best' });
      return YtmusicService.formatUrl(fmt, yt.session.player);
    };

    let yt = await this.getStreamClient();
    try {
      const url = await tryAndroid(yt);
      if (url) return url;
    } catch {
      /* sin progresivo en ANDROID → respaldo IOS */
    }
    try {
      const url = await tryIos(yt);
      if (url) return url;
    } catch {
      /* cliente quizá obsoleto → recrear y reintentar */
    }

    // El player/sesión anónima puede quedarse obsoleto (URLs que ya no se firman bien).
    // Recrear el cliente y reintentar suele resolver fallos persistentes de streaming.
    this.streamClient = null;
    yt = await this.getStreamClient();
    try {
      const url = await tryAndroid(yt);
      if (url) return url;
    } catch {
      /* último intento: IOS */
    }
    const url = await tryIos(yt);
    if (!url) throw new Error('No se pudo resolver la URL de audio');
    return url;
  }

  // ───────────────────────── calidad de stream ─────────────────────────

  /**
   * Devuelve los formatos de audio adaptativos reales de un video (códec, bitrate,
   * sample-rate, etiqueta de calidad) para el comparador de calidad. Usa el cliente
   * IOS, que expone el audio adaptativo (Opus/AAC en varios bitrates).
   */
  async getStreamQuality(videoId: string): Promise<{
    videoId: string;
    title: string | null;
    formats: Array<{
      itag: number;
      codec: string;
      container: string;
      bitrate: number;
      averageBitrate: number | null;
      sampleRate: number | null;
      channels: number | null;
      audioQuality: string | null;
      loudnessDb: number | null;
    }>;
  }> {
    const yt = await this.getStreamClient();
    let info: any;
    try {
      info = await YtmusicService.withRetry(() => yt.getInfo(videoId, { client: 'IOS' }), 'quality:IOS');
    } catch {
      info = await YtmusicService.withRetry(() => yt.getInfo(videoId), 'quality:default');
    }

    const adaptive: any[] = info?.streaming_data?.adaptive_formats || [];
    const progressive: any[] = info?.streaming_data?.formats || [];
    const audioOnly = adaptive.filter((f) => f.has_audio && !f.has_video);
    const pool = audioOnly.length ? audioOnly : [...adaptive, ...progressive].filter((f) => f.has_audio);

    const formats = pool
      .map((f) => {
        const mime = String(f.mime_type || '');
        return {
          itag: f.itag,
          codec: mime.match(/codecs="([^"]+)"/)?.[1] || '',
          container: mime.split(';')[0].split('/')[1] || '',
          bitrate: f.bitrate || 0,
          averageBitrate: f.average_bitrate ?? null,
          sampleRate: f.audio_sample_rate ? Number(f.audio_sample_rate) : null,
          channels: f.audio_channels ?? null,
          audioQuality: f.audio_quality ?? null,
          loudnessDb: typeof f.loudness_db === 'number' ? f.loudness_db : null,
        };
      })
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

    return { videoId, title: info?.basic_info?.title ?? null, formats };
  }

  // Loudness (dB) por video, cacheado (para la normalización de volumen del cliente).
  private loudnessCache = new Map<string, number | null>();

  /**
   * Devuelve el loudness (dB relativo al objetivo de YouTube) de un video, para que
   * el cliente iguale el volumen entre pistas (ReplayGain). Cacheado en memoria.
   */
  async getLoudness(videoId: string): Promise<{ videoId: string; loudnessDb: number | null }> {
    if (this.loudnessCache.has(videoId)) {
      return { videoId, loudnessDb: this.loudnessCache.get(videoId) ?? null };
    }
    let db: number | null = null;
    try {
      const q = await this.getStreamQuality(videoId);
      const withLoud = q.formats.find((f) => typeof f.loudnessDb === 'number');
      db = withLoud ? withLoud.loudnessDb : null;
    } catch {
      db = null;
    }
    this.loudnessCache.set(videoId, db);
    return { videoId, loudnessDb: db };
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
