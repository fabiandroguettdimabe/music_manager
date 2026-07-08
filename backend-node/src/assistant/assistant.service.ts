import { HttpException, Injectable } from '@nestjs/common';
import { Type } from '@google/genai';
import { GeminiService } from './gemini.service';
import { YtmusicService } from '../ytmusic/ytmusic.service';
import { PrismaService } from '../prisma/prisma.service';

interface Track {
  id: string;
  title: string;
  artist: string;
  thumbnail?: string;
  duration?: string;
}

type Task = 'recommend' | 'organize' | 'dedupe' | 'themed';
const ALL_TASKS: Task[] = ['recommend', 'organize', 'dedupe', 'themed'];

interface AnalyzeBody {
  source?: { kind?: 'playlist' | 'liked'; id?: string };
  tasks?: Task[];
  suggestCount?: number;
}

// Tope de canciones que se mandan al modelo (controla tokens/coste y mantiene
// los índices manejables). Playlists más grandes se analizan por muestra.
const MAX_TRACKS = 250;

@Injectable()
export class AssistantService {
  constructor(
    private readonly gemini: GeminiService,
    private readonly yt: YtmusicService,
    private readonly prisma: PrismaService,
  ) {}

  // ───────────────────────── fuente de canciones ─────────────────────────

  private async getSourceTracks(
    userId: string,
    source?: AnalyzeBody['source'],
  ): Promise<{ title: string; tracks: Track[] }> {
    if (source?.kind === 'liked') {
      const r = await this.yt.getLikedSongs(userId);
      return { title: r.title, tracks: r.tracks as Track[] };
    }
    if (source?.kind === 'playlist' && source.id) {
      const r = await this.yt.getPlaylist(userId, source.id);
      return { title: r.title, tracks: r.tracks as Track[] };
    }
    throw new HttpException({ detail: 'Fuente inválida: indica una playlist o "liked".' }, 422);
  }

  // ───────────────────────── análisis principal ─────────────────────────

  async analyze(userId: string, body: AnalyzeBody) {
    const tasks: Task[] =
      body?.tasks?.length ? body.tasks.filter((t) => ALL_TASKS.includes(t)) : ALL_TASKS;
    if (!tasks.length) throw new HttpException({ detail: 'No se indicó ninguna tarea.' }, 422);
    const suggestCount = Math.min(Math.max(body?.suggestCount ?? 12, 1), 25);

    const { title, tracks } = await this.getSourceTracks(userId, body?.source);
    if (!tracks.length) {
      throw new HttpException({ detail: 'La playlist no tiene canciones reproducibles para analizar.' }, 422);
    }

    const sample = tracks.slice(0, MAX_TRACKS);
    const truncated = tracks.length > MAX_TRACKS;
    const list = sample.map((t, i) => `${i}. ${t.title} — ${t.artist}`).join('\n');

    const schema = this.buildSchema(tasks);
    const system =
      'Eres un experto curador musical. Analizas playlists y respondes SIEMPRE en el JSON ' +
      'pedido, en español. Usa los índices numéricos EXACTOS para referirte a canciones ' +
      'existentes; nunca inventes índices fuera de rango. Para recomendaciones, sugiere ' +
      'canciones reales que NO estén ya en la lista, con variedad de artistas.';
    const user = this.buildPrompt(title, list, tasks, suggestCount, truncated, tracks.length);

    const ai = await this.gemini.generateJson<any>({ system, user, schema, temperature: 0.7 });

    const byIndex = (idx: number) => sample[idx];
    const mapIdxs = (arr?: number[]) =>
      (arr || []).filter((n) => Number.isInteger(n) && n >= 0 && n < sample.length).map(byIndex);

    const result: any = {
      title,
      trackCount: tracks.length,
      analyzed: sample.length,
      truncated,
      summary: ai.summary || '',
    };

    if (tasks.includes('organize')) {
      result.organization = (ai.organization || [])
        .map((g: any) => ({ group: g.group, reason: g.reason || '', tracks: mapIdxs(g.trackIndices) }))
        .filter((g: any) => g.tracks.length);
    }
    if (tasks.includes('dedupe')) {
      result.duplicates = (ai.duplicates || [])
        .map((d: any) => ({ reason: d.reason || '', tracks: mapIdxs(d.trackIndices) }))
        .filter((d: any) => d.tracks.length > 1);
      result.outliers = (ai.outliers || [])
        .map((o: any) => ({ reason: o.reason || '', track: byIndex(o.trackIndex) }))
        .filter((o: any) => o.track);
    }
    if (tasks.includes('themed')) {
      result.themed = (ai.themedPlaylists || [])
        .map((p: any) => ({ name: p.name, description: p.description || '', tracks: mapIdxs(p.trackIndices) }))
        .filter((p: any) => p.name && p.tracks.length);
    }
    if (tasks.includes('recommend')) {
      result.recommendations = await this.resolveRecommendations(userId, ai.recommendations || [], tracks);
    }

    return result;
  }

