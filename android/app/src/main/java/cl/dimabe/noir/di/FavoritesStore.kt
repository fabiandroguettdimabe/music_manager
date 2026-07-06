package cl.dimabe.noir.di

import cl.dimabe.noir.data.net.Track
import cl.dimabe.noir.data.repo.NoirRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Favoritos del usuario, sincronizados con el backend (`/api/me/state/favorites`) para
 * compartirlos con la web. Se mantienen como mapa id→pista.
 */
class FavoritesStore(private val repo: NoirRepository) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val _favorites = MutableStateFlow<Map<String, Track>>(emptyMap())
    val favorites: StateFlow<Map<String, Track>> = _favorites.asStateFlow()

    fun load() {
        scope.launch {
            runCatching { repo.getFavorites() }.onSuccess { _favorites.value = it }
        }
    }

    fun isFavorite(id: String?): Boolean = id != null && _favorites.value.containsKey(id)

    fun toggle(track: Track) {
        if (track.id.isBlank()) return
        val map = _favorites.value.toMutableMap()
        if (map.containsKey(track.id)) map.remove(track.id) else map[track.id] = track
        _favorites.value = map
        scope.launch { runCatching { repo.setFavorites(map) } }
    }

    fun list(): List<Track> = _favorites.value.values.toList()
}
