import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { YtmusicService } from '../ytmusic/ytmusic.service';
import { SpotifyService } from '../spotify/spotify.service';

// Pista normalizada de cualquier servicio. Se guarda completa (con su `source`)
// para que al reproducir desde la copia en DB use el motor correcto.
type AnyTrack = {
  id?: string;
  uri?: string;
  source?: string;
  title?: string;
  artist?: string;
  thumbnail?: string;
  duration?: string;
  duration_seconds?: number;
  [k: string]: any;
};

type UserResult = { playlists: number; tracks: number; errors: string[] };

/**
 * Sincroniza periódicamente las playlists de cada usuario a la DB
 * (`PlaylistCache` + `TrackCache`) para poder reproducirlas/mezclarlas desde la
 * copia local sin volver a pedirlas al servicio de origen.
 *
 * Qué sincroniza (lo accesible por API):
 *  · YouTube Music: todas las playlists de la biblioteca + "Canciones que te gustan".
 *  · Spotify: "Canciones que te gustan" + playlists PROPIAS/colaborativas (vía /items).
 *    Las editoriales/ajenas de Spotify devuelven solo metadata → se omiten.
 *
 * El `uid` de PlaylistCache se prefija con el userId (`${userId}:${provider}:${id}`)
 * para que cada usuario tenga su propia copia (incluido "liked", que no es global).
 */
