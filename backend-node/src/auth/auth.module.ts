import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    // registerAsync so the secret is read at runtime (after dotenv loads in main.ts),
    // not at import time.
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        // Sin default inseguro: un secreto ausente hace los tokens forjables.
        // main.ts ya aborta el arranque antes de llegar aquí; esto es el backstop
        // para cualquier otro punto de entrada (p. ej. tests que importen AppModule).
        if (!secret) {
          throw new Error(
            'JWT_SECRET no está definido. Genera una cadena larga aleatoria y ponla en el .env antes de arrancar.',
          );
        }
        return { secret, signOptions: { expiresIn: '30d' } };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [JwtAuthGuard, JwtModule],
})
export class AuthModule {}
