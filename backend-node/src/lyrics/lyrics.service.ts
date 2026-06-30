import { Injectable, Logger } from '@nestjs/common';

type SyncedLine = { t: number; text: string };
export type LyricsResult = { source: string | null; synced: SyncedLine[] | null; plain: string | null };

/**
 * Busca letras en varias fuentes, en orden:
 *  1) lrclib.net (gratis, sin key) — puede traer letra SINCRONIZADA (.lrc).
 *  2) lyrics.ovh (gratis, sin key) — solo texto plano, como respaldo.
 * Devuelve `{ source, synced, plain }`; synced es null si no hay versión con tiempos.
 */
@Injectable()
export class LyricsService {
  private readonly log = new Logger('Lyrics');

  async get(title: string, artist: string, album?: string, duration?: number): Promise<LyricsResult> {
    const t = (title || '').trim();
    const a = (artist || '').trim();
    if (!t) return { source: null, synced: null, plain: null };

    // 1) lrclib — coincidencia exacta y luego búsqueda difusa.
    try {
      const exact = await this.lrclibGet(t, a, album, duration);
      const hit = exact || (await this.lrclibSearch(t, a));
      if (hit && (hit.syncedLyrics || hit.plainLyrics)) {
        return {
          source: 'lrclib',
          synced: this.parseLrc(hit.syncedLyrics),
          plain: (hit.plainLyrics || '').trim() || null,
        };
      }
    } catch (e: any) {
      this.log.warn(`lrclib falló: ${e?.message || e}`);
    }

    // 2) lyrics.ovh — texto plano.
    try {
      const plain = await this.lyricsOvh(a, t);
      if (plain) return { source: 'lyrics.ovh', synced: null, plain };
    } catch (e: any) {
      this.log.warn(`lyrics.ovh falló: ${e?.message || e}`);
    }

    return { source: null, synced: null, plain: null };
  }

  // ───────────────── fuentes ─────────────────
  private async lrclibGet(title: string, artist: string, album?: string, duration?: number): Promise<any | null> {
    const p = new URLSearchParams({ track_name: title, artist_name: artist });
    if (album) p.set('album_name', album);
    if (duration && duration > 0) p.set('duration', String(Math.round(duration)));
    const data = await this.fetchJson(`https://lrclib.net/api/get?${p.toString()}`);
    return data && (data.syncedLyrics || data.plainLyrics) ? data : null;
  }

  private async lrclibSearch(title: string, artist: string): Promise<any | null> {
    const p = new URLSearchParams({ track_name: title });
    if (artist) p.set('artist_name', artist);
    const arr = await this.fetchJson(`https://lrclib.net/api/search?${p.toString()}`);
    if (!Array.isArray(arr) || !arr.length) return null;
    // Prioriza un resultado con letra sincronizada; si no, el primero con texto.
    return arr.find((x: any) => x?.syncedLyrics) || arr.find((x: any) => x?.plainLyrics) || null;
  }

  private async lyricsOvh(artist: string, title: string): Promise<string | null> {
    if (!artist) return null;
    const data = await this.fetchJson(
      `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
    );
    const lyrics = (data?.lyrics || '').trim();
    return lyrics || null;
  }

  // ───────────────── helpers ─────────────────
  private async fetchJson(url: string): Promise<any> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const resp = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'RealShufflePlayer (lyrics)' },
      });
      if (!resp.ok) return null;
      return await resp.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // Convierte un .lrc ("[mm:ss.xx] texto") en líneas con tiempo en segundos.
  private parseLrc(lrc?: string): SyncedLine[] | null {
    if (!lrc) return null;
    const out: SyncedLine[] = [];
    for (const line of lrc.split('\n')) {
      const stamps = line.match(/\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]/g);
      if (!stamps) continue;
      const text = line.replace(/\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]/g, '').trim();
      for (const s of stamps) {
        const m = s.match(/\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]/);
        if (!m) continue;
        out.push({ t: parseInt(m[1], 10) * 60 + parseFloat(m[2]), text });
      }
    }
    out.sort((x, y) => x.t - y.t);
    return out.length ? out : null;
  }
}
