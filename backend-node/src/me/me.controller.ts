import { Body, Controller, Delete, Get, Headers, Param, Put } from '@nestjs/common';
import { MeService } from './me.service';
import { ProviderAccountService } from '../providers/provider-account.service';

// Estado del usuario sincronizable entre web y la app Android.
// Todas las rutas resuelven el usuario del JWT (o el usuario local por defecto).
@Controller('me')
export class MeController {
  constructor(
    private readonly svc: MeService,
    private readonly accounts: ProviderAccountService,
  ) {}

  /** Todo el estado del usuario de una vez: { favorites, settings, eq, resume, ... }. */
  @Get('sync')
  async sync(@Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.svc.getAll(userId);
  }

  /** Lee una clave concreta. Devuelve { value }. */
  @Get('state/:key')
  async get(@Param('key') key: string, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return { value: await this.svc.get(userId, key) };
  }

  /**
   * Escribe una clave. El cuerpo puede ser el valor directo, o `{ value }`, o
   * `{ merge: {...} }` para fusión superficial (ajustes parciales).
   */
  @Put('state/:key')
  async put(@Param('key') key: string, @Body() body: any, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    if (body && typeof body === 'object' && !Array.isArray(body) && body.merge && typeof body.merge === 'object') {
      return this.svc.merge(userId, key, body.merge);
    }
    const value =
      body && typeof body === 'object' && !Array.isArray(body) && 'value' in body ? body.value : body;
    return this.svc.set(userId, key, value);
  }

  @Delete('state/:key')
  async del(@Param('key') key: string, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.svc.remove(userId, key);
  }
}
