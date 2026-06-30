import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { YtmusicService } from '../ytmusic/ytmusic.service';

type Row = { uri?: string; title?: string; artist?: string; durationMs?: number };
type Job = {
  jobId: string;
  playlistId: string;
  name: string;
  total: number;
  done: number;
  matched: number;
  failed: number;
  status: 'running' | 'done' | 'error';
};

/**
 * Empareja pistas (título/artista, p.ej. de un CSV de Spotify) con su equivalente en
 * YouTube Music y arma una lista guardada reproducible. Cachea cada emparejamiento en
 * MatchCache (Track URI de Spotify → videoId de YouTube) para no repetir búsquedas.
 */
@Injectable()
export class MatchService {
  private readonly log = new Logger('Match');
  private readonly jobs = new Map<string, Job>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ytmusic: YtmusicService,
  ) {}

  private norm(s: string): string {
    return (s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private delay(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  private pickBest(tracks: any[], durationMs?: number): any | null {
    const usable = (tracks || []).filter((t) => t?.id);
    if (!usable.length) return null;
    if (durationMs && durationMs > 0) {
      const target = durationMs / 1000;
      const top = usable.slice(0, 5);
      top.sort(
        (a, b) => Math.abs((a.duration_seconds || 0) - target) - Math.abs((b.duration_seconds || 0) - target),
      );
      return top[0];
    }
    return usable[0];
  }

  /** Empareja una pista a un videoId de YouTube (con caché). Devuelve la pista YT o null. */
  async matchOne(userId: string, row: Row): Promise<any | null> {
    const title = (row.title || '').trim();
    const artist = (row.artist || '').trim();
    if (!title) return null;
    const sourceUid = (row.uri && row.uri.trim()) || `q:${this.norm(`${artist} ${title}`)}`;

    const cached = await this.prisma.matchCache.findUnique({ where: { sourceUid } });
    if (cached?.ytVideoId) {
      const tc = await this.prisma.trackCache.findUnique({ where: { uid: `ytmusic:${cached.ytVideoId}` } });
      if (tc) {
        try {
          return JSON.parse(tc.json);
        } catch {
          /* ignore */
        }
      }
      return { id: cached.ytVideoId, title, artist, thumbnail: '', duration: '', source: 'youtube' };
    }

    const q = `${title} ${artist}`.trim();
    const r = await this.ytmusic.search(userId, q);
    const best = this.pickBest(r?.tracks || [], row.durationMs);
    if (!best?.id) return null;

    const track = { ...best, source: 'youtube' };
    await this.prisma.matchCache.upsert({
      where: { sourceUid },
      update: { ytVideoId: best.id, score: 1 },
      create: { sourceUid, ytVideoId: best.id, score: 1 },
    });
    await this.prisma.trackCache.upsert({
      where: { uid: `ytmusic:${best.id}` },
      update: {
        title: best.title || '',
        artists: best.artist || '',
        durationMs: Math.round((best.duration_seconds || 0) * 1000),
        thumbnail: best.thumbnail || null,
        json: JSON.stringify(track),
      },
      create: {
        uid: `ytmusic:${best.id}`,
        provider: 'ytmusic',
        providerId: best.id,
        title: best.title || '',
        artists: best.artist || '',
        durationMs: Math.round((best.duration_seconds || 0) * 1000),
        thumbnail: best.thumbnail || null,
        json: JSON.stringify(track),
      },
    });
    return track;
  }

  /** Crea la lista (vacía) y lanza el emparejado en segundo plano. Devuelve { jobId, total }. */
  async startImport(userId: string, name: string, rows: Row[]): Promise<{ jobId: string; total: number }> {
    const clean = (rows || []).filter((r) => r && (r.title || '').trim());
    const pl = await this.prisma.userPlaylist.create({ data: { userId, name: (name || 'Importada').trim() } });
    const job: Job = {
      jobId: pl.id,
      playlistId: pl.id,
      name: pl.name,
      total: clean.length,
      done: 0,
      matched: 0,
      failed: 0,
      status: 'running',
    };
    this.jobs.set(pl.id, job);
    void this.runImport(userId, pl.id, clean, job);
    return { jobId: pl.id, total: clean.length };
  }

  private async runImport(userId: string, playlistId: string, rows: Row[], job: Job) {
    let pos = 0;
    const seen = new Set<string>();
    try {
      for (const row of rows) {
        try {
          const track = await this.matchOne(userId, row);
          if (track?.id && !seen.has(track.id)) {
            seen.add(track.id);
            await this.prisma.userPlaylistTrack.create({
              data: { playlistId, uid: `ytmusic:${track.id}`, position: pos++ },
            });
            job.matched++;
          } else if (!track?.id) {
            job.failed++;
          }
        } catch {
          job.failed++; // búsqueda fallida/limitada → continuar con el resto
        }
        job.done++;
        await this.delay(250); // ritmo suave para no saturar YouTube
      }
      job.status = 'done';
    } catch (e: any) {
      job.status = 'error';
      this.log.warn(`import ${playlistId}: ${e?.message || e}`);
    }
    this.log.log(`Import "${job.name}": ${job.matched} emparejadas / ${job.failed} fallidas de ${job.total}.`);
  }

  getProgress(jobId: string): Job | null {
    return this.jobs.get(jobId) || null;
  }
}
