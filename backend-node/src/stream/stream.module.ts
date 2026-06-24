import { Module } from '@nestjs/common';
import { StreamController } from './stream.controller';
import { YtmusicModule } from '../ytmusic/ytmusic.module';

@Module({
  imports: [YtmusicModule],
  controllers: [StreamController],
})
export class StreamModule {}
