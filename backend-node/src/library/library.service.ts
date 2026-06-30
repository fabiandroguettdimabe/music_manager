import { HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Pista tal como la envía el frontend (cualquier servicio). Se guarda el objeto
// completo en TrackCache.json para que, al reabrir la lista, cada pista conserve
// su `source`/`uri` y se reproduzca con el motor correcto (YouTube o Spotify).
interface SaveTrack {
  id?: string;
  uri?: string;
  source?: string;
  title?: string;
  artist?: string;
  thumbnail?: string;
  duration?: string;
  duration_seconds?: number;
  [k: string]: any;
}

@Injectable()
export class LibraryService {
  constructor(private readonly prisma: PrismaService) {}

  // Deriva (provider, providerId, uid) de una pista de cualquier servicio.
  //  · Spotify: id/uri = "spotify:track:XXXX" → providerId = XXXX.
  //  · YouTube / YouTube Music: id = videoId (ambos se reproducen por videoId).
  private identify(
    t: SaveTrack,
  ): { uid: string; provider: 'ytmusic' | 'spotify'; providerId: string } | null {
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

  private durationMs(t: SaveTrack): number {
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

  async save(userId: string, name: string, tracks: SaveTrack[]) {
    if (!name?.trim()) throw new HttpException({ detail: 'Falta el nombre de la lista.' }, 422);
    const valid = (tracks || [])
      .map((t) => ({ t, ident: this.identify(t) }))
      .filter((x): x is { t: SaveTrack; ident: NonNullable<ReturnType<LibraryService['identify']>> } => !!x.ident);
    if (!valid.length) {
      throw new HttpException({ detail: 'No hay canciones reproducibles para guardar.' }, 422);
    }

    const pl = await this.prisma.userPlaylist.create({ data: { userId, name: name.trim() } });

    let pos = 0;
    for (const { t, ident } of valid) {
      const { uid, provider, providerId } = ident;
      await this.prisma.trackCache.upsert({
        where: { uid },
        update: {
          title: t.title || '',
          artists: t.artist || '',
          durationMs: this.durationMs(t),
          thumbnail: t.thumbnail || null,
          json: JSON.stringify(t),
        },
        create: {
          uid,
          provider,
          providerId,
          title: t.title || '',
          artists: t.artist || '',
          durationMs: this.durationMs(t),
          thumbnail: t.thumbnail || null,
          json: JSON.stringify(t),
        },
      });
      await this.prisma.userPlaylistTrack.create({
        data: { playlistId: pl.id, uid, position: pos++ },
      });
    }
    return { id: pl.id, name: pl.name, count: pos };
  }

  async list(userId: string) {
    const pls = await this.prisma.userPlaylist.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { tracks: true } } },
    });
    return pls.map((p) => ({ id: p.id, name: p.name, count: p._count.tracks, createdAt: p.createdAt }));
  }

  async get(userId: string, id: string) {
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
          return JSON.parse(c.json) as SaveTrack;
        } catch {
          return { id: c.providerId, title: c.title, artist: c.artists, thumbnail: c.thumbnail || '' } as SaveTrack;
        }
      })
      .filter(Boolean);
    return { id: pl.id, name: pl.name, tracks };
  }

  // Añade pistas al final de una lista existente (sin duplicar las que ya están).
  async addTracks(userId: string, id: string, tracks: SaveTrack[]) {
    const pl = await this.prisma.userPlaylist.findFirst({ where: { id, userId } });
    if (!pl) throw new HttpException({ detail: 'Lista no encontrada.' }, 404);
    const valid = (tracks || [])
      .map((t) => ({ t, ident: this.identify(t) }))
      .filter((x): x is { t: SaveTrack; ident: NonNullable<ReturnType<LibraryService['identify']>> } => !!x.ident);

    const existingRows = await this.prisma.userPlaylistTrack.findMany({
      where: { playlistId: id },
      select: { uid: true, position: true },
    });
    const seen = new Set(existingRows.map((r) => r.uid));
    let pos = existingRows.reduce((m, r) => Math.max(m, r.position), -1) + 1;

    let added = 0;
    for (const { t, ident } of valid) {
      if (seen.has(ident.uid)) continue;
      seen.add(ident.uid);
      await this.prisma.trackCache.upsert({
        where: { uid: ident.uid },
        update: { title: t.title || '', artists: t.artist || '', durationMs: this.durationMs(t), thumbnail: t.thumbnail || null, json: JSON.stringify(t) },
        create: { uid: ident.uid, provider: ident.provider, providerId: ident.providerId, title: t.title || '', artists: t.artist || '', durationMs: this.durationMs(t), thumbnail: t.thumbnail || null, json: JSON.stringify(t) },
      });
      await this.prisma.userPlaylistTrack.create({ data: { playlistId: id, uid: ident.uid, position: pos++ } });
      added++;
    }
    return { added };
  }

  // Quita una pista de la lista por su uid.
  async removeTrack(userId: string, id: string, uid: string) {
    const pl = await this.prisma.userPlaylist.findFirst({ where: { id, userId } });
    if (!pl) throw new HttpException({ detail: 'Lista no encontrada.' }, 404);
    await this.prisma.userPlaylistTrack.deleteMany({ where: { playlistId: id, uid } });
    return { ok: true };
  }

  // Reordena las pistas de la lista según el array de uids recibido.
  async reorder(userId: string, id: string, uids: string[]) {
    const pl = await this.prisma.userPlaylist.findFirst({ where: { id, userId } });
    if (!pl) throw new HttpException({ detail: 'Lista no encontrada.' }, 404);
    if (!Array.isArray(uids)) throw new HttpException({ detail: 'Orden inválido.' }, 422);
    const rows = await this.prisma.userPlaylistTrack.findMany({ where: { playlistId: id } });
    const byUid = new Map<string, { id: string }>();
    for (const r of rows) if (!byUid.has(r.uid)) byUid.set(r.uid, { id: r.id });
    let pos = 0;
    for (const uid of uids) {
      const r = byUid.get(uid);
      if (r) await this.prisma.userPlaylistTrack.update({ where: { id: r.id }, data: { position: pos++ } });
    }
    return { ok: true };
  }

  async rename(userId: string, id: string, name: string) {
    if (!name?.trim()) throw new HttpException({ detail: 'Falta el nuevo nombre.' }, 422);
    const pl = await this.prisma.userPlaylist.findFirst({ where: { id, userId } });
    if (!pl) throw new HttpException({ detail: 'Lista no encontrada.' }, 404);
    const updated = await this.prisma.userPlaylist.update({
      where: { id },
      data: { name: name.trim() },
    });
    return { id: updated.id, name: updated.name };
  }

  async remove(userId: string, id: string) {
    const pl = await this.prisma.userPlaylist.findFirst({ where: { id, userId } });
    if (!pl) throw new HttpException({ detail: 'Lista no encontrada.' }, 404);
    await this.prisma.userPlaylist.delete({ where: { id } });
    return { ok: true };
  }

  // Reemplaza una pista por otra (p.ej. corregir un match equivocado), en su misma posición.
  async replaceTrack(userId: string, id: string, oldUid: string, track: SaveTrack) {
    const pl = await this.prisma.userPlaylist.findFirst({ where: { id, userId } });
    if (!pl) throw new HttpException({ detail: 'Lista no encontrada.' }, 404);
    const ident = this.identify(track);
    if (!ident) throw new HttpException({ detail: 'Pista de reemplazo inválida.' }, 422);

    const old = await this.prisma.userPlaylistTrack.findFirst({
      where: { playlistId: id, uid: oldUid },
      orderBy: { position: 'asc' },
    });
    const maxRow = await this.prisma.userPlaylistTrack.findFirst({
      where: { playlistId: id },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const position = old?.position ?? (maxRow ? maxRow.position + 1 : 0);

    await this.prisma.trackCache.upsert({
      where: { uid: ident.uid },
      update: { title: track.title || '', artists: track.artist || '', durationMs: this.durationMs(track), thumbnail: track.thumbnail || null, json: JSON.stringify(track) },
      create: { uid: ident.uid, provider: ident.provider, providerId: ident.providerId, title: track.title || '', artists: track.artist || '', durationMs: this.durationMs(track), thumbnail: track.thumbnail || null, json: JSON.stringify(track) },
    });

    if (oldUid) await this.prisma.userPlaylistTrack.deleteMany({ where: { playlistId: id, uid: oldUid } });
    const exists = await this.prisma.userPlaylistTrack.findFirst({ where: { playlistId: id, uid: ident.uid } });
    if (!exists) await this.prisma.userPlaylistTrack.create({ data: { playlistId: id, uid: ident.uid, position } });
    return { ok: true, uid: ident.uid };
  }
}
