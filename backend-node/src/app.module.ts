import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ProvidersModule } from './providers/providers.module';
import { YtmusicModule } from './ytmusic/ytmusic.module';
import { StreamModule } from './stream/stream.module';
import { SpotifyModule } from './spotify/spotify.module';

@Module({
  imports: [PrismaModule, AuthModule, ProvidersModule, YtmusicModule, StreamModule, SpotifyModule],
})
export class AppModule {}
