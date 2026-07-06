import { Body, Controller, Headers, Param, Post } from '@nestjs/common';
import { QueueService } from './queue.service';
import { ProviderAccountService } from '../providers/provider-account.service';

// Cola de reproducción con real-shuffle gestionada en el servidor. Un dispositivo
// crea una sesión con /start y luego pide /next, /prev, /peek, etc.
@Controller('queue')
export class QueueController {
  constructor(
    private readonly svc: QueueService,
    private readonly accounts: ProviderAccountService,
  ) {}

  /** Crea la sesión: { tracks, mode?: 'bag'|'reorden', avoidWindow?, startId? }. */
  @Post('start')
  async start(@Body() body: any, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.svc.start(userId, body);
  }

  @Post('next')
  async next(@Body() body: any, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.svc.next(userId, body?.sessionId);
  }

  @Post('prev')
  async prev(@Body() body: any, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.svc.prev(userId, body?.sessionId);
  }

  /** Espiar / rifar la siguiente (reorden): { sessionId, reroll?: boolean }. */
  @Post('peek')
  async peek(@Body() body: any, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.svc.peek(userId, body?.sessionId, !!body?.reroll);
  }

  /** Reproducir a continuación: { sessionId, track }. */
  @Post('add-next')
  async addNext(@Body() body: any, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.svc.addNext(userId, body?.sessionId, body?.track);
  }

  /** Añadir pistas (radio infinita / descubrir): { sessionId, tracks }. */
  @Post('append')
  async append(@Body() body: any, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.svc.append(userId, body?.sessionId, body?.tracks || []);
  }

  /** Cambiar modo: { sessionId, mode: 'bag'|'reorden', avoidWindow? }. */
  @Post('mode')
  async mode(@Body() body: any, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.svc.setMode(userId, body?.sessionId, body?.mode, body?.avoidWindow);
  }

  @Post('state')
  async state(@Body() body: any, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.svc.get(userId, body?.sessionId);
  }

  @Post('end/:sessionId')
  async end(@Param('sessionId') sessionId: string, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.svc.end(userId, sessionId);
  }
}
