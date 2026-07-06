import { Body, Controller, Headers, Post } from '@nestjs/common';
import { DiscoverService } from './discover.service';
import { ProviderAccountService } from '../providers/provider-account.service';

@Controller()
export class DiscoverController {
  constructor(
    private readonly discover: DiscoverService,
    private readonly accounts: ProviderAccountService,
  ) {}

  // Descubrir similares (Smart Shuffle) — para YouTube Music y Spotify.
  @Post('similar')
  async similar(@Body() body: any, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.discover.similar(userId, body);
  }

  // Colas por ánimo/actividad generadas con IA — para YouTube Music y Spotify.
  @Post('mood-queue')
  async moodQueue(@Body() body: any, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.discover.moodQueue(userId, body);
  }
}
