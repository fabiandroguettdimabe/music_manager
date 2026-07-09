package cl.dimabe.noir.data.prefs

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import cl.dimabe.noir.data.net.Track
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "noir_prefs")

/**
 * Ajustes locales del dispositivo: URL del backend y sesión (JWT + usuario).
 * Expone Flows para la UI y una caché síncrona (volatile) para el interceptor de
 * red y el DataSource de ExoPlayer, que no pueden suspender.
 */
class SettingsStore(private val context: Context) {

    companion object {
        /** URL por defecto del backend (VPS con HTTPS). Se prefija en la pantalla de inicio. */
        const val DEFAULT_BACKEND_URL = "https://84-247-174-216.sslip.io"

        /** Máximo de búsquedas recientes que se recuerdan. */
        private const val MAX_RECENT = 8

        /** Máximo de pistas en el historial de reproducción. */
        private const val MAX_RECENT_TRACKS = 20

        private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
        private val trackListSerializer = ListSerializer(Track.serializer())
    }

    private object Keys {
        val BASE_URL = stringPreferencesKey("base_url")
        val TOKEN = stringPreferencesKey("token")
        val USER_NAME = stringPreferencesKey("user_name")
        val USER_EMAIL = stringPreferencesKey("user_email")
        val RECENT_SEARCHES = stringPreferencesKey("recent_searches")
        val RECENT_TRACKS = stringPreferencesKey("recent_tracks")
    }

    @Volatile
    var cachedBaseUrl: String = ""
        private set

    @Volatile
    var cachedToken: String? = null
        private set

    val baseUrl: Flow<String> = context.dataStore.data.map { it[Keys.BASE_URL] ?: "" }
    val token: Flow<String?> = context.dataStore.data.map { it[Keys.TOKEN] }
    val userName: Flow<String?> = context.dataStore.data.map { it[Keys.USER_NAME] }
    val userEmail: Flow<String?> = context.dataStore.data.map { it[Keys.USER_EMAIL] }

    fun updateCache(baseUrl: String, token: String?) {
        cachedBaseUrl = baseUrl
        cachedToken = token
    }

    suspend fun setBaseUrl(url: String) {
        val clean = url.trim().trimEnd('/')
        context.dataStore.edit { it[Keys.BASE_URL] = clean }
        cachedBaseUrl = clean
    }

    suspend fun setSession(token: String, name: String?, email: String?) {
        context.dataStore.edit {
            it[Keys.TOKEN] = token
            if (name != null) it[Keys.USER_NAME] = name else it.remove(Keys.USER_NAME)
            if (email != null) it[Keys.USER_EMAIL] = email else it.remove(Keys.USER_EMAIL)
        }
        cachedToken = token
    }

    suspend fun clearSession() {
        context.dataStore.edit {
            it.remove(Keys.TOKEN)
            it.remove(Keys.USER_NAME)
            it.remove(Keys.USER_EMAIL)
        }
        cachedToken = null
    }

    // ── búsquedas recientes (máx. 8, más nueva primero) ──
    val recentSearches: Flow<List<String>> = context.dataStore.data.map { prefs ->
        prefs[Keys.RECENT_SEARCHES]?.split('\n')?.filter { it.isNotBlank() } ?: emptyList()
    }

    suspend fun addRecentSearch(query: String) {
        val clean = query.trim().replace('\n', ' ')
        if (clean.isEmpty()) return
        context.dataStore.edit { prefs ->
            val current = prefs[Keys.RECENT_SEARCHES]?.split('\n')?.filter { it.isNotBlank() } ?: emptyList()
            val next = (listOf(clean) + current.filterNot { it.equals(clean, ignoreCase = true) }).take(MAX_RECENT)
            prefs[Keys.RECENT_SEARCHES] = next.joinToString("\n")
        }
    }

    suspend fun clearRecentSearches() {
        context.dataStore.edit { it.remove(Keys.RECENT_SEARCHES) }
    }

    // ── historial de reproducción (máx. 20, más reciente primero) ──
    val recentTracks: Flow<List<Track>> = context.dataStore.data.map { prefs ->
        prefs[Keys.RECENT_TRACKS]?.let {
            runCatching { json.decodeFromString(trackListSerializer, it) }.getOrNull()
        } ?: emptyList()
    }

    suspend fun addRecentTrack(track: Track) {
        if (track.id.isBlank()) return
        context.dataStore.edit { prefs ->
            val current = prefs[Keys.RECENT_TRACKS]?.let {
                runCatching { json.decodeFromString(trackListSerializer, it) }.getOrNull()
            } ?: emptyList()
            val next = (listOf(track) + current.filterNot { it.id == track.id }).take(MAX_RECENT_TRACKS)
            prefs[Keys.RECENT_TRACKS] = json.encodeToString(trackListSerializer, next)
        }
    }
}
