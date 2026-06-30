import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { SyncService } from './sync.service';
import { ProviderAccountService } from '../providers/provider-account.service';

// Comparte el prefijo 'library' con LibraryController (rutas distintas, sin choque).
@Controller('library')
export class SyncController {
  constructor(
    private readonly sync: SyncService,
    private readonly accounts: ProviderAccountService,
  ) {}

  /** Sincroniza AHORA las listas del usuario actual (sin esperar al intervalo). */
  @Post('sync')
  async syncNow(@Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    // El botón manual empuja un lote mayor (las más desactualizadas); el resto se
    // completa solo por rotación. El manejo de 429 lo mantiene seguro.
    const r = await this.sync.runForUser(userId, 15);
    return { ok: true, ...r };
  }

  /** Estado del job (activo, en curso, intervalo, último run). */
  @Get('sync/status')
  status() {
    return this.sync.getStatus();
  }

  /** Cacheo on-demand: guarda una lista cargada por el cliente. { provider, providerId, title, thumbnail, tracks } */
  @Post('cache')
  async cache(@Body() body: any, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.sync.cacheFromClient(userId, body?.provider, body?.providerId, body?.title, body?.tracks, body?.thumbnail);
  }

  /** Lista las playlists sincronizadas del usuario. */
  @Get('synced')
  async listSynced(@Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.sync.listSynced(userId);
  }

  /** Pistas de una playlist sincronizada (para reproducir/mezclar desde la DB). */
  @Get('synced/:provider/:providerId')
  async syncedTracks(
    @Param('provider') provider: string,
    @Param('providerId') providerId: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const userId = await this.accounts.resolveUserId(authHeader);
    const tracks = await this.sync.getSyncedTracks(userId, provider, decodeURIComponent(providerId));
    return { tracks };
  }
}
