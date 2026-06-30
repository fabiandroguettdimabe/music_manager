import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
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
}
