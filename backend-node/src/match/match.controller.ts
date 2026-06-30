import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { MatchService } from './match.service';
import { ProviderAccountService } from '../providers/provider-account.service';

// Comparte el prefijo 'library' (rutas distintas, sin choque con Library/Sync).
@Controller('library')
export class MatchController {
  constructor(
    private readonly match: MatchService,
    private readonly accounts: ProviderAccountService,
  ) {}

  /** Importa un CSV ya parseado: { name, rows:[{uri,title,artist,durationMs}] }. Devuelve { jobId, total }. */
  @Post('import-csv')
  async importCsv(@Body() body: any, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.match.startImport(userId, body?.name, body?.rows);
  }

  /** Progreso del emparejado: { total, done, matched, failed, status }. */
  @Get('import-csv/:jobId')
  progress(@Param('jobId') jobId: string) {
    return this.match.getProgress(jobId) || { status: 'unknown' };
  }

  /** Resuelve una pista (de Spotify) a su equivalente de YouTube. Para smart-play en vivo. */
  @Get('match')
  async resolve(
    @Query('uri') uri?: string,
    @Query('title') title?: string,
    @Query('artist') artist?: string,
    @Query('duration') duration?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const userId = await this.accounts.resolveUserId(authHeader);
    const track = await this.match.matchOne(userId, {
      uri,
      title,
      artist,
      durationMs: duration ? Number(duration) : 0,
    });
    return { track: track || null };
  }
}
