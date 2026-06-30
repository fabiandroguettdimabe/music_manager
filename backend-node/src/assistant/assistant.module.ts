import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { GeminiService } from './gemini.service';
import { YtmusicModule } from '../ytmusic/ytmusic.module';
import { ProvidersModule } from '../providers/providers.module';

// YtmusicModule exporta YtmusicService (búsqueda + lectura de playlists).
// ProvidersModule exporta ProviderAccountService (resolución de usuario).
// PrismaService es global.
@Module({
  imports: [YtmusicModule, ProvidersModule],
  controllers: [AssistantController],
  providers: [GeminiService, AssistantService],
})
export class AssistantModule {}
