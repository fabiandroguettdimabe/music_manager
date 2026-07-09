package cl.dimabe.noir.di

import android.content.Context
import cl.dimabe.noir.data.net.ApiProvider
import cl.dimabe.noir.data.prefs.SettingsStore
import cl.dimabe.noir.data.repo.NoirRepository
import cl.dimabe.noir.playback.PlaybackConnection

/** Inyección de dependencias manual (sin Hilt): una sola instancia por proceso. */
class AppContainer(context: Context) {
    private val appContext = context.applicationContext

    val settings = SettingsStore(appContext)
    val authEvents = AuthEvents()
    val apiProvider = ApiProvider(settings, authEvents)
    val repository = NoirRepository(apiProvider, settings)
    val playbackQueue = PlaybackQueue()

    // El servicio lo lee para publicar capacidades del EQ y aplicar ajustes (no lazy).
    val audioBus = AudioEffectsBus()

    // Descargas offline (Media3): cache compartida con el player + puente con /api/offline.
    val downloads by lazy { Downloads(appContext) }
    val offline by lazy { OfflineManager(appContext, repository, downloads) }

    // Se conecta a PlaybackService (MediaController) la primera vez que se usa.
    val playbackConnection by lazy { PlaybackConnection(appContext) }

    val playbackStarter by lazy { PlaybackStarter(repository, playbackQueue, playbackConnection) }

    val favoritesStore by lazy { FavoritesStore(repository) }

    val sleepTimer by lazy { SleepTimer(onExpire = { playbackConnection.pause() }) }
}
