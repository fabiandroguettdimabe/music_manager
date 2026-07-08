import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { DiscoverService } from './discover.service';
import { ProviderAccountService } from '../providers/provider-account.service';

// Endpoints caros (fan-out a Gemini + pools de búsqueda en YT): límite por IP para
// que no se puedan usar como vector de agotamiento de recursos.
@Controller()
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 15, ttl: 60_000 } })
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
