import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    try {
      await this.$connect();
      // eslint-disable-next-line no-console
      console.log('[prisma] conectado a la base de datos');
    } catch (e: any) {
      // No tumbamos la app: el resto de funciones (YT/Spotify con archivos
      // locales, durante la transición) siguen operando aunque la BD no esté.
      console.warn(
        '[prisma] no se pudo conectar a la BD — ¿configuraste DATABASE_URL en backend-node/.env y corriste las migraciones? Detalle:',
        e?.message,
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect().catch(() => undefined);
  }
}
