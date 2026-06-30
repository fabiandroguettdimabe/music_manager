import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { YtmusicModule } from '../ytmusic/ytmusic.module';
import { SpotifyModule } from '../spotify/spotify.module';
import { ProvidersModule } from '../providers/providers.module';

// Reusa YtmusicService/SpotifyService (lectura de playlists) y ProviderAccountService
// (resolución de usuario). PrismaService es global.
@Module({
  imports: [YtmusicModule, SpotifyModule, ProvidersModule],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
