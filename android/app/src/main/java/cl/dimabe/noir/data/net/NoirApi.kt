package cl.dimabe.noir.data.net

import kotlinx.serialization.json.JsonElement
import retrofit2.http.Body
import retrofit2.http.GET
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

    // Biblioteca
    @GET("playlists")
    suspend fun playlists(): PlaylistsResponse

    @GET("liked-songs")
    suspend fun likedSongs(@Query("limit") limit: Int = 5000): PlaylistDetail

    @GET("playlist/{id}")
    suspend fun playlist(@Path("id") id: String, @Query("limit") limit: Int = 5000): PlaylistDetail

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
}
