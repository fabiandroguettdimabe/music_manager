package cl.dimabe.noir

import android.app.Application
import cl.dimabe.noir.di.AppContainer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

class NoirApp : Application() {

    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)

        // Prime síncrono de la caché (baseUrl/token) para que la primera petición y el
        // DataSource de ExoPlayer ya tengan la URL correcta. Lectura local, rápida.
        runBlocking {
            val base = container.settings.baseUrl.first()
            val token = container.settings.token.first()
            container.settings.updateCache(base, token)
        }

        // Mantiene la caché al día ante cambios posteriores.
        CoroutineScope(SupervisorJob() + Dispatchers.Default).launch {
            combine(container.settings.baseUrl, container.settings.token) { b, t -> b to t }
                .collect { (b, t) -> container.settings.updateCache(b, t) }
        }
    }
}
