import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { YtmusicService } from '../ytmusic/ytmusic.service';
import { readJson, removeFile, writeJson } from '../common/paths';

type Row = { uri?: string; title?: string; artist?: string; durationMs?: number };
type Job = {
  jobId: string;
  userId: string;
  playlistId: string;
  name: string;
  rows: Row[]; // todas las filas (para reanudar desde `done` tras un reinicio)
  total: number;
  done: number;
  matched: number;
  duplicates: number;
  failed: number;
  failedRows: Row[]; // filas no encontradas (para revisar/añadir a mano)
  status: 'running' | 'done' | 'error';
};

/**
 * Empareja pistas (título/artista, p.ej. de un CSV de Spotify) con su equivalente en
 * YouTube Music y arma una lista guardada reproducible. Cachea cada emparejamiento en
 * MatchCache (Track URI de Spotify → videoId de YouTube) para no repetir búsquedas.
 */
@Injectable()
export class MatchService implements OnModuleInit {
  private readonly log = new Logger('Match');
  private readonly jobs = new Map<string, Job>();
  private static readonly STORE = 'import_jobs.json';

  // Reanuda imports que quedaron a medias por un reinicio del backend.
  onModuleInit() {
    try {
      const data = readJson(MatchService.STORE);
      if (data && typeof data === 'object') {
        for (const [jobId, raw] of Object.entries(data) as [string, any][]) {
          if (raw?.status === 'running' && Array.isArray(raw.rows)) {
            this.jobs.set(jobId, raw as Job);
            this.log.log(`Reanudando import "${raw.name}" desde ${raw.done}/${raw.total}…`);
            void this.runImport(raw as Job, raw.done || 0);
          }
        }
      }
    } catch (e: any) {
      this.log.warn(`No se pudo reanudar imports: ${e?.message || e}`);
    }
  }

  // Persiste SOLO los jobs en curso (los terminados no deben reanudarse).
  private persist() {
    try {
      const running = [...this.jobs.values()].filter((j) => j.status === 'running');
      if (!running.length) {
        removeFile(MatchService.STORE);
        return;
      }
      writeJson(MatchService.STORE, Object.fromEntries(running.map((j) => [j.jobId, j])));
    } catch {
      /* ignore */
    }
  }

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
      userId,
      playlistId: pl.id,
      name: pl.name,
      rows: clean,
      total: clean.length,
      done: 0,
      matched: 0,
      duplicates: 0,
      failed: 0,
      failedRows: [],
      status: 'running',
    };
    this.jobs.set(pl.id, job);
    this.persist();
    void this.runImport(job);
    return { jobId: pl.id, total: clean.length };
  }

  private async runImport(job: Job, startFrom = 0) {
    const { userId, playlistId, rows } = job;
    const seen = new Set<string>();
    let pos = 0;
    // Reanudación: reconstruir uids ya presentes + posición para no duplicar.
    if (startFrom > 0) {
      const existing = await this.prisma.userPlaylistTrack.findMany({
        where: { playlistId },
        select: { uid: true, position: true },
      });
      for (const e of existing) seen.add(e.uid);
      pos = existing.reduce((m, e) => Math.max(m, e.position), -1) + 1;
    }
    try {
      for (let idx = startFrom; idx < rows.length; idx++) {
        const row = rows[idx];
        try {
          const track = await this.matchOne(userId, row);
          if (track?.id && !seen.has(track.id)) {
            seen.add(track.id);
            await this.prisma.userPlaylistTrack.create({
              data: { playlistId, uid: `ytmusic:${track.id}`, position: pos++ },
            });
            job.matched++;
          } else if (track?.id) {
            job.duplicates++; // ya estaba en la lista (fila repetida o mismo video) → se omite
          } else {
            job.failed++;
            if (job.failedRows.length < 800) job.failedRows.push({ title: row.title, artist: row.artist });
          }
        } catch {
          job.failed++; // búsqueda fallida/limitada → continuar con el resto
          if (job.failedRows.length < 800) job.failedRows.push({ title: row.title, artist: row.artist });
        }
        job.done = idx + 1;
        if (job.done % 100 === 0) this.persist(); // checkpoint para reanudar
        await this.delay(250); // ritmo suave para no saturar YouTube
      }
      job.status = 'done';
    } catch (e: any) {
      job.status = 'error';
      this.log.warn(`import ${playlistId}: ${e?.message || e}`);
    }
    this.persist(); // saca el job del archivo si ya no está 'running'
    this.log.log(`Import "${job.name}": ${job.matched} emparejadas, ${job.duplicates} duplicadas, ${job.failed} fallidas de ${job.total}.`);
  }

  getProgress(jobId: string): Omit<Job, 'failedRows' | 'rows' | 'userId'> | null {
    const j = this.jobs.get(jobId);
    if (!j) return null;
    const { failedRows: _f, rows: _r, userId: _u, ...slim } = j;
    return slim;
  }

  /** Filas que no se pudieron emparejar (para revisar/añadir a mano). */
  getFailed(jobId: string): { rows: Row[]; playlistId: string; name: string } {
    const j = this.jobs.get(jobId);
    if (!j) return { rows: [], playlistId: jobId, name: '' };
    return { rows: j.failedRows || [], playlistId: j.playlistId, name: j.name };
  }
}
