import { Module } from '@nestjs/common';
import { MatchService } from './match.service';
import { MatchController } from './match.controller';
import { YtmusicModule } from '../ytmusic/ytmusic.module';
import { ProvidersModule } from '../providers/providers.module';

// Reusa YtmusicService (búsqueda) y ProviderAccountService (resolución de usuario).
@Module({
  imports: [YtmusicModule, ProvidersModule],
  controllers: [MatchController],
  providers: [MatchService],
})
export class MatchModule {}
