import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Type } from '@google/genai';
import { YtmusicService } from '../ytmusic/ytmusic.service';
import { SpotifyService } from '../spotify/spotify.service';
import { GeminiService } from '../assistant/gemini.service';

interface Seed {
  id?: string;
  title?: string;
  artist?: string;
  source?: string;
  uri?: string;
}

interface SimilarBody {
  seeds?: Seed[];
  provider?: string; // 'youtube' | 'ytmusic' | 'spotify'
  limit?: number;
  exclude?: string[]; // claves (uri o id) ya presentes en la bolsa
}

type Track = {
  id: string;
  title: string;
  artist: string;
  thumbnail?: string;
  duration?: string;
  duration_seconds?: number;
  uri?: string;
  source?: string;
};

/**
 * Motor "Descubrir similares" (tipo Smart Shuffle de Spotify) para AMBOS proveedores.
 *
 * Como Spotify retiró su API /recommendations (nov-2024) para apps en Extended Quota
 * Mode, aquí se genera la afinidad de forma híbrida:
 *   - Semillas de YouTube  → automix nativo de YT Music (getUpNext), gratis e instantáneo,
 *                            + relleno con Gemini→búsqueda en YT si hace falta y hay key.
 *   - Semillas de Spotify  → Gemini sugiere canciones parecidas y se resuelven a pistas
 *                            de Spotify por búsqueda; si no hay Gemini, se cae al automix
 *                            de YT (resolviendo una semilla a videoId) y cada resultado se
 *                            busca en Spotify para que sea reproducible en su SDK.
 */
@Injectable()
export class DiscoverService {
  private readonly log = new Logger('Discover');

  constructor(
    private readonly yt: YtmusicService,
    private readonly spotify: SpotifyService,
    private readonly gemini: GeminiService,
  ) {}

  async similar(userId: string, body: SimilarBody): Promise<{ tracks: Track[]; engine: string }> {
    const seeds = (body?.seeds || []).filter((s) => s && (s.title || s.id)).slice(0, 6);
    if (!seeds.length) throw new HttpException({ detail: 'Faltan semillas para descubrir similares.' }, 422);

    const provider = body?.provider === 'spotify' ? 'spotify' : 'youtube';
    const limit = Math.min(Math.max(body?.limit ?? 20, 1), 40);
    const exclude = new Set((body?.exclude || []).map((k) => this.norm(k)));
    // Nunca sugieras las propias semillas.
    for (const s of seeds) {
      if (s.uri) exclude.add(this.norm(s.uri));
      if (s.id) exclude.add(this.norm(s.id));
      exclude.add(this.recKey(s.title, s.artist));
    }

    const out: Track[] = [];
    const seen = new Set<string>();
    const engines: string[] = [];
    const push = (t: Track | null) => {
      if (!t || !(t.id || t.uri)) return;
      const k1 = this.norm(t.uri || t.id);
      const k2 = this.recKey(t.title, t.artist);
      if (exclude.has(k1) || exclude.has(k2) || seen.has(k1) || seen.has(k2)) return;
      seen.add(k1); seen.add(k2);
      out.push(t);
    };

    if (provider === 'youtube') {
      // 1) Automix nativo de la primera semilla con videoId de YouTube.
      for (const s of seeds) {
        if (out.length >= limit) break;
        const vid = this.ytSeedId(s);
        if (!vid) continue;
        try {
          const r = await this.yt.getRadio(userId, vid, limit);
          for (const t of r.tracks) push({ ...t, source: 'youtube' });
          if (r.tracks.length) engines.push('automix');
        } catch (e: any) {
          this.log.warn(`automix falló para ${vid}: ${e?.message || e}`);
        }
      }
      // 2) Relleno con Gemini → búsqueda en YT Music.
      if (out.length < limit && this.gemini.isConfigured()) {
        const recs = await this.geminiSuggest(seeds, (limit - out.length) + 6);
        const resolved = await this.resolvePool(recs, (r) => this.resolveYt(userId, r));
        for (const t of resolved) push(t);
        if (resolved.length) engines.push('ia');
      }
    } else {
      // SPOTIFY
      // 1) Gemini → búsqueda en Spotify (reproducible en el SDK nativo).
      if (this.gemini.isConfigured()) {
        const recs = await this.geminiSuggest(seeds, limit + 8);
        const resolved = await this.resolvePool(recs, (r) => this.resolveSpotify(userId, r));
        for (const t of resolved) push(t);
        if (resolved.length) engines.push('ia');
      }
      // 2) Relleno/alternativa sin IA: automix de YT resuelto a Spotify por búsqueda.
      if (out.length < limit) {
        const vid = await this.anyYtSeedId(userId, seeds);
        if (vid) {
          try {
            const r = await this.yt.getRadio(userId, vid, (limit - out.length) * 2 + 4);
            const resolved = await this.resolvePool(
              r.tracks.map((t) => ({ title: t.title, artist: t.artist })),
              (rec) => this.resolveSpotify(userId, rec),
            );
            for (const t of resolved) push(t);
            if (resolved.length) engines.push('automix→spotify');
          } catch (e: any) {
            this.log.warn(`automix→spotify falló: ${e?.message || e}`);
          }
        }
      }
    }

    const tracks = out.slice(0, limit);
    this.log.log(`similar(${provider}): ${tracks.length} temas [${[...new Set(engines)].join('+') || 'ninguno'}]`);
    return { tracks, engine: [...new Set(engines)].join('+') || 'ninguno' };
  }

