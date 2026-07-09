package cl.dimabe.noir.data.net

import kotlinx.serialization.json.JsonElement
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.PUT
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/** Contrato del backend Real Shuffle Player (prefijo /api ya incluido en baseUrl). */
interface NoirApi {

    // Auth
    @POST("auth/login")
    suspend fun login(@Body body: LoginRequest): LoginResponse

    @GET("auth/me")
    suspend fun me(): UserDto

    // Estado de conexión a YouTube Music (sirve como health-check).
    @GET("status")
    suspend fun status(): YtStatus

    // Guarda la cookie de sesión de YT Music capturada por el WebView de login.
    @POST("save-auth")
    suspend fun saveAuth(@Body body: SaveAuthRequest)

    // Biblioteca
    @GET("playlists")
    suspend fun playlists(): PlaylistsResponse

    @GET("liked-songs")
    suspend fun likedSongs(@Query("limit") limit: Int = 5000): PlaylistDetail

    @GET("playlist/{id}")
    suspend fun playlist(@Path("id") id: String, @Query("limit") limit: Int = 5000): PlaylistDetail

    // Playlists de YouTube "normal" (no Music), misma cuenta de YT Music conectada.
    @GET("youtube-playlists")
    suspend fun youtubePlaylists(): PlaylistsResponse

    @GET("youtube-playlist/{id}")
    suspend fun youtubePlaylist(@Path("id") id: String, @Query("limit") limit: Int = 5000): PlaylistDetail

    // Playlists de Spotify (solo lectura; las pistas se resuelven a YouTube vía el
    // manifiesto offline — Android no tiene el SDK nativo de Spotify).
    @GET("spotify/status")
    suspend fun spotifyStatus(): SpotifyStatus

    @GET("spotify/playlists")
    suspend fun spotifyPlaylists(): PlaylistsResponse

    @GET("spotify/playlist/{id}")
    suspend fun spotifyPlaylist(@Path("id") id: String, @Query("limit") limit: Int = 5000): PlaylistDetail

    @GET("spotify/liked")
    suspend fun spotifyLiked(@Query("limit") limit: Int = 5000): PlaylistDetail

    // Listas guardadas dentro de la propia app ("Mis listas"), compartidas con la web.
    @GET("library/playlists")
    suspend fun appPlaylists(): List<AppPlaylistSummary>

    @GET("library/playlists/{id}")
    suspend fun appPlaylist(@Path("id") id: String): AppPlaylistDetail

    @PATCH("library/playlists/{id}")
    suspend fun renameAppPlaylist(@Path("id") id: String, @Body body: RenameRequest)

    @DELETE("library/playlists/{id}")
    suspend fun deleteAppPlaylist(@Path("id") id: String)

    @DELETE("library/playlists/{id}/tracks/{uid}")
    suspend fun removeAppPlaylistTrack(@Path("id") id: String, @Path("uid") uid: String)

    // Radio infinita: siembra desde una pista y trae más afines (autoplay de YT Music).
    @GET("radio/{id}")
    suspend fun radio(@Path("id") id: String, @Query("limit") limit: Int = 25): PlaylistDetail

    @GET("search")
    suspend fun search(@Query("q") q: String): SearchResponse

    @GET("lyrics")
    suspend fun lyrics(
        @Query("title") title: String,
        @Query("artist") artist: String,
        @Query("duration") duration: Int? = null,
    ): LyricsResponse

    // Cola con real-shuffle en el servidor
    @POST("queue/start")
    suspend fun queueStart(@Body body: QueueStartRequest): QueueSnapshot

    @POST("queue/next")
    suspend fun queueNext(@Body body: SessionRequest): QueueSnapshot

    @POST("queue/prev")
    suspend fun queuePrev(@Body body: SessionRequest): QueueSnapshot

    @POST("queue/peek")
    suspend fun queuePeek(@Body body: SessionRequest): QueueSnapshot

    @POST("queue/add-next")
    suspend fun queueAddNext(@Body body: SessionRequest): QueueSnapshot

    @POST("queue/mode")
    suspend fun queueMode(@Body body: SessionRequest): QueueSnapshot

    // Estado sincronizable del usuario
    @GET("me/sync")
    suspend fun meSync(): Map<String, JsonElement>

    @PUT("me/state/{key}")
    suspend fun meSet(@Path("key") key: String, @Body value: JsonElement): JsonElement

    // Manifiesto de descargas offline (compartido con la web)
    @GET("offline")
    suspend fun offline(): OfflineResponse

    @POST("offline")
    suspend fun offlineAdd(@Body body: OfflineTrackDto)

    @DELETE("offline/{id}")
    suspend fun offlineRemove(@Path("id") id: String)
}
