package cl.dimabe.noir.data.net

import cl.dimabe.noir.data.prefs.SettingsStore
import cl.dimabe.noir.di.AuthEvents
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import java.util.concurrent.TimeUnit

/**
 * Construye (y cachea) el cliente Retrofit para la URL de backend actual. Cuando el
 * usuario cambia la URL en Ajustes, el siguiente `api()` reconstruye el cliente.
 * El token JWT se inyecta por interceptor leyendo la caché síncrona de SettingsStore.
 */
class ApiProvider(
    private val settings: SettingsStore,
    private val authEvents: AuthEvents,
) {

    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
    }

    private var cachedBase: String? = null
    private var cachedApi: NoirApi? = null

    val jsonCodec: Json get() = json

    @Synchronized
    fun api(): NoirApi {
        val base = settings.cachedBaseUrl
        require(base.isNotBlank()) { "Configura la URL del servidor primero." }
        val normalized = base.trimEnd('/') + "/api/"
        cachedApi?.let { if (cachedBase == normalized) return it }

        val client = OkHttpClient.Builder()
            .addInterceptor { chain ->
                val token = settings.cachedToken?.takeIf { it.isNotBlank() }
                val builder = chain.request().newBuilder()
                token?.let { builder.header("Authorization", "Bearer $it") }
                val response = chain.proceed(builder.build())
                // 401 con token presente = JWT de Noir expirado/inválido → avisa a la UI.
                if (response.code == 401 && token != null) authEvents.notifySessionExpired()
                response
            }
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .callTimeout(60, TimeUnit.SECONDS)
            .build()

        val retrofit = Retrofit.Builder()
            .baseUrl(normalized)
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()

        return retrofit.create(NoirApi::class.java).also {
            cachedApi = it
            cachedBase = normalized
        }
    }
}
