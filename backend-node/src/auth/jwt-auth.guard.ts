import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers['authorization'] || '';
    const match = /^Bearer (.+)$/.exec(header);
    if (!match) throw new HttpException({ detail: 'No autenticado' }, 401);
    try {
      const payload: any = this.jwt.verify(match[1]);
      req.user = { userId: payload.sub, email: payload.email };
      return true;
    } catch {
      throw new HttpException({ detail: 'Token inválido o expirado' }, 401);
    }
  }
}