  // ───────────────────────── colas por ánimo (IA) ─────────────────────────

  /**
   * Genera una cola de canciones para un ánimo/actividad ("Entrenar", "Estudiar",
   * "Fiesta", "Relax"…) usando Gemini, adaptada al gusto (muestra de la bolsa) y resuelta
   * a pistas reproducibles del proveedor activo. Requiere GEMINI_API_KEY.
   */
  async moodQueue(
    userId: string,
    body: { mood?: string; seeds?: Seed[]; provider?: string; limit?: number },
  ): Promise<{ tracks: Track[]; mood: string; engine: string }> {
    const mood = (body?.mood || '').toString().trim();
    if (!mood) throw new HttpException({ detail: 'Indica un ánimo o actividad para la cola.' }, 422);
    if (!this.gemini.isConfigured()) {
      throw new HttpException(
        { detail: 'Las colas por ánimo necesitan GEMINI_API_KEY en el backend (gratis en https://aistudio.google.com/apikey).' },
        400,
      );
    }
    const provider = body?.provider === 'spotify' ? 'spotify' : 'youtube';
    const limit = Math.min(Math.max(body?.limit ?? 25, 5), 40);
    const taste = (body?.seeds || []).filter((s) => s?.title).slice(0, 12);

    const songs = await this.moodSuggest(mood, taste, limit + 8);
    const resolve =
      provider === 'spotify'
        ? (r: { title: string; artist: string }) => this.resolveSpotify(userId, r)
        : (r: { title: string; artist: string }) => this.resolveYt(userId, r);
    const resolved = await this.resolvePool(songs, resolve);

    const seen = new Set<string>();
    const out: Track[] = [];
    for (const t of resolved) {
      const k = this.norm(t.uri || t.id);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
      if (out.length >= limit) break;
    }
    this.log.log(`moodQueue "${mood}" (${provider}): ${out.length} temas`);
    return { tracks: out, mood, engine: 'ia' };
  }

