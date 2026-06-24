// Modelo de datos unificado y contrato común para cada servicio de música.
// Ver docs/MULTI_PROVIDER_PLAN.md.

export type ProviderId = 'ytmusic' | 'spotify' | 'deezer';

/** Cómo se puede reproducir una pista concreta. */
export type PlaybackKind =
  | 'yt-stream' // audio servido por nuestro proxy (YouTube)
  | 'spotify-sdk' // Web Playback SDK (Premium, solo desktop)
  | 'preview' // clip de 30s (Deezer / Spotify)
  | 'match-needed'; // hay que emparejarla con YouTube para reproducirla

export interface UnifiedTrack {
  uid: string; // `${provider}:${providerId}` — id estable y único por instancia
  provider: ProviderId;
  providerId: string; // videoId / cola del uri Spotify / id Deezer
  title: string;
  artists: string[];
  album?: string;
  durationMs: number;
  isrc?: string; // clave de emparejamiento entre servicios
  thumbnail: string;
  playable: PlaybackKind;
  uri?: string; // p.ej. spotify:track:...
  previewUrl?: string;
}

export interface UnifiedPlaylist {
  uid: string;
  provider: ProviderId;
  providerId: string;
  title: string;
  trackCount: number;
  thumbnail: string;
}

export interface ProviderStatus {
  authenticated: boolean;
  user?: string;
  needsReauth?: boolean;
}

/**
 * Contrato que implementa cada servicio. Todas las operaciones reciben el
 * `userId` del usuario autenticado (multi-usuario: credenciales por usuario).
 * La autenticación/conexión vive en controladores por-proveedor porque los
 * flujos (cookie YT / OAuth Spotify / OAuth Deezer) difieren demasiado.
 */
export interface MusicProvider {
  readonly id: ProviderId;
  readonly playbackKind: PlaybackKind;

  status(userId: string): Promise<ProviderStatus>;
  search(userId: string, q: string, opts?: { type?: 'track' | 'playlist'; limit?: number }): Promise<UnifiedTrack[]>;
  getLibraryPlaylists(userId: string): Promise<UnifiedPlaylist[]>;
  getPlaylistTracks(userId: string, providerId: string, limit?: number): Promise<{ title: string; tracks: UnifiedTrack[] }>;
  getLikedSongs(userId: string, limit?: number): Promise<{ title: string; tracks: UnifiedTrack[] }>;

  /** Solo proveedores 'yt-stream': devuelve una URL de audio directa para hacer proxy. */
  resolveStreamUrl?(userId: string, track: UnifiedTrack): Promise<string>;
}

export function makeUid(provider: ProviderId, providerId: string): string {
  return `${provider}:${providerId}`;
}
