import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { decryptJson, encryptJson } from '../common/crypto.util';
import { ProviderId } from './provider.interface';

/**
 * Almacena y recupera las credenciales de cada servicio POR usuario (cifradas),
 * y resuelve el usuario efectivo de una request.
 *
 * Puente de transición: si la request no trae JWT, opera sobre un usuario
 * "default@local". Esto mantiene la app actual (sin login) funcionando mientras
 * se construye el login del frontend; se quitará cuando el login sea obligatorio.
 */
@Injectable()
export class ProviderAccountService {
  private defaultId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** userId del JWT si es válido; si no, el usuario local por defecto. */
  async resolveUserId(authHeader?: string): Promise<string> {
    const m = /^Bearer (.+)$/.exec(authHeader || '');
    if (m) {
      try {
        const payload: any = this.jwt.verify(m[1]);
        if (payload?.sub) return payload.sub;
      } catch {
        /* token inválido → cae al usuario por defecto */
      }
    }
    return this.defaultUserId();
  }

  async defaultUserId(): Promise<string> {
    if (this.defaultId) return this.defaultId;
    const email = 'default@local';
    const user =
      (await this.prisma.user.findUnique({ where: { email } })) ??
      (await this.prisma.user.create({ data: { email, name: 'Local' } }));
    this.defaultId = user.id;
    return user.id;
  }

  async getAuth<T = any>(userId: string, provider: ProviderId): Promise<T | null> {
    const acc = await this.prisma.providerAccount.findUnique({
      where: { userId_provider: { userId, provider } },
    });
    if (!acc) return null;
    try {
      return decryptJson<T>(acc.authJson);
    } catch {
      return null;
    }
  }

  async setAuth(userId: string, provider: ProviderId, data: unknown, displayName?: string): Promise<void> {
    const authJson = encryptJson(data);
    await this.prisma.providerAccount.upsert({
      where: { userId_provider: { userId, provider } },
      create: { userId, provider, authJson, displayName: displayName ?? null },
      update: { authJson, displayName: displayName ?? null },
    });
  }

  async deleteAuth(userId: string, provider: ProviderId): Promise<void> {
    await this.prisma.providerAccount.deleteMany({ where: { userId, provider } });
  }

  /** ¿Tiene este usuario una cuenta conectada para el proveedor? */
  async isConnected(userId: string, provider: ProviderId): Promise<boolean> {
    const acc = await this.prisma.providerAccount.findUnique({
      where: { userId_provider: { userId, provider } },
      select: { id: true },
    });
    return !!acc;
  }
}
