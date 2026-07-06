package cl.dimabe.noir.ui.search

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import cl.dimabe.noir.NoirApp
import cl.dimabe.noir.data.net.Track
import cl.dimabe.noir.data.repo.NoirRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SearchUiState(
    val query: String = "",
    val loading: Boolean = false,
    val results: List<Track> = emptyList(),
    val error: String? = null,
    val searched: Boolean = false,
)

class SearchViewModel(app: Application) : AndroidViewModel(app) {
    private val container = (app as NoirApp).container
    private val repo = container.repository
    private val starter = container.playbackStarter

    private val _state = MutableStateFlow(SearchUiState())
    val state: StateFlow<SearchUiState> = _state.asStateFlow()

    fun onQueryChange(q: String) = _state.update { it.copy(query = q) }

    fun search() {
        val q = _state.value.query.trim()
        if (q.isEmpty()) return
        _state.update { it.copy(loading = true, error = null, searched = true) }
        viewModelScope.launch {
            try {
                val results = repo.search(q)
                _state.update { it.copy(loading = false, results = results) }
            } catch (t: Throwable) {
                _state.update { it.copy(loading = false, error = NoirRepository.errorMessage(t), results = emptyList()) }
            }
        }
    }

    /** Reproduce desde la pista tocada, usando todos los resultados como cola (bolsa). */
    fun play(track: Track) {
        val results = _state.value.results
        viewModelScope.launch {
            runCatching { starter.start(results.ifEmpty { listOf(track) }, mode = "bag", startId = track.id) }
                .onFailure { t -> _state.update { it.copy(error = NoirRepository.errorMessage(t)) } }
        }
    }
}
