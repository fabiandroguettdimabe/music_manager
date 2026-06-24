import { Controller, Get, Headers, HttpException, Query } from '@nestjs/common';
import { YtmusicService } from './ytmusic.service';
import { ProviderAccountService } from '../providers/provider-account.service';

@Controller('search')
export class SearchController {
  constructor(
    private readonly yt: YtmusicService,
    private readonly accounts: ProviderAccountService,
  ) {}

  @Get()
  async search(@Query('q') q?: string, @Headers('authorization') authHeader?: string) {
    const query = (q || '').trim();
    if (!query) {
      throw new HttpException({ detail: 'El parámetro de búsqueda "q" es requerido.' }, 422);
    }
    const userId = await this.accounts.resolveUserId(authHeader);
    try {
      return await this.yt.search(userId, query);
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (/sign in/i.test(msg)) {
        throw new HttpException({ detail: 'Sesión expirada' }, 401);
      }
      throw new HttpException({ detail: msg }, 500);
    }
  }
}
