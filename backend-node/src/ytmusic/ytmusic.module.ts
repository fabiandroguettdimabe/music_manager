import { Module } from '@nestjs/common';
import { YtmusicService } from './ytmusic.service';
import { YtmusicController } from './ytmusic.controller';
import { SearchController } from './search.controller';
import { ProvidersModule } from '../providers/providers.module';

@Module({
  imports: [ProvidersModule],
  controllers: [YtmusicController, SearchController],
  providers: [YtmusicService],
  exports: [YtmusicService],
})
export class YtmusicModule {}
