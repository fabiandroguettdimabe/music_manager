package cl.dimabe.noir.data.repo

import cl.dimabe.noir.data.net.ApiProvider
import cl.dimabe.noir.data.net.LoginRequest
import cl.dimabe.noir.data.net.LoginResponse
import cl.dimabe.noir.data.net.PlaylistDetail
import cl.dimabe.noir.data.net.PlaylistSummary
import cl.dimabe.noir.data.net.QueueSnapshot
import cl.dimabe.noir.data.net.QueueStartRequest
import cl.dimabe.noir.data.net.SessionRequest
import cl.dimabe.noir.data.net.Track
import cl.dimabe.noir.data.net.YtStatus
import cl.dimabe.noir.data.prefs.SettingsStore
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonElement
import retrofit2.HttpException
import java.net.URLEncoder

/** Fachada de datos: envuelve la API, resuelve la URL de streaming y traduce errores. */
class NoirRepository(
    private val apiProvider: ApiProvider,
    val settings: SettingsStore,
) {
    private fun api() = apiProvider.api()

    // ── auth ──
    suspend fun login(email: String, password: String): LoginResponse =
        api().login(LoginRequest(email.trim(), password))

    suspend fun me() = api().me()

    suspend fun status(): YtStatus = runCatching { api().status() }.getOrDefault(YtStatus())

    /** Igual que status() pero propaga el error: sirve para probar la conexión. */
    suspend fun ping(): YtStatus = api().status()

    /** Guarda en el backend la cookie de YT Music capturada por el WebView de login. */
    suspend fun saveYtAuth(cookie: String) =
        api().saveAuth(
            cl.dimabe.noir.data.net.SaveAuthRequest(cl.dimabe.noir.data.net.SaveAuthContent(cookie)),
        )

    // ── biblioteca ──
    suspend fun playlists(): List<PlaylistSummary> = api().playlists().playlists

    suspend fun likedSongs(): PlaylistDetail = api().likedSongs()

    suspend fun playlist(id: String): PlaylistDetail = api().playlist(id)

    suspend fun youtubePlaylists(): List<PlaylistSummary> = api().youtubePlaylists().playlists
    suspend fun youtubePlaylist(id: String): PlaylistDetail = api().youtubePlaylist(id)

    suspend fun spotifyStatus() = api().spotifyStatus()
    suspend fun spotifyPlaylists(): List<PlaylistSummary> = api().spotifyPlaylists().playlists
    suspend fun spotifyPlaylist(id: String): PlaylistDetail = api().spotifyPlaylist(id)
    suspend fun spotifyLiked(): PlaylistDetail = api().spotifyLiked()

    suspend fun appPlaylists(): List<cl.dimabe.noir.data.net.AppPlaylistSummary> = api().appPlaylists()
    suspend fun appPlaylist(id: String): cl.dimabe.noir.data.net.AppPlaylistDetail = api().appPlaylist(id)

    /** Crea una lista de la app con la(s) pista(s) inicial(es). */
    suspend fun createAppPlaylist(name: String, tracks: List<Track>) =
        api().createAppPlaylist(cl.dimabe.noir.data.net.CreatePlaylistRequest(name, tracks))

    /** Añade una pista a una lista existente de la app. */
    suspend fun addTrackToAppPlaylist(playlistId: String, track: Track) =
        api().addTracksToAppPlaylist(playlistId, cl.dimabe.noir.data.net.AddTracksRequest(listOf(track)))
    suspend fun renameAppPlaylist(id: String, name: String) =
        api().renameAppPlaylist(id, cl.dimabe.noir.data.net.RenameRequest(name))
    suspend fun deleteAppPlaylist(id: String) = api().deleteAppPlaylist(id)
    suspend fun removeAppPlaylistTrack(id: String, uid: String) = api().removeAppPlaylistTrack(id, uid)

    /** Radio infinita: pistas afines a partir de una semilla (autoplay de YT Music). */
    suspend fun radio(seedId: String): List<Track> = api().radio(seedId).tracks

    suspend fun search(query: String): List<Track> = api().search(query).tracks

    suspend fun lyrics(title: String, artist: String, durationSec: Int?) =
        api().lyrics(title, artist, durationSec)

    // ── cola en el servidor ──
    suspend fun queueStart(tracks: List<Track>, mode: String, startId: String? = null): QueueSnapshot =
        api().queueStart(QueueStartRequest(tracks = tracks, mode = mode, startId = startId))

    suspend fun queueNext(sessionId: String): QueueSnapshot =
        api().queueNext(SessionRequest(sessionId))

    suspend fun queuePrev(sessionId: String): QueueSnapshot =
        api().queuePrev(SessionRequest(sessionId))

    suspend fun queuePeek(sessionId: String, reroll: Boolean): QueueSnapshot =
        api().queuePeek(SessionRequest(sessionId, reroll = reroll))

    suspend fun queueAddNext(sessionId: String, track: Track): QueueSnapshot =
        api().queueAddNext(SessionRequest(sessionId, track = track))

    suspend fun queueMode(sessionId: String, mode: String, avoidWindow: Int?): QueueSnapshot =
        api().queueMode(SessionRequest(sessionId, mode = mode, avoidWindow = avoidWindow))

    // ── estado sincronizable ──
    suspend fun sync(): Map<String, JsonElement> = api().meSync()

    suspend fun setState(key: String, value: JsonElement) = api().meSet(key, value)

    // ── favoritos (mapa id→pista, sincronizado con la web) ──
    private val favSerializer = MapSerializer(String.serializer(), cl.dimabe.noir.data.net.Track.serializer())

    suspend fun getFavorites(): Map<String, cl.dimabe.noir.data.net.Track> {
        val all = api().meSync()
        val fav = all["favorites"] ?: return emptyMap()
        return runCatching { apiProvider.jsonCodec.decodeFromJsonElement(favSerializer, fav) }.getOrDefault(emptyMap())
    }

    suspend fun setFavorites(map: Map<String, cl.dimabe.noir.data.net.Track>) {
        val el = apiProvider.jsonCodec.encodeToJsonElement(favSerializer, map)
        api().meSet("favorites", el)
    }

    // ── streaming ──
    /** URL de audio en vivo (HQ AAC 128k, con Range). Para reproducción normal. */
    fun streamUrl(videoId: String): String {
        val base = settings.cachedBaseUrl.trimEnd('/')
        val id = URLEncoder.encode(videoId, "UTF-8")
        return "$base/api/stream-audio/$id?fmt=hq"
    }

    /**
     * URL para DESCARGAR entero (AAC progresivo, SIN fmt=hq). El HQ itag 140 está throttled
     * a ~1 MB sin PoToken; el progresivo itag 18 sí se baja completo.
     */
    fun downloadUrl(videoId: String): String {
        val base = settings.cachedBaseUrl.trimEnd('/')
        val id = URLEncoder.encode(videoId, "UTF-8")
        return "$base/api/stream-audio/$id"
    }

    // ── descargas offline (manifiesto compartido con la web) ──
    suspend fun offlineList(): List<cl.dimabe.noir.data.net.OfflineTrackDto> = api().offline().tracks

    suspend fun offlineAdd(t: cl.dimabe.noir.data.net.OfflineTrackDto) = api().offlineAdd(t)

    suspend fun offlineRemove(videoId: String) = api().offlineRemove(videoId)

    companion object {
        /** Mensaje legible desde una excepción de red / HTTP del backend ({ detail }). */
        fun errorMessage(t: Throwable): String = when (t) {
            is HttpException -> {
                val body = runCatching { t.response()?.errorBody()?.string() }.getOrNull()
                val detail = body?.let { Regex("\"detail\"\\s*:\\s*\"([^\"]*)\"").find(it)?.groupValues?.get(1) }
                detail ?: "Error ${t.code()}"
            }
            else -> t.message ?: "Error de red. ¿La URL del servidor es correcta y está encendido?"
        }
    }
}
