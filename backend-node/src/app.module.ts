import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ProvidersModule } from './providers/providers.module';
import { YtmusicModule } from './ytmusic/ytmusic.module';
import { StreamModule } from './stream/stream.module';
import { SpotifyModule } from './spotify/spotify.module';
import { AssistantModule } from './assistant/assistant.module';
import { LibraryModule } from './library/library.module';
import { SyncModule } from './sync/sync.module';
import { LyricsModule } from './lyrics/lyrics.module';
import { MatchModule } from './match/match.module';
import { DiscoverModule } from './discover/discover.module';
import { MeModule } from './me/me.module';
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [
    // Config por defecto del rate-limiter. Solo se aplica donde se usa ThrottlerGuard
    // (hoy, el login/registro) — no limita el resto de la API.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule, AuthModule, ProvidersModule, YtmusicModule, StreamModule, SpotifyModule, AssistantModule, LibraryModule, SyncModule, LyricsModule, MatchModule, DiscoverModule, MeModule, QueueModule,
  ],
})
export class AppModule {}
