import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Estado sincronizable del usuario (favoritos, ajustes, EQ, resume, categorías…).
 * Guardado como key-value JSON por usuario en `UserKV`. Sustituye al localStorage
 * del frontend web para que la app Android y la web compartan los mismos datos.
 *
 * Claves usadas por los clientes (convención, no obligatoria):
 *   favorites, settings, eq, resume, categories, stats
 */
@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Todas las claves del usuario como un objeto { key: value }. */
  async getAll(userId: string): Promise<Record<string, unknown>> {
    const rows = await this.prisma.userKV.findMany({ where: { userId } });
    const out: Record<string, unknown> = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  /** Una sola clave (o null si no existe). */
  async get(userId: string, key: string): Promise<unknown | null> {
    const row = await this.prisma.userKV.findUnique({
      where: { userId_key: { userId, key } },
    });
    return row ? row.value : null;
  }

  /** Escribe (upsert) una clave con cualquier JSON. Devuelve el valor guardado. */
  async set(userId: string, key: string, value: unknown): Promise<{ key: string; value: unknown }> {
    // Prisma Json no acepta `undefined`; lo normalizamos a null.
    const v = (value === undefined ? null : value) as any;
    await this.prisma.userKV.upsert({
      where: { userId_key: { userId, key } },
      create: { userId, key, value: v },
      update: { value: v },
    });
    return { key, value: v };
  }

  /** Fusiona parcialmente un objeto en la clave (merge superficial). Útil para ajustes. */
  async merge(userId: string, key: string, patch: Record<string, unknown>): Promise<{ key: string; value: unknown }> {
    const current = (await this.get(userId, key)) as Record<string, unknown> | null;
    const base = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
    return this.set(userId, key, { ...base, ...(patch || {}) });
  }

  async remove(userId: string, key: string): Promise<{ ok: true }> {
    await this.prisma.userKV.deleteMany({ where: { userId, key } });
    return { ok: true };
  }
}
