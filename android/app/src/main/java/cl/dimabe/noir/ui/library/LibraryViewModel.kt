package cl.dimabe.noir.ui.library

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import cl.dimabe.noir.NoirApp
import cl.dimabe.noir.data.net.AppPlaylistSummary
import cl.dimabe.noir.data.net.PlaylistSummary
import cl.dimabe.noir.data.net.Track
import cl.dimabe.noir.data.repo.NoirRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** De dónde vienen las playlists mostradas — igual que las pestañas YT/SP/Listas de la web. */
enum class LibrarySource { BIBLIOTECA, YOUTUBE, SPOTIFY, LISTAS }

data class LibraryUiState(
    val loading: Boolean = true,
    val authenticated: Boolean = false,
    val spotifyConnected: Boolean = false,
    val source: LibrarySource = LibrarySource.BIBLIOTECA,
    val playlists: List<PlaylistSummary> = emptyList(),
    val appPlaylists: List<AppPlaylistSummary> = emptyList(),
    // "Lo que subimos al VPS": manifiesto offline. Fallback cuando lo online no responde.
    val offlineCount: Int = 0,
    val error: String? = null,
    val starting: Boolean = false,
    val mode: String = "bag", // "bag" = bolsa real | "reorden" = reorden continuo
)

class LibraryViewModel(app: Application) : AndroidViewModel(app) {
    private val container = (app as NoirApp).container
    private val repo = container.repository
    private val starter = container.playbackStarter

    private val _state = MutableStateFlow(LibraryUiState())
    val state: StateFlow<LibraryUiState> = _state.asStateFlow()

    val favorites: StateFlow<Map<String, Track>> = container.favoritesStore.favorites

    // uid (uri de Spotify u id de YouTube) → videoId ya resuelto, desde el manifiesto offline
    // compartido con la web. Así se puede reproducir cualquier pista de Spotify sin el SDK
    // nativo (que Android no tiene): se toca la versión de YouTube ya emparejada.
    private var resolvedByKey: Map<String, String> = emptyMap()
    private var resolvedLoaded = false

    init {
        load()
        container.favoritesStore.load()
    }

    fun playFavorites() = startFrom { container.favoritesStore.list() }

    fun toggleMode() = _state.update {
        it.copy(mode = if (it.mode == "bag") "reorden" else "bag")
    }

