import { Body, Controller, Get, Headers, HttpException, Param, Post, Query } from '@nestjs/common';
import { YtmusicService } from './ytmusic.service';
import { ProviderAccountService } from '../providers/provider-account.service';

@Controller()
export class YtmusicController {
  constructor(
    private readonly yt: YtmusicService,
    private readonly accounts: ProviderAccountService,
  ) {}

  // ───────────── status / gestión de auth ─────────────

  @Get('status')
  async status(@Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.yt.getStatus(userId);
  }

  @Post('save-auth')
  async saveAuth(@Body() body: any, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.yt.saveAuth(userId, body?.content);
  }

  @Post('logout')
  async logout(@Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.yt.logout(userId);
  }

  // ───────────── OAuth device flow (deshabilitado) ─────────────

  @Post('oauth/init')
  oauthInit() {
    return this.yt.oauthInit();
  }

  @Post('oauth/verify')
  oauthVerify() {
    return this.yt.oauthVerify('');
  }

  // ───────────── auto-captura desde el navegador ─────────────

  @Post('auth/browser-capture')
  async browserCapture(@Body() body: any, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    const browser = (body?.browser || 'firefox').toLowerCase();
    if (browser === 'firefox') {
      return this.yt.captureFromFirefox(userId);
    }
    throw new HttpException(
      {
        detail:
          `La auto-captura solo está disponible para Firefox (sus cookies no están cifradas). ` +
          `Para ${browser}, usa el método manual: pega las cabeceras de music.youtube.com.`,
      },
      400,
    );
  }

  // ───────────── datos de biblioteca ─────────────

  @Get('playlists')
  async playlists(@Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    if (!(await this.yt.hasAuth(userId))) {
      throw new HttpException(
        { detail: 'Autenticación requerida para ver playlists de biblioteca.' },
        401,
      );
    }
    return this.yt.getLibraryPlaylists(userId);
  }

  @Get('liked-songs')
  async likedSongs(@Query('limit') limit?: string, @Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    if (!(await this.yt.hasAuth(userId))) {
      throw new HttpException(
        { detail: "Autenticación requerida para obtener 'Canciones que te gustan'." },
        401,
      );
    }
    return this.yt.getLikedSongs(userId, limit ? parseInt(limit, 10) : 5000);
  }

  @Get('playlist/:id')
  async playlist(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.yt.getPlaylist(userId, id, limit ? parseInt(limit, 10) : 5000);
  }

  // ───────────── playlists de YouTube "normal" (no Music) ─────────────

  @Get('youtube-playlists')
  async youtubePlaylists(@Headers('authorization') authHeader?: string) {
    const userId = await this.accounts.resolveUserId(authHeader);
    if (!(await this.yt.hasAuth(userId))) {
      throw new HttpException(
        { detail: 'Autenticación requerida para ver tus playlists de YouTube.' },
        401,
      );
    }
    return this.yt.getYouTubePlaylists(userId);
  }

  @Get('youtube-playlist/:id')
  async youtubePlaylist(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const userId = await this.accounts.resolveUserId(authHeader);
    return this.yt.getYouTubePlaylist(userId, id, limit ? parseInt(limit, 10) : 5000);
  }
}
