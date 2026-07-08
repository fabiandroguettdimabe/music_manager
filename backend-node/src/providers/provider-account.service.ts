import { HttpException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { decryptJson, encryptJson } from '../common/crypto.util';
import { ProviderId } from './provider.interface';

/**
 * Almacena y recupera las credenciales de cada servicio POR usuario (cifradas),
 * y resuelve el usuario efectivo de una request.
 *
 * Política de auth: FAIL-CLOSED. Toda ruta de datos que llame a resolveUserId
 * exige un JWT válido; sin él responde 401. El usuario "default@local" solo se
 * usa internamente (defaultUserId) como origen de credenciales compartidas del
 * cliente anónimo y para la migración del backend mono-usuario anterior — nunca
 * como fallback silencioso de una request no autenticada.
 */
@Injectable()
export class ProviderAccountService {
  private defaultId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** userId del JWT válido. Sin token válido → 401 (fail-closed). */
  async resolveUserId(authHeader?: string): Promise<string> {
    const m = /^Bearer (.+)$/.exec(authHeader || '');
    if (!m) throw new HttpException({ detail: 'No autenticado' }, 401);
    try {
      const payload: any = this.jwt.verify(m[1]);
      if (payload?.sub) return payload.sub;
    } catch {
      /* firma/expiración inválida → 401 abajo */
    }
    throw new HttpException({ detail: 'Token inválido o expirado' }, 401);
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
