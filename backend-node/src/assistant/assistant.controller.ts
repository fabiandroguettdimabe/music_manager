import { Body, Controller, Delete, Get, Headers, Param, Post } from '@nestjs/common';
import { AssistantService } from './assistant.service';
import { GeminiService } from './gemini.service';
import { ProviderAccountService } from '../providers/provider-account.service';

@Controller('assistant')
export class AssistantController {
  constructor(
    private readonly svc: AssistantService,
    private readonly gemini: GeminiService,
    private readonly accounts: ProviderAccountService,
  ) {}

  /** ¿Está configurada la API key? (para que el front avise antes de analizar) */
  @Get('status')
  status() {
    return { configured: this.gemini.isConfigured(), model: this.gemini.model };
  }

  /** Analiza una playlist: recomienda, organiza, detecta duplicados y propone listas temáticas. */
  @Post('analyze')
  async analyze(@Body() body: any, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.svc.analyze(userId, body);
  }

  /** Persiste una lista temática como UserPlaylist. */
  @Post('save-playlist')
  async save(@Body() body: any, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.svc.savePlaylist(userId, body?.name, body?.tracks);
  }

  @Get('playlists')
  async list(@Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.svc.listPlaylists(userId);
  }

  @Get('playlists/:id')
  async one(@Param('id') id: string, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.svc.getPlaylist(userId, id);
  }

  @Delete('playlists/:id')
  async remove(@Param('id') id: string, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.svc.deletePlaylist(userId, id);
  }
}
