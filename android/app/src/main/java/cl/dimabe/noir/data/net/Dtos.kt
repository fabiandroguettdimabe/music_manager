package cl.dimabe.noir.data.net

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// ─────────────── autenticación ───────────────

@Serializable
data class LoginRequest(val email: String, val password: String)

@Serializable
data class UserDto(val id: String, val email: String, val name: String? = null)

@Serializable
data class LoginResponse(val token: String, val user: UserDto)

@Serializable
data class YtStatus(
    val authenticated: Boolean = false,
    val method: String? = null,
    val user: String? = null,
)

@Serializable
data class SpotifyStatus(
    val authenticated: Boolean = false,
    @SerialName("user_name") val userName: String? = null,
)

// ─────────────── catálogo ───────────────

@Serializable
data class Track(
    val id: String,
    val title: String = "",
    val artist: String = "",
    val thumbnail: String = "",
    val duration: String = "",
    @SerialName("duration_seconds") val durationSeconds: Int = 0,
    val source: String? = null,
    val uri: String? = null,
)

// ─────────────── descargas offline (manifiesto compartido) ───────────────

@Serializable
data class OfflineTrackDto(
    val videoId: String,
    val key: String = "",
    val title: String = "",
    val artist: String = "",
    val thumbnail: String = "",
    val durationMs: Int = 0,
    val source: String = "youtube",
)

@Serializable
data class OfflineResponse(val tracks: List<OfflineTrackDto> = emptyList())

@Serializable
data class PlaylistSummary(
    val id: String,
    val title: String = "",
    val count: Int = 0,
    val thumbnail: String = "",
)

@Serializable
data class PlaylistsResponse(val playlists: List<PlaylistSummary> = emptyList())

@Serializable
data class PlaylistDetail(
    val title: String = "",
    val tracks: List<Track> = emptyList(),
    val unavailable: Int = 0,
)

// ─────────────── listas guardadas de la app ("Mis listas") ───────────────

@Serializable
data class AppPlaylistSummary(
    val id: String,
    val name: String = "",
    val count: Int = 0,
)

@Serializable
data class AppPlaylistDetail(
    val id: String = "",
    val name: String = "",
    val tracks: List<Track> = emptyList(),
)

@Serializable
data class RenameRequest(val name: String)

/** Misma identidad que usa el backend (provider:providerId) para direccionar una pista dentro de una lista guardada. */
fun Track.libraryUid(): String {
    if (source == "spotify") {
        val u = uri ?: id
        val providerId = if (u.contains(':')) u.substringAfterLast(':') else u
        return "spotify:$providerId"
    }
    return "ytmusic:$id"
}

@Serializable
data class SearchResponse(val query: String = "", val tracks: List<Track> = emptyList())

// ─────────────── letras ───────────────

@Serializable
data class SyncedLine(val t: Double = 0.0, val text: String = "")

@Serializable
data class LyricsResponse(
    val source: String? = null,
    val synced: List<SyncedLine>? = null,
    val plain: String? = null,
)

// ─────────────── cola en el servidor ───────────────

@Serializable
data class QueueStartRequest(
    val tracks: List<Track>,
    val mode: String = "bag",
    val avoidWindow: Int = 8,
    val startId: String? = null,
)

@Serializable
data class SessionRequest(
    val sessionId: String,
    val reroll: Boolean? = null,
    val track: Track? = null,
    val mode: String? = null,
    val avoidWindow: Int? = null,
)

@Serializable
data class QueueSnapshot(
    val sessionId: String,
    val mode: String = "bag",
    val avoidWindow: Int = 8,
    val current: Track? = null,
    val upNext: Track? = null,
    val remaining: Int = 0,
    val historyCount: Int = 0,
    val total: Int = 0,
    val priorityCount: Int = 0,
    val reshuffles: Int = 0,
)
