import { Module } from '@nestjs/common';
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

@Module({
  imports: [PrismaModule, AuthModule, ProvidersModule, YtmusicModule, StreamModule, SpotifyModule, AssistantModule, LibraryModule, SyncModule, LyricsModule, MatchModule],
})
export class AppModule {}