  // ───────────────────────── categorizar biblioteca ─────────────────────────

  /**
   * Recibe la lista de playlists del usuario (solo id + título + tamaño) y le
   * asigna a cada una una categoría de género o tipo/uso, para poder agruparlas
   * en el panel lateral. Trabaja únicamente con los títulos: no descarga pistas,
   * así que es barato (una sola llamada a Gemini) y no depende de la sesión.
   */
  async categorizeLibrary(body: {
    playlists?: Array<{ id?: string; title?: string; count?: number }>;
  }) {
    const playlists = (body?.playlists || [])
      .filter((p) => p?.id && p?.title?.trim())
      .slice(0, 300);
    if (!playlists.length) {
      throw new HttpException({ detail: 'No hay playlists para organizar.' }, 422);
    }

    const list = playlists
      .map((p, i) => `${i}. ${p.title}${p.count ? ` (${p.count})` : ''}`)
      .join('\n');

    const schema = {
      type: Type.OBJECT,
      properties: {
        items: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              index: { type: Type.INTEGER },
              category: { type: Type.STRING },
              emoji: { type: Type.STRING },
            },
            required: ['index', 'category'],
          },
        },
        order: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            'Nombres de las categorías usadas, ordenadas por afinidad musical (géneros/estilos parecidos contiguos).',
        },
      },
      required: ['items'],
    };

    const system =
      'Eres un organizador de bibliotecas musicales. Recibes una lista de TÍTULOS de playlists y ' +
      'asignas a CADA una una categoría corta (1-2 palabras) por género musical o por tipo/uso. ' +
      'Ejemplos de categorías: "Rock", "Pop", "Reggaetón", "Electrónica", "Hip-Hop/Rap", "Cumbia", ' +
      '"Baladas", "Clásica", "Jazz", "Focus/Estudio", "Entrenar", "Fiesta", "Relax", "Viajes", ' +
      '"Infantil", "Podcast". REGLA CLAVE: reutiliza las MISMAS categorías entre playlists parecidas ' +
      'en vez de inventar una nueva casi igual (evita duplicados como "Rock" y "Rock clásico" si ' +
      'pueden ir juntas). Si el título no da pistas claras, usa "Variado". Añade un emoji ' +
      'representativo por categoría (consistente: la misma categoría siempre con el mismo emoji). ' +
      'Responde SIEMPRE en español y solo con el JSON pedido.';

    const user =
      `Playlists (índice. título):\n${list}\n\n` +
      'Para CADA índice devuelve: index (el número exacto), category (corta y consistente) y emoji. ' +
      'No omitas ninguna playlist. Además, en "order" lista los nombres de las categorías que usaste ' +
      'ordenados por afinidad musical (géneros parecidos juntos). Responde solo con el JSON del esquema.';

    const ai = await this.gemini.generateJson<{
      items?: Array<{ index: number; category?: string; emoji?: string }>;
      order?: string[];
    }>({ system, user, schema, temperature: 0.3 });

    const seen = new Set<number>();
    const categories = (ai.items || [])
      .filter(
        (it) =>
          Number.isInteger(it.index) &&
          it.index >= 0 &&
          it.index < playlists.length &&
          it.category?.trim() &&
          !seen.has(it.index) &&
          seen.add(it.index) != null,
      )
      .map((it) => ({
        id: playlists[it.index].id as string,
        category: it.category!.trim(),
        emoji: (it.emoji || '').trim(),
      }));

    // Orden por afinidad: respeta el que sugiere el modelo pero solo con
    // categorías realmente usadas; las que falten se anexan al final.
    const used = [...new Set(categories.map((c) => c.category))];
    const order: string[] = [];
    const seenCat = new Set<string>();
    for (const raw of ai.order || []) {
      const name = (raw || '').trim();
      if (used.includes(name) && !seenCat.has(name)) {
        order.push(name);
        seenCat.add(name);
      }
    }
    for (const name of used) if (!seenCat.has(name)) order.push(name);

    return { categories, order, count: categories.length };
  }

  /** Convierte cada sugerencia {title, artist} del modelo en una pista reproducible vía búsqueda en YT. */
  private async resolveRecommendations(
    userId: string,
    recs: Array<{ title?: string; artist?: string; reason?: string }>,
    source: Track[],
  ) {
    const existing = new Set(source.map((t) => this.recKey(t.title, t.artist)));
    const seen = new Set<string>();
    const pool = recs.filter((r) => r?.title).slice(0, 40);
    const out: any[] = new Array(pool.length).fill(null);

    let i = 0;
    const worker = async () => {
      while (i < pool.length) {
        const idx = i++;
        const rec = pool[idx];
        try {
          const q = `${rec.title} ${rec.artist || ''}`.trim();
          const r = await this.yt.search(userId, q);
          const hit = (r.tracks || [])[0] as Track | undefined;
          if (!hit) continue;
          const k = this.recKey(hit.title, hit.artist);
          if (existing.has(k) || seen.has(k)) continue;
          seen.add(k);
          out[idx] = { ...hit, reason: rec.reason || '', suggested: { title: rec.title, artist: rec.artist } };
        } catch {
          /* ignora una recomendación que no resuelva */
        }
      }
    };
    const CONCURRENCY = 4;
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    return out.filter(Boolean);
  }

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

  // ───────────────────────── persistencia (playlists IA) ─────────────────────────

  async savePlaylist(userId: string, name: string, tracks: Track[]) {
    if (!name?.trim()) throw new HttpException({ detail: 'Falta el nombre de la lista.' }, 422);
    const valid = (tracks || []).filter((t) => t?.id);
    if (!valid.length) throw new HttpException({ detail: 'No hay canciones para guardar.' }, 422);

    const pl = await this.prisma.userPlaylist.create({ data: { userId, name: name.trim() } });

    // Upserts en una transacción (deduplicados por uid) + un solo createMany.
    const uniq = new Map<string, Track>();
    for (const t of valid) if (!uniq.has(`ytmusic:${t.id}`)) uniq.set(`ytmusic:${t.id}`, t);
    await this.prisma.$transaction(
      [...uniq.entries()].map(([uid, t]) =>
        this.prisma.trackCache.upsert({
          where: { uid },
          update: { title: t.title || '', artists: t.artist || '', thumbnail: t.thumbnail || null, json: JSON.stringify(t) },
          create: {
            uid,
            provider: 'ytmusic',
            providerId: t.id,
            title: t.title || '',
            artists: t.artist || '',
            durationMs: this.durToMs(t.duration),
            thumbnail: t.thumbnail || null,
            json: JSON.stringify(t),
          },
        }),
      ),
    );
    await this.prisma.userPlaylistTrack.createMany({
      data: valid.map((t, i) => ({ playlistId: pl.id, uid: `ytmusic:${t.id}`, position: i })),
    });
    return { id: pl.id, name: pl.name, count: valid.length };
  }

  async listPlaylists(userId: string) {
    const pls = await this.prisma.userPlaylist.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { tracks: true } } },
    });
    return pls.map((p) => ({ id: p.id, name: p.name, count: p._count.tracks, createdAt: p.createdAt }));
  }

  async getPlaylist(userId: string, id: string) {
    const pl = await this.prisma.userPlaylist.findFirst({
      where: { id, userId },
      include: { tracks: { orderBy: { position: 'asc' } } },
    });
    if (!pl) throw new HttpException({ detail: 'Lista no encontrada.' }, 404);

    const uids = pl.tracks.map((t) => t.uid);
    const cache = await this.prisma.trackCache.findMany({ where: { uid: { in: uids } } });
    const map = new Map(cache.map((c) => [c.uid, c]));

    const tracks = pl.tracks
      .map((t) => {
        const c = map.get(t.uid);
        if (!c) return null;
        try {
          return JSON.parse(c.json) as Track;
        } catch {
          return { id: c.providerId, title: c.title, artist: c.artists, thumbnail: c.thumbnail || '' } as Track;
        }
      })
      .filter(Boolean);
    return { id: pl.id, name: pl.name, tracks };
  }

  async deletePlaylist(userId: string, id: string) {
    const pl = await this.prisma.userPlaylist.findFirst({ where: { id, userId } });
    if (!pl) throw new HttpException({ detail: 'Lista no encontrada.' }, 404);
    await this.prisma.userPlaylist.delete({ where: { id } });
    return { ok: true };
  }

  private durToMs(d?: string): number {
    if (!d) return 0;
    const parts = d.split(':').map((n) => parseInt(n, 10));
    if (parts.some((n) => Number.isNaN(n))) return 0;
    let s = 0;
    for (const p of parts) s = s * 60 + p;
    return s * 1000;
  }

  // ───────────────────────── esquema + prompt ─────────────────────────

  private buildSchema(tasks: Task[]) {
    const props: any = {
      summary: { type: Type.STRING, description: 'Resumen del gusto/estilo de la playlist (1-2 frases).' },
    };
    const required = ['summary'];

    if (tasks.includes('organize')) {
      props.organization = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            group: { type: Type.STRING },
            reason: { type: Type.STRING },
            trackIndices: { type: Type.ARRAY, items: { type: Type.INTEGER } },
          },
          required: ['group', 'trackIndices'],
        },
      };
    }
    if (tasks.includes('recommend')) {
      props.recommendations = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            artist: { type: Type.STRING },
            reason: { type: Type.STRING },
          },
          required: ['title', 'artist'],
        },
      };
    }
    if (tasks.includes('dedupe')) {
      props.duplicates = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            trackIndices: { type: Type.ARRAY, items: { type: Type.INTEGER } },
            reason: { type: Type.STRING },
          },
          required: ['trackIndices'],
        },
      };
      props.outliers = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            trackIndex: { type: Type.INTEGER },
            reason: { type: Type.STRING },
          },
          required: ['trackIndex'],
        },
      };
    }
    if (tasks.includes('themed')) {
      props.themedPlaylists = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            description: { type: Type.STRING },
            trackIndices: { type: Type.ARRAY, items: { type: Type.INTEGER } },
          },
          required: ['name', 'trackIndices'],
        },
      };
    }
    return { type: Type.OBJECT, properties: props, required };
  }

  private buildPrompt(
    title: string,
    list: string,
    tasks: Task[],
    suggestCount: number,
    truncated: boolean,
    total: number,
  ): string {
    const parts: string[] = [];
    parts.push(`Playlist: "${title}" (${total} canciones${truncated ? `; analiza las primeras ${MAX_TRACKS}` : ''}).`);
    parts.push(`Canciones (índice. título — artista):\n${list}`);
    parts.push('\nTareas:');
    if (tasks.includes('organize'))
      parts.push('- organization: agrupa las canciones en 3-6 grupos coherentes por mood, energía o género; usa trackIndices.');
    if (tasks.includes('recommend'))
      parts.push(
        `- recommendations: sugiere ${suggestCount} canciones NUEVAS (que NO estén en la lista) acordes al gusto, con variedad de artistas y un "reason" breve por cada una.`,
      );
    if (tasks.includes('dedupe'))
      parts.push(
        '- duplicates: agrupa por trackIndices posibles duplicados (misma canción o versiones casi idénticas). outliers: canciones que se salen del estilo, con su motivo.',
      );
    if (tasks.includes('themed'))
      parts.push(
        '- themedPlaylists: propón 2-4 playlists temáticas usando SOLO canciones existentes (trackIndices), cada una con un nombre atractivo y una descripción corta.',
      );
    parts.push('\nResponde únicamente con el JSON del esquema.');
    return parts.join('\n');
  }
}
