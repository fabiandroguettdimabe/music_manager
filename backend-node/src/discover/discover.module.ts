import { Module } from '@nestjs/common';
import { DiscoverController } from './discover.controller';
import { DiscoverService } from './discover.service';
import { GeminiService } from '../assistant/gemini.service';
import { YtmusicModule } from '../ytmusic/ytmusic.module';
import { SpotifyModule } from '../spotify/spotify.module';
import { ProvidersModule } from '../providers/providers.module';

// Reutiliza YtmusicService (automix + búsqueda) y SpotifyService (búsqueda + formato).
// GeminiService no tiene dependencias (solo lee env), así que se provee aquí directamente.
@Module({
  imports: [YtmusicModule, SpotifyModule, ProvidersModule],
  controllers: [DiscoverController],
  providers: [DiscoverService, GeminiService],
})
export class DiscoverModule {}