@Injectable()
export class SyncService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Sync');
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastRun: { at: string; summary: any } | null = null;
  private readonly intervalMs: number;
  private readonly enabled: boolean;
  private readonly perRun: number; // listas por corrida (rotación parcial anti-429)
  private readonly maxPages: number; // páginas (×100 pistas) por playlist Spotify y corrida

  constructor(
    private readonly prisma: PrismaService,
    private readonly ytmusic: YtmusicService,
    private readonly spotify: SpotifyService,
  ) {
    const min = Number(process.env.SYNC_INTERVAL_MIN);
    // Por defecto 30 min: cada corrida es pequeña (rotación), así que conviene frecuente.
    const minutes = Number.isFinite(min) && min > 0 ? min : 30;
    this.intervalMs = Math.max(15, minutes) * 60_000; // mínimo 15 min
    this.enabled = process.env.SYNC_ENABLED !== 'false';
    const per = Number(process.env.SYNC_PER_RUN);
    this.perRun = Number.isFinite(per) && per > 0 ? per : 5;
    const mp = Number(process.env.SYNC_MAX_PAGES);
    this.maxPages = Number.isFinite(mp) && mp > 0 ? mp : 8; // 8×100 = 800 pistas por corrida
  }

  onModuleInit() {
    if (!this.enabled) {
      this.log.log('Sincronización deshabilitada (SYNC_ENABLED=false).');
      return;
    }
    // Primer pase ~60 s tras el arranque, PERO solo si la caché NO está fresca: así un
    // reinicio no vuelve a sincronizar (ni a arriesgar 429) si ya se hizo hace poco.
    setTimeout(async () => {
      try {
        if (await this.isFresh()) {
          this.log.log('Sync al arrancar omitido: la caché es reciente.');
          return;
        }
      } catch {
        /* si la comprobación falla, sincroniza igual */
      }
      void this.runAll('startup');
    }, 60_000);
    this.timer = setInterval(() => void this.runAll('interval'), this.intervalMs);
    this.log.log(`Sincronización activa: cada ${Math.round(this.intervalMs / 60_000)} min.`);
  }

  /** ¿La caché de playlists se actualizó hace menos de un intervalo? Evita re-sync por reinicio. */
  private async isFresh(): Promise<boolean> {
    const row = await this.prisma.playlistCache.findFirst({
      orderBy: { fetchedAt: 'desc' },
      select: { fetchedAt: true },
    });
    if (!row) return false;
    return Date.now() - new Date(row.fetchedAt).getTime() < this.intervalMs;
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  getStatus() {
    return {
      enabled: this.enabled,
      running: this.running,
      intervalMin: Math.round(this.intervalMs / 60_000),
      lastRun: this.lastRun,
    };
  }

  /** Sincroniza a TODOS los usuarios con cuentas conectadas (lo usa el job). */
  async runAll(trigger = 'manual') {
    if (this.running) {
      this.log.warn('Ya hay una sincronización en curso; se omite.');
      return { skipped: true as const };
    }
    this.running = true;
    const started = Date.now();
    const summary: any = { trigger, users: 0, playlists: 0, tracks: 0, errors: [] as string[] };
    try {
      const accounts = await this.prisma.providerAccount.findMany({ select: { userId: true } });
      const userIds = [...new Set(accounts.map((a) => a.userId))];
      summary.users = userIds.length;
      for (const userId of userIds) {
        const r = await this.runForUser(userId);
        summary.playlists += r.playlists;
        summary.tracks += r.tracks;
        summary.errors.push(...r.errors);
      }
    } catch (e: any) {
      summary.errors.push(String(e?.message || e));
    } finally {
      this.running = false;
      summary.ms = Date.now() - started;
      this.lastRun = { at: new Date().toISOString(), summary };
      this.log.log(
        `Sync (${trigger}): ${summary.playlists} listas, ${summary.tracks} pistas, ${summary.errors.length} errores en ${summary.ms}ms.`,
      );
    }
    return summary;
  }

  /**
   * Sincroniza de forma PARCIAL por rotación: cada corrida procesa solo las `limit`
   * listas más desactualizadas (o incompletas), para no disparar el 429. Las playlists
   * grandes de Spotify se traen por trozos (paginado incremental) reanudando entre
   * corridas, y tienen prioridad mientras estén incompletas.
   */
  async runForUser(userId: string, limit = this.perRun): Promise<UserResult> {
    const res: UserResult = { playlists: 0, tracks: 0, errors: [] };

    type Cand = {
      provider: 'ytmusic' | 'spotify';
      id: string;
      title: string;
      thumbnail?: string | null;
      kind: 'liked' | 'playlist';
      total: number; // nº de pistas conocido por la lista (exacto en Spotify)
    };
    const cands: Cand[] = [];

    // 1) Reunir candidatos con llamadas "list" baratas.
    try {
      if (await this.ytmusic.hasAuth(userId)) {
        cands.push({ provider: 'ytmusic', id: 'LM', title: 'YT Music · Me gusta', kind: 'liked', total: 0 });
        try {
          const { playlists } = await this.ytmusic.getLibraryPlaylists(userId);
          for (const pl of playlists) {
            if (pl.id === 'LM') continue;
            cands.push({ provider: 'ytmusic', id: pl.id, title: pl.title, thumbnail: pl.thumbnail, kind: 'playlist', total: pl.count || 0 });
          }
        } catch (e: any) {
          res.errors.push(`ytmusic listas: ${e?.message || e}`);
        }
      }
    } catch (e: any) {
      res.errors.push(`ytmusic: ${e?.message || e}`);
    }

    try {
      const token = await this.spotify.getAccessToken(userId);
      if (token) {
        let likedTotal = 0;
        try {
          const head = await this.spotify.spotifyGet(userId, '/me/tracks', { limit: 1 });
          likedTotal = head?.total || 0;
        } catch {
          /* si falla, total 0 (se refresca por rotación) */
        }
        cands.push({ provider: 'spotify', id: 'liked', title: 'Spotify · Canciones que te gustan', kind: 'liked', total: likedTotal });
        try {
          let offset = 0;
          while (true) {
            const pls = await this.spotify.spotifyGet(userId, '/me/playlists', { limit: 50, offset });
            const items = (pls.items || []).filter(Boolean);
            for (const p of items) {
              cands.push({
                provider: 'spotify', id: p.id, title: p.name || 'Playlist',
                thumbnail: p.images?.[0]?.url, kind: 'playlist',
                total: (p.items ?? p.tracks)?.total || 0,
              });
            }
            if (items.length < 50 || !pls.next) break;
            offset += 50;
          }
        } catch (e: any) {
          res.errors.push(`spotify listas: ${e?.message || e}`);
        }
      }
    } catch (e: any) {
      res.errors.push(`spotify: ${e?.message || e}`);
    }

    if (!cands.length) return res;

    // 2) Ordenar: primero INCOMPLETAS (lo cacheado < total), luego las más viejas.
    const meta = await this.cacheMeta(userId);
    const keyOf = (c: Cand) => `${userId}:${c.provider}:${c.id}`;
    const incomplete = (c: Cand) => {
      const m = meta.get(keyOf(c));
      if (!m) return true; // nunca sincronizada
      if (c.provider === 'ytmusic') return false; // YT se trae completo; refresco por rotación
      if (m.count === 0) return false; // ajena/sin contenido (solo metadata) → no insistir
      return c.total > 0 && m.count < c.total; // playlist/liked de Spotify parcial
    };
    const at = (c: Cand) => meta.get(keyOf(c))?.at ?? 0;
    cands.sort((a, b) => {
      const d = (incomplete(a) ? 0 : 1) - (incomplete(b) ? 0 : 1);
      return d !== 0 ? d : at(a) - at(b);
    });

    // 3) Procesar solo `limit` por corrida. YT completo; Spotify por trozos.
    let spotifyLimited = false;
    let done = 0;
    for (const c of cands) {
      if (done >= limit) break;
      if (c.provider === 'spotify' && spotifyLimited) break; // ya limitado: parar Spotify esta corrida
      try {
        if (c.provider === 'ytmusic') {
          const data = c.kind === 'liked'
            ? await this.ytmusic.getLikedSongs(userId)
            : await this.ytmusic.getPlaylist(userId, c.id);
          await this.cachePlaylist(userId, 'ytmusic', c.id, data.title || c.title, data.tracks, 'youtube', c.thumbnail);
          if (data.tracks.length) { res.playlists++; res.tracks += data.tracks.length; }
          done++;
          await this.delay(400);
        } else {
          const r = await this.syncSpotifyChunk(userId, c.id, c.title, c.kind, c.total, c.thumbnail);
          if (r.added) { res.playlists++; res.tracks += r.added; }
          done++;
          await this.delay(500);
        }
      } catch (e: any) {
        const m = String(e?.message || e);
        if (m.includes('429')) {
          if (c.provider === 'spotify') spotifyLimited = true;
          res.errors.push(`${c.provider}: limitado por tasa (429); continúa en la próxima corrida`);
          continue;
        }
        res.errors.push(`${c.provider} ${c.id}: ${m}`);
      }
    }
    return res;
  }

  /**
   * Trae UN trozo (hasta `maxPages` páginas de 100) de una lista de Spotify, reanudando
   * desde lo ya cacheado. Deduplica y guarda el acumulado. Lanza si hay 429 (para que la
   * corrida pause Spotify); las ajenas/no accesibles (403/404) se guardan vacías y no se reintentan.
   */
  private async syncSpotifyChunk(
    userId: string,
    id: string,
    title: string,
    kind: 'liked' | 'playlist',
    total: number,
    thumbnail?: string | null,
  ): Promise<{ added: number }> {
    const uid = `${userId}:spotify:${id}`;
    const existing = await this.readCached(uid);
    if (total > 0 && existing.length >= total) return { added: 0 }; // ya completa

    const path = kind === 'liked' ? '/me/tracks' : `/playlists/${id}/items`;
    const baseParams: Record<string, any> = { limit: 100 };
    if (kind === 'playlist') baseParams.market = 'from_token';

    const fresh: AnyTrack[] = [];
    let off = existing.length; // reanuda; el solape por no-reproducibles se deduplica
    for (let page = 0; page < this.maxPages; page++) {
      let data: any;
      try {
        data = await this.spotify.spotifyGet(userId, path, { ...baseParams, offset: off });
      } catch (e: any) {
        const m = String(e?.message || e);
        if (m.includes('429')) throw e; // que runForUser pause Spotify esta corrida
        if (m.includes('403') || m.includes('404')) break; // ajena/no accesible → guardar lo que haya
        throw e;
      }
      const items = data.items || [];
      if (!items.length) break;
      for (const it of items) {
        const t = it.item ?? it.track;
        if (t && t.type === 'track') fresh.push({ ...this.spotify.formatTrack(t), source: 'spotify' });
      }
      off += items.length;
      if (items.length < 100 || !data.next) break;
      await this.delay(150);
    }

    const merged = this.dedupeTracks(existing.concat(fresh));
    const added = merged.length - existing.length;
    await this.upsertSpotifyCache(userId, id, title, merged, fresh, thumbnail);
    return { added };
  }

  /** Lista las playlists sincronizadas de un usuario (desde PlaylistCache). */
  async listSynced(userId: string) {
    const rows = await this.prisma.playlistCache.findMany({
      where: { uid: { startsWith: `${userId}:` }, trackCount: { gt: 0 } },
      orderBy: { fetchedAt: 'desc' },
    });
    return rows.map((r) => ({
      provider: r.provider,
      providerId: r.providerId,
      title: r.title,
      count: r.trackCount,
      thumbnail: r.thumbnail,
      syncedAt: r.fetchedAt,
    }));
  }

  /** Devuelve las pistas (con su `source`) de una playlist sincronizada. */
  async getSyncedTracks(userId: string, provider: string, providerId: string): Promise<AnyTrack[]> {
    const uid = `${userId}:${provider}:${providerId}`;
    const row = await this.prisma.playlistCache.findUnique({ where: { uid } });
    if (!row) return [];
    try {
      return JSON.parse(row.tracksJson) as AnyTrack[];
    } catch {
      return [];
    }
  }

  /** Guarda en la caché una lista cargada por el cliente (cacheo on-demand). */
  async cacheFromClient(
    userId: string,
    provider: string,
    providerId: string,
    title: string,
    tracks: AnyTrack[],
    thumbnail?: string | null,
  ) {
    if ((provider !== 'spotify' && provider !== 'ytmusic') || !providerId || !Array.isArray(tracks) || !tracks.length) {
      return { ok: false, count: 0 };
    }
    const src = provider === 'spotify' ? 'spotify' : 'youtube';
    await this.cachePlaylist(userId, provider, providerId, title || 'Playlist', tracks, src, thumbnail);
    return { ok: true, count: tracks.length };
  }

  // ───────────────── helpers ─────────────────
  private delay(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Mapa uid → { count, at } de lo ya cacheado (para ordenar por frescura/completitud). */
  private async cacheMeta(userId: string): Promise<Map<string, { count: number; at: number }>> {
    const rows = await this.prisma.playlistCache.findMany({
      where: { uid: { startsWith: `${userId}:` } },
      select: { uid: true, trackCount: true, fetchedAt: true },
    });
    return new Map(rows.map((r) => [r.uid, { count: r.trackCount, at: new Date(r.fetchedAt).getTime() }]));
  }

  /** Lee las pistas ya cacheadas de una lista (para reanudar el paginado incremental). */
  private async readCached(uid: string): Promise<AnyTrack[]> {
    const row = await this.prisma.playlistCache.findUnique({ where: { uid }, select: { tracksJson: true } });
    if (!row) return [];
    try {
      return JSON.parse(row.tracksJson) as AnyTrack[];
    } catch {
      return [];
    }
  }

  private dedupeTracks(tracks: AnyTrack[]): AnyTrack[] {
    const seen = new Set<string>();
    const out: AnyTrack[] = [];
    for (const t of tracks) {
      const k = t.uri || t.id;
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    return out;
  }

  /** Guarda el acumulado de una lista Spotify (TrackCache solo de las nuevas + PlaylistCache). */
  private async upsertSpotifyCache(
    userId: string,
    id: string,
    title: string,
    merged: AnyTrack[],
    fresh: AnyTrack[],
    thumbnail?: string | null,
  ) {
    for (const t of fresh) {
      const ident = this.identify(t);
      if (!ident) continue;
      await this.prisma.trackCache.upsert({
        where: { uid: ident.uid },
        update: { title: t.title || '', artists: t.artist || '', durationMs: this.durationMs(t), thumbnail: t.thumbnail || null, json: JSON.stringify(t) },
        create: { uid: ident.uid, provider: ident.provider, providerId: ident.providerId, title: t.title || '', artists: t.artist || '', durationMs: this.durationMs(t), thumbnail: t.thumbnail || null, json: JSON.stringify(t) },
      });
    }
    const uid = `${userId}:spotify:${id}`;
    await this.prisma.playlistCache.upsert({
      where: { uid },
      update: { title, trackCount: merged.length, thumbnail: thumbnail || null, tracksJson: JSON.stringify(merged), fetchedAt: new Date() },
      create: { uid, provider: 'spotify', providerId: id, title, trackCount: merged.length, thumbnail: thumbnail || null, tracksJson: JSON.stringify(merged) },
    });
  }

  // Deriva (uid, provider, providerId) de una pista; mismos uids que las listas guardadas.
  private identify(t: AnyTrack): { uid: string; provider: 'ytmusic' | 'spotify'; providerId: string } | null {
    if (t?.source === 'spotify') {
      const uri = t.uri || t.id || '';
      const providerId = uri.includes(':') ? uri.split(':').pop() || '' : uri;
      if (!providerId) return null;
      return { uid: `spotify:${providerId}`, provider: 'spotify', providerId };
    }
    const providerId = t?.id || '';
    if (!providerId) return null;
    return { uid: `ytmusic:${providerId}`, provider: 'ytmusic', providerId };
  }

  private durationMs(t: AnyTrack): number {
    if (typeof t.duration_seconds === 'number' && t.duration_seconds > 0) {
      return Math.round(t.duration_seconds * 1000);
    }
    if (!t.duration) return 0;
    const parts = String(t.duration).split(':').map((n) => parseInt(n, 10));
    if (parts.some((n) => Number.isNaN(n))) return 0;
    let s = 0;
    for (const p of parts) s = s * 60 + p;
    return s * 1000;
  }

  private async cachePlaylist(
    userId: string,
    provider: 'ytmusic' | 'spotify',
    providerId: string,
    title: string,
    tracks: AnyTrack[],
    defaultSource: string,
    thumbnail?: string | null,
  ) {
    const withSource = tracks.map((t) => ({ ...t, source: t.source || defaultSource }));

    // Cada pista a TrackCache (uid compartido con "Mis Listas").
    for (const t of withSource) {
      const ident = this.identify(t);
      if (!ident) continue;
      await this.prisma.trackCache.upsert({
        where: { uid: ident.uid },
        update: {
          title: t.title || '',
          artists: t.artist || '',
          durationMs: this.durationMs(t),
          thumbnail: t.thumbnail || null,
          json: JSON.stringify(t),
        },
        create: {
          uid: ident.uid,
          provider: ident.provider,
          providerId: ident.providerId,
          title: t.title || '',
          artists: t.artist || '',
          durationMs: this.durationMs(t),
          thumbnail: t.thumbnail || null,
          json: JSON.stringify(t),
        },
      });
    }

    // La playlist a PlaylistCache (uid por-usuario para no pisar el "liked" de otros).
    const uid = `${userId}:${provider}:${providerId}`;
    await this.prisma.playlistCache.upsert({
      where: { uid },
      update: {
        title,
        trackCount: withSource.length,
        thumbnail: thumbnail || null,
        tracksJson: JSON.stringify(withSource),
        fetchedAt: new Date(),
      },
      create: {
        uid,
        provider,
        providerId,
        title,
        trackCount: withSource.length,
        thumbnail: thumbnail || null,
        tracksJson: JSON.stringify(withSource),
      },
    });
  }
}
