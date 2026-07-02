import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Frena el registro/fuerza bruta: N intentos por minuto y por IP (ver trust proxy en main.ts).
  @Post('register')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body() body: any) {
    return this.auth.register(body?.email, body?.password, body?.name);
  }

  @Post('login')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  login(@Body() body: any) {
    return this.auth.login(body?.email, body?.password);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser('userId') userId: string) {
    return this.auth.me(userId);
  }
}
