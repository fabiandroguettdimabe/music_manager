import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProviderAccountService } from './provider-account.service';

// AuthModule exporta JwtModule (para verificar tokens en resolveUserId).
// PrismaService es global.
@Module({
  imports: [AuthModule],
  providers: [ProviderAccountService],
  exports: [ProviderAccountService],
})
export class ProvidersModule {}
