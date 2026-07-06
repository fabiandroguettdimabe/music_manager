package cl.dimabe.noir.data.net

import cl.dimabe.noir.data.prefs.SettingsStore
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
class ApiProvider(private val settings: SettingsStore) {

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
                val builder = chain.request().newBuilder()
                settings.cachedToken?.takeIf { it.isNotBlank() }?.let {
                    builder.header("Authorization", "Bearer $it")
                }
                chain.proceed(builder.build())
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
