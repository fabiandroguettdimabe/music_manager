package cl.dimabe.noir.ui.search

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import cl.dimabe.noir.NoirApp
import cl.dimabe.noir.data.net.Track
import cl.dimabe.noir.data.repo.NoirRepository
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SearchUiState(
    val query: String = "",
    val loading: Boolean = false,
    val results: List<Track> = emptyList(),
    val error: String? = null,
    val searched: Boolean = false,
)

private const val DEBOUNCE_MS = 350L
private const val MIN_CHARS = 2

class SearchViewModel(app: Application) : AndroidViewModel(app) {
    private val container = (app as NoirApp).container
    private val repo = container.repository
    private val starter = container.playbackStarter

    private val _state = MutableStateFlow(SearchUiState())
    val state: StateFlow<SearchUiState> = _state.asStateFlow()

    /** Búsquedas recientes persistidas; se muestran cuando el campo está vacío. */
    val recent: StateFlow<List<String>> = container.settings.recentSearches
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    private var searchJob: Job? = null

    /** Cada tecla: agenda una búsqueda con debounce (buscar-mientras-escribes). */
    fun onQueryChange(q: String) {
        _state.update { it.copy(query = q) }
        searchJob?.cancel()
        val t = q.trim()
        if (t.length < MIN_CHARS) {
            if (t.isEmpty()) _state.update { it.copy(results = emptyList(), searched = false, error = null) }
            return
        }
        searchJob = viewModelScope.launch {
            delay(DEBOUNCE_MS)
            runSearch(t)
        }
    }

    /** Búsqueda inmediata (botón lupa / tecla Enter). */
    fun search() {
        val q = _state.value.query.trim()
        if (q.isEmpty()) return
        searchJob?.cancel()
        searchJob = viewModelScope.launch { runSearch(q) }
    }

    fun useRecent(q: String) {
        _state.update { it.copy(query = q) }
        search()
    }

    fun clearRecent() {
        viewModelScope.launch { container.settings.clearRecentSearches() }
    }

    private suspend fun runSearch(q: String) {
        _state.update { it.copy(loading = true, error = null, searched = true) }
        try {
            val results = repo.search(q)
            _state.update { it.copy(loading = false, results = results) }
            container.settings.addRecentSearch(q)
        } catch (t: Throwable) {
            _state.update { it.copy(loading = false, error = NoirRepository.errorMessage(t), results = emptyList()) }
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
