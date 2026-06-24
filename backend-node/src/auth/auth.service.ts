import { HttpException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(email: string, password: string, name?: string) {
    email = (email || '').trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new HttpException({ detail: 'Email inválido' }, 400);
    }
    if (!password || password.length < 8) {
      throw new HttpException({ detail: 'La contraseña debe tener al menos 8 caracteres' }, 400);
    }
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new HttpException({ detail: 'Ese email ya está registrado' }, 409);

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.prisma.user.create({
      data: { email, passwordHash, name: name?.trim() || null },
    });
    await this.inheritDefaultIfFirstUser(user.id);
    return this.issue(user);
  }

  /**
   * El PRIMER usuario real adopta las conexiones del usuario puente
   * default@local (las credenciales migradas del backend mono-usuario anterior),
   * para no tener que reconectar los servicios a mano.
   */
  private async inheritDefaultIfFirstUser(newUserId: string): Promise<void> {
    try {
      const realUsers = await this.prisma.user.count({ where: { email: { not: 'default@local' } } });
      if (realUsers !== 1) return; // ya había usuarios reales → no heredar
      const def = await this.prisma.user.findUnique({ where: { email: 'default@local' } });
      if (!def) return;
      const accounts = await this.prisma.providerAccount.findMany({ where: { userId: def.id } });
      for (const acc of accounts) {
        const exists = await this.prisma.providerAccount.findUnique({
          where: { userId_provider: { userId: newUserId, provider: acc.provider } },
        });
        if (exists) continue;
        await this.prisma.providerAccount.update({ where: { id: acc.id }, data: { userId: newUserId } });
      }
    } catch (e: any) {
      console.warn('[auth] inherit default connections failed:', e?.message);
    }
  }

  async login(email: string, password: string) {
    email = (email || '').trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash || !(await bcrypt.compare(password || '', user.passwordHash))) {
      throw new HttpException({ detail: 'Credenciales inválidas' }, 401);
    }
    return this.issue(user);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new HttpException({ detail: 'Usuario no encontrado' }, 404);
    return { id: user.id, email: user.email, name: user.name };
  }

  private issue(user: { id: string; email: string; name: string | null }) {
    const token = this.jwt.sign({ sub: user.id, email: user.email });
    return { token, user: { id: user.id, email: user.email, name: user.name } };
  }
}
