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

  constructor(
    private readonly prisma: PrismaService,
    private readonly ytmusic: YtmusicService,
    private readonly spotify: SpotifyService,
  ) {
    const min = Number(process.env.SYNC_INTERVAL_MIN);
    const minutes = Number.isFinite(min) && min > 0 ? min : 360; // por defecto 6 h
    this.intervalMs = Math.max(15, minutes) * 60_000; // mínimo 15 min
    this.enabled = process.env.SYNC_ENABLED !== 'false';
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

  /** Sincroniza un usuario concreto (lo usa "Sincronizar ahora"). */
  async runForUser(userId: string): Promise<UserResult> {
    const res: UserResult = { playlists: 0, tracks: 0, errors: [] };

    // ───────── YouTube Music ─────────
    try {
      if (await this.ytmusic.hasAuth(userId)) {
        try {
          const liked = await this.ytmusic.getLikedSongs(userId);
          await this.cachePlaylist(userId, 'ytmusic', 'LM', liked.title, liked.tracks, 'youtube');
          res.playlists++;
          res.tracks += liked.tracks.length;
        } catch (e: any) {
          res.errors.push(`ytmusic liked: ${e?.message || e}`);
        }

        try {
          const { playlists } = await this.ytmusic.getLibraryPlaylists(userId);
          for (const pl of playlists) {
            if (pl.id === 'LM') continue; // ya cubierto por getLikedSongs
            try {
              const full = await this.ytmusic.getPlaylist(userId, pl.id);
              await this.cachePlaylist(userId, 'ytmusic', pl.id, full.title || pl.title, full.tracks, 'youtube', pl.thumbnail);
              res.playlists++;
              res.tracks += full.tracks.length;
              await this.delay(400);
            } catch (e: any) {
              res.errors.push(`ytmusic ${pl.id}: ${e?.message || e}`);
            }
          }
        } catch (e: any) {
          res.errors.push(`ytmusic playlists: ${e?.message || e}`);
        }
      }
    } catch (e: any) {
      res.errors.push(`ytmusic: ${e?.message || e}`);
    }

    // ───────── Spotify ─────────
    try {
      const token = await this.spotify.getAccessToken(userId);
      if (token) {
        try {
          const tracks = await this.fetchSpotifyLiked(userId);
          await this.cachePlaylist(userId, 'spotify', 'liked', 'Spotify · Canciones que te gustan', tracks, 'spotify');
          res.playlists++;
          res.tracks += tracks.length;
        } catch (e: any) {
          res.errors.push(`spotify liked: ${e?.message || e}`);
        }

        try {
          const pls = await this.spotify.spotifyGet(userId, '/me/playlists', { limit: 50 });
          for (const p of (pls.items || []).filter(Boolean)) {
            try {
              const tracks = await this.fetchSpotifyPlaylistItems(userId, p.id);
              if (!tracks.length) continue; // editorial/ajena → solo metadata; se omite
              await this.cachePlaylist(userId, 'spotify', p.id, p.name || 'Playlist', tracks, 'spotify', p.images?.[0]?.url);
              res.playlists++;
              res.tracks += tracks.length;
              await this.delay(500);
            } catch (e: any) {
              const m = String(e?.message || e);
              if (m.includes('403') || m.includes('404')) continue; // bloqueada → omitir en silencio
              if (m.includes('429')) {
                // Limitado por tasa: dejar de pedir para no empeorar; el resto se
                // completará en el próximo ciclo de sincronización.
                res.errors.push('spotify: limitado por tasa (429); se completará en el próximo ciclo');
                break;
              }
              res.errors.push(`spotify ${p.id}: ${m}`);
            }
          }
        } catch (e: any) {
          res.errors.push(`spotify playlists: ${e?.message || e}`);
        }
      }
    } catch (e: any) {
      res.errors.push(`spotify: ${e?.message || e}`);
    }

    return res;
  }

  /** Lista las playlists sincronizadas de un usuario (desde PlaylistCache). */
  async listSynced(userId: string) {
    const rows = await this.prisma.playlistCache.findMany({
      where: { uid: { startsWith: `${userId}:` } },
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

  // ───────────────── helpers ─────────────────
  private delay(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  private async fetchSpotifyLiked(userId: string, limit = 5000): Promise<AnyTrack[]> {
    const out: AnyTrack[] = [];
    let offset = 0;
    while (out.length < limit) {
      const data = await this.spotify.spotifyGet(userId, '/me/tracks', { limit: 50, offset });
      const items = data.items || [];
      if (!items.length) break;
      for (const it of items) {
        const t = it.track;
        if (t && t.type === 'track') out.push({ ...this.spotify.formatTrack(t), source: 'spotify' });
      }
      if (items.length < 50 || !data.next) break;
      offset += 50;
      await this.delay(150);
    }
    return out;
  }

  private async fetchSpotifyPlaylistItems(userId: string, id: string, limit = 5000): Promise<AnyTrack[]> {
    const out: AnyTrack[] = [];
    let offset = 0;
    while (out.length < limit) {
      // feb-2026: endpoint renombrado /tracks → /items; cada elemento .track → .item.
      const data = await this.spotify.spotifyGet(userId, `/playlists/${id}/items`, {
        limit: 100,
        offset,
        market: 'from_token',
      });
      const items = data.items || [];
      if (!items.length) break;
      for (const it of items) {
        const t = it.item ?? it.track;
        if (t && t.type === 'track') out.push({ ...this.spotify.formatTrack(t), source: 'spotify' });
      }
      if (items.length < 100 || !data.next) break;
      offset += 100;
      await this.delay(150);
    }
    return out;
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