    fun load() {
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            // "Lo que subimos al VPS": lo cargamos siempre para poder recurrir a ello.
            val offline = runCatching { repo.offlineList() }.getOrDefault(emptyList())
            try {
                val status = repo.status()
                val pls = if (status.authenticated) {
                    runCatching { repo.playlists() }.getOrDefault(emptyList())
                } else emptyList()
                val spStatus = runCatching { repo.spotifyStatus() }.getOrNull()
                _state.update {
                    it.copy(
                        loading = false,
                        authenticated = status.authenticated,
                        spotifyConnected = spStatus?.authenticated == true,
                        playlists = pls,
                        offlineCount = offline.size,
                        error = null,
                    )
                }
            } catch (t: Throwable) {
                // Lo online falló del todo → deja disponible el fallback offline en vez de solo error.
                _state.update {
                    it.copy(loading = false, error = NoirRepository.errorMessage(t), offlineCount = offline.size)
                }
            }
        }
    }

    /** Reproduce el manifiesto offline (lo cacheado en el VPS): fallback sin conexión al servicio. */
    fun playOfflineManifest() = startFrom {
        repo.offlineList().map { o ->
            Track(
                id = o.videoId,
                title = o.title,
                artist = o.artist,
                thumbnail = o.thumbnail,
                durationSeconds = o.durationMs / 1000,
                source = "youtube",
            )
        }
    }

    /** Cambia de pestaña (Biblioteca/YT/Spotify/Mis listas) y carga esa fuente si hace falta. */
    fun switchSource(src: LibrarySource) {
        if (_state.value.source == src) return
        _state.update { it.copy(source = src, loading = true, error = null) }
        viewModelScope.launch {
            try {
                when (src) {
                    LibrarySource.BIBLIOTECA -> load()
                    LibrarySource.YOUTUBE -> {
                        val pls = runCatching { repo.youtubePlaylists() }.getOrDefault(emptyList())
                        _state.update { it.copy(loading = false, playlists = pls) }
                    }
                    LibrarySource.SPOTIFY -> {
                        val pls = runCatching { repo.spotifyPlaylists() }.getOrDefault(emptyList())
                        _state.update { it.copy(loading = false, playlists = pls) }
                    }
                    LibrarySource.LISTAS -> {
                        val pls = runCatching { repo.appPlaylists() }.getOrDefault(emptyList())
                        _state.update { it.copy(loading = false, appPlaylists = pls) }
                    }
                }
            } catch (t: Throwable) {
                _state.update { it.copy(loading = false, error = NoirRepository.errorMessage(t)) }
            }
        }
    }

    private fun reloadAppPlaylists() = viewModelScope.launch {
        val pls = runCatching { repo.appPlaylists() }.getOrDefault(emptyList())
        _state.update { it.copy(appPlaylists = pls) }
    }

    fun renamePlaylist(id: String, name: String) {
        if (name.isBlank()) return
        viewModelScope.launch {
            runCatching { repo.renameAppPlaylist(id, name.trim()) }
                .onFailure { _state.update { s -> s.copy(error = NoirRepository.errorMessage(it)) } }
            reloadAppPlaylists()
        }
    }

    fun deletePlaylist(id: String) {
        viewModelScope.launch {
            runCatching { repo.deleteAppPlaylist(id) }
                .onFailure { _state.update { s -> s.copy(error = NoirRepository.errorMessage(it)) } }
            reloadAppPlaylists()
        }
    }

    fun playPlaylist(id: String) {
        when (_state.value.source) {
            LibrarySource.YOUTUBE -> startFrom { resolveAll(repo.youtubePlaylist(id).tracks) }
            LibrarySource.SPOTIFY -> startFrom { resolveAll(repo.spotifyPlaylist(id).tracks, forceSpotify = true) }
            else -> startFrom { repo.playlist(id).tracks }
        }
    }

    fun playAppPlaylist(id: String) = startFrom { resolveAll(repo.appPlaylist(id).tracks) }

    fun playLiked() = startFrom {
        if (_state.value.source == LibrarySource.SPOTIFY) resolveAll(repo.spotifyLiked().tracks, forceSpotify = true)
        else repo.likedSongs().tracks
    }

    /**
     * Pistas de Spotify (o de "Mis listas" con origen mixto) no traen un videoId de YouTube
     * reproducible directo: las cambia por su equivalente ya emparejado en el manifiesto
     * offline (mismo mecanismo que usa la web para tocar lo que viene de Spotify). Lo que no
     * tiene match conocido se descarta en vez de romper la reproducción.
     */
    private suspend fun resolveAll(tracks: List<Track>, forceSpotify: Boolean = false): List<Track> {
        ensureResolvedMap()
        return tracks.mapNotNull { t ->
            val isSpotify = forceSpotify || t.source == "spotify"
            if (!isSpotify) return@mapNotNull t
            val key = t.uri ?: t.id
            val videoId = resolvedByKey[key] ?: return@mapNotNull null
            t.copy(id = videoId, source = "youtube")
        }
    }

    private suspend fun ensureResolvedMap() {
        if (resolvedLoaded) return
        resolvedByKey = runCatching { repo.offlineList() }
            .getOrDefault(emptyList())
            .filter { it.key.isNotBlank() }
            .associate { it.key to it.videoId }
        resolvedLoaded = true
    }

    private fun startFrom(fetch: suspend () -> List<Track>) {
        _state.update { it.copy(starting = true, error = null) }
        viewModelScope.launch {
            try {
                val tracks = fetch()
                if (tracks.isEmpty()) {
                    _state.update { it.copy(error = "Sin pistas reproducibles (¿faltan por sincronizar el manifiesto offline?)") }
                    return@launch
                }
                starter.start(tracks, _state.value.mode)
            } catch (t: Throwable) {
                _state.update { it.copy(error = NoirRepository.errorMessage(t)) }
            } finally {
                _state.update { it.copy(starting = false) }
            }
        }
    }
}
