package cl.dimabe.noir.ui.library

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import cl.dimabe.noir.NoirApp
import cl.dimabe.noir.data.net.PlaylistSummary
import cl.dimabe.noir.data.net.Track
import cl.dimabe.noir.data.repo.NoirRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class LibraryUiState(
    val loading: Boolean = true,
    val authenticated: Boolean = false,
    val playlists: List<PlaylistSummary> = emptyList(),
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
            try {
                val status = repo.status()
                val pls = if (status.authenticated) {
                    runCatching { repo.playlists() }.getOrDefault(emptyList())
                } else emptyList()
                _state.update {
                    it.copy(loading = false, authenticated = status.authenticated, playlists = pls, error = null)
                }
            } catch (t: Throwable) {
                _state.update { it.copy(loading = false, error = NoirRepository.errorMessage(t)) }
            }
        }
    }

    fun playPlaylist(id: String) = startFrom { repo.playlist(id).tracks }

    fun playLiked() = startFrom { repo.likedSongs().tracks }

    private fun startFrom(fetch: suspend () -> List<Track>) {
        _state.update { it.copy(starting = true, error = null) }
        viewModelScope.launch {
            try {
                starter.start(fetch(), _state.value.mode)
            } catch (t: Throwable) {
                _state.update { it.copy(error = NoirRepository.errorMessage(t)) }
            } finally {
                _state.update { it.copy(starting = false) }
            }
        }
    }
}