  /** Pide a Gemini una cola de `count` canciones para un ánimo, sesgada por el gusto dado. */
  private async moodSuggest(
    mood: string,
    taste: Seed[],
    count: number,
  ): Promise<Array<{ title: string; artist: string }>> {
    const tasteStr = taste.length
      ? `\nReferencias del gusto del usuario (adáptate a este estilo cuando encaje):\n${taste
          .map((s) => `- ${s.title} — ${s.artist || ''}`)
          .join('\n')}`
      : '';
    const system =
      'Eres un DJ y curador musical experto. Creas colas para un momento/ánimo/actividad ' +
      'concretos, con canciones REALES, buena progresión de energía y variedad de artistas ' +
      '(evita repetir artista de forma consecutiva). Responde SIEMPRE solo con el JSON pedido.';
    const user =
      `Crea una cola de ${Math.min(count, 40)} canciones para: "${mood}".${tasteStr}\n` +
      'Ajusta la energía y el estilo a ese ánimo/actividad, con variedad de artistas. ' +
      'Devuelve para cada una title y artist exactos de canciones que existan de verdad.';
    const schema = {
      type: Type.OBJECT,
      properties: {
        songs: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: { title: { type: Type.STRING }, artist: { type: Type.STRING } },
            required: ['title', 'artist'],
          },
        },
      },
      required: ['songs'],
    };
    try {
      const ai = await this.gemini.generateJson<{ songs?: Array<{ title?: string; artist?: string }> }>({
        system,
        user,
        schema,
        temperature: 0.9,
      });
      return (ai.songs || [])
        .filter((s) => s?.title)
        .map((s) => ({ title: String(s.title), artist: String(s.artist || '') }));
    } catch (e: any) {
      this.log.warn(`Gemini mood falló: ${e?.message || e}`);
      return [];
    }
  }

  // ───────────────────────── Gemini ─────────────────────────

  /** Pide a Gemini `count` canciones parecidas a las semillas (solo título + artista). */
  private async geminiSuggest(
    seeds: Seed[],
    count: number,
  ): Promise<Array<{ title: string; artist: string }>> {
    const list = seeds.map((s) => `- ${s.title || '?'} — ${s.artist || '?'}`).join('\n');
    const system =
      'Eres un experto curador musical. A partir de unas canciones semilla, sugieres OTRAS ' +
      'canciones REALES y parecidas (mismo estilo, mood, energía o época), con variedad de ' +
      'artistas. Nunca repitas las semillas ni te inventes canciones que no existan. Responde ' +
      'SIEMPRE solo con el JSON pedido.';
    const user =
      `Canciones semilla:\n${list}\n\n` +
      `Sugiere ${Math.min(count, 40)} canciones NUEVAS y afines (que NO sean las semillas), ` +
      'con variedad de artistas. Devuelve para cada una title y artist exactos.';
    const schema = {
      type: Type.OBJECT,
      properties: {
        songs: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: { title: { type: Type.STRING }, artist: { type: Type.STRING } },
            required: ['title', 'artist'],
          },
        },
      },
      required: ['songs'],
    };
    try {
      const ai = await this.gemini.generateJson<{ songs?: Array<{ title?: string; artist?: string }> }>({
        system,
        user,
        schema,
        temperature: 0.85,
      });
      return (ai.songs || [])
        .filter((s) => s?.title)
        .map((s) => ({ title: String(s.title), artist: String(s.artist || '') }));
    } catch (e: any) {
      this.log.warn(`Gemini suggest falló: ${e?.message || e}`);
      return [];
    }
  }

  // ───────────────────────── resolución a pistas reproducibles ─────────────────────────

  /** Resuelve una sugerencia {title, artist} a una pista de YouTube Music por búsqueda. */
  private async resolveYt(userId: string, rec: { title: string; artist: string }): Promise<Track | null> {
    const q = `${rec.title} ${rec.artist}`.trim();
    try {
      const r = await this.yt.search(userId, q);
      const hit = (r.tracks || [])[0] as Track | undefined;
      if (!hit?.id) return null;
      return { ...hit, source: 'youtube' };
    } catch {
      return null;
    }
  }

  /** Resuelve una sugerencia {title, artist} a una pista de Spotify por búsqueda. */
  private async resolveSpotify(userId: string, rec: { title: string; artist: string }): Promise<Track | null> {
    const q = `${rec.title} ${rec.artist}`.trim();
    try {
      const r = await this.spotify.spotifyGet(userId, '/search', { q, type: 'track', limit: 1 });
      const item = r?.tracks?.items?.[0];
      if (!item?.uri) return null;
      return { ...this.spotify.formatTrack(item), source: 'spotify' };
    } catch {
      return null;
    }
  }

  /** Resuelve una lista de sugerencias en paralelo (pool acotado), preservando orden. */
  private async resolvePool(
    recs: Array<{ title: string; artist: string }>,
    resolve: (r: { title: string; artist: string }) => Promise<Track | null>,
  ): Promise<Track[]> {
    const pool = recs.filter((r) => r?.title).slice(0, 40);
    const out: Array<Track | null> = new Array(pool.length).fill(null);
    let i = 0;
    const worker = async () => {
      while (i < pool.length) {
        const idx = i++;
        out[idx] = await resolve(pool[idx]);
      }
    };
    const CONCURRENCY = 4;
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    return out.filter((t): t is Track => !!t);
  }

  // ───────────────────────── utilidades ─────────────────────────

  /** videoId de YouTube utilizable de una semilla (descarta semillas de Spotify). */
  private ytSeedId(s: Seed): string | null {
    if (!s?.id) return null;
    if (s.source === 'spotify') return null;
    if (s.id.startsWith('spotify:')) return null;
    return s.id;
  }

  /** Encuentra un videoId semilla: usa el de una semilla YT, o resuelve una por búsqueda. */
  private async anyYtSeedId(userId: string, seeds: Seed[]): Promise<string | null> {
    for (const s of seeds) {
      const v = this.ytSeedId(s);
      if (v) return v;
    }
    for (const s of seeds) {
      if (!s.title) continue;
      try {
        const r = await this.yt.search(userId, `${s.title} ${s.artist || ''}`.trim());
        const hit = (r.tracks || [])[0] as Track | undefined;
        if (hit?.id) return hit.id;
      } catch {
        /* siguiente semilla */
      }
    }
    return null;
  }

  private norm(s?: string): string {
    return (s || '').toLowerCase().trim();
  }

  /** Clave "canción" tolerante (título + primer token del artista) para dedupe cross-proveedor. */
  private recKey(title?: string, artist?: string): string {
    const norm = (s?: string) =>
      (s || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    return `${norm(title)}|${norm(artist).split(' ')[0]}`;
  }
}
