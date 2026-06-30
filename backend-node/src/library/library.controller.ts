import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put } from '@nestjs/common';
import { LibraryService } from './library.service';
import { ProviderAccountService } from '../providers/provider-account.service';

// Biblioteca de listas guardadas por usuario (cualquier servicio). Persiste las
// pistas tal cual se cargaron para poder reproducir desde la copia guardada sin
// volver a pedirlas al servicio de origen.
@Controller('library')
export class LibraryController {
  constructor(
    private readonly svc: LibraryService,
    private readonly accounts: ProviderAccountService,
  ) {}

  /** Guarda una lista: { name, tracks }. */
  @Post('playlists')
  async save(@Body() body: any, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.svc.save(userId, body?.name, body?.tracks);
  }

  @Get('playlists')
  async list(@Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.svc.list(userId);
  }

  @Get('playlists/:id')
  async one(@Param('id') id: string, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.svc.get(userId, id);
  }

  @Patch('playlists/:id')
  async rename(@Param('id') id: string, @Body() body: any, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.svc.rename(userId, id, body?.name);
  }

  /** Añade pistas a una lista: { tracks }. */
  @Post('playlists/:id/tracks')
  async addTracks(@Param('id') id: string, @Body() body: any, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.svc.addTracks(userId, id, body?.tracks);
  }

  /** Quita una pista de la lista por uid. */
  @Delete('playlists/:id/tracks/:uid')
  async removeTrack(@Param('id') id: string, @Param('uid') uid: string, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.svc.removeTrack(userId, id, decodeURIComponent(uid));
  }

  /** Reordena las pistas: { uids: [...] }. */
  @Put('playlists/:id/order')
  async reorder(@Param('id') id: string, @Body() body: any, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.svc.reorder(userId, id, body?.uids);
  }

  /** Reemplaza una pista por otra (corregir match): { oldUid, track }. */
  @Put('playlists/:id/replace')
  async replaceTrack(@Param('id') id: string, @Body() body: any, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.svc.replaceTrack(userId, id, body?.oldUid, body?.track);
  }

  @Delete('playlists/:id')
  async remove(@Param('id') id: string, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.svc.remove(userId, id);
  }
}
