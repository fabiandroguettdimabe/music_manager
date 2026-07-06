package cl.dimabe.noir.data.prefs

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

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
    }

    private object Keys {
        val BASE_URL = stringPreferencesKey("base_url")
        val TOKEN = stringPreferencesKey("token")
        val USER_NAME = stringPreferencesKey("user_name")
        val USER_EMAIL = stringPreferencesKey("user_email")
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
}
