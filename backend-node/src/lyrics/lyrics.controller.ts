import { Controller, Get, Query } from '@nestjs/common';
import { LyricsService } from './lyrics.service';

@Controller('lyrics')
export class LyricsController {
  constructor(private readonly lyrics: LyricsService) {}

  /** GET /api/lyrics?title=&artist=&album=&duration= */
  @Get()
  get(
    @Query('title') title: string,
    @Query('artist') artist: string,
    @Query('album') album?: string,
    @Query('duration') duration?: string,
  ) {
    return this.lyrics.get(title, artist, album, duration ? Number(duration) : undefined);
  }
}
