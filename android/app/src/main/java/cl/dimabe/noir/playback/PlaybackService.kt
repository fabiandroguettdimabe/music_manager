package cl.dimabe.noir.playback

import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.media.audiofx.Equalizer
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import cl.dimabe.noir.NoirApp
import cl.dimabe.noir.di.AppContainer
import cl.dimabe.noir.di.EqCapabilities
import cl.dimabe.noir.di.EqSettings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Servicio de reproducción en segundo plano (Media3). Mantiene un "lookahead": en la
 * cola de ExoPlayer siempre hay al menos una pista por delante, que se obtiene del
 * backend (/queue/next). Así el orden lo decide el real-shuffle del servidor, pero la
 * reproducción, el gapless, los controles de la notificación y la pantalla bloqueada
 * son 100% nativos (sin trucos).
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var container: AppContainer
    private lateinit var player: ExoPlayer
    private var session: MediaSession? = null
    private var appending = false
    private var equalizer: Equalizer? = null

    override fun onCreate() {
        super.onCreate()
        container = (application as NoirApp).container

        // Fábrica con cache de descargas: lo bajado suena offline; lo demás, de la red.
        val dataSourceFactory = DefaultDataSource.Factory(this, container.downloads.cacheDataSourceFactory)

        // Sesión de audio propia para poder engancharle el ecualizador nativo.
        val audioSessionId = (getSystemService(Context.AUDIO_SERVICE) as AudioManager).generateAudioSessionId()

        player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(dataSourceFactory))
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .build(),
                /* handleAudioFocus = */ true,
            )
            .setHandleAudioBecomingNoisy(true)
            .build()
        player.setAudioSessionId(audioSessionId)

        player.addListener(object : Player.Listener {
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) = ensureLookahead()
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_READY || playbackState == Player.STATE_ENDED) {
                    ensureLookahead()
                }
            }
        })

        setupEqualizer(audioSessionId)
        session = MediaSession.Builder(this, player).build()
    }

    /** Crea el ecualizador nativo, publica sus capacidades y aplica los ajustes de la UI. */
    private fun setupEqualizer(audioSessionId: Int) {
        try {
            val eq = Equalizer(0, audioSessionId)
            equalizer = eq
            val numBands = eq.numberOfBands.toInt()
            val freqs = (0 until numBands).map { eq.getCenterFreq(it.toShort()) / 1000 } // mHz → Hz
            val range = eq.bandLevelRange // [min, max] en milibelios
            container.audioBus.capabilities.value = EqCapabilities(
                numBands = numBands,
                centerFreqsHz = freqs,
                minMillibel = range[0].toInt(),
                maxMillibel = range[1].toInt(),
            )
            scope.launch { container.audioBus.settings.collect { applyEqualizer(it) } }
        } catch (_: Throwable) {
            // Algunos dispositivos/ROMs no exponen ecualizador: se ignora silenciosamente.
            container.audioBus.capabilities.value = null
        }
    }

    private fun applyEqualizer(s: EqSettings) {
        val eq = equalizer ?: return
        try {
            eq.setEnabled(s.enabled)
            if (s.enabled) {
                s.bandsMillibel.forEachIndexed { i, mb ->
                    if (i < eq.numberOfBands) eq.setBandLevel(i.toShort(), mb.toShort())
                }
            }
        } catch (_: Throwable) {
            // Ignorar fallos puntuales del audiofx.
        }
    }

    /** Si la pista actual es la última de la cola, pide la siguiente al servidor y la añade. */
    private fun ensureLookahead() {
        if (appending) return
        val sid = container.playbackQueue.sessionId ?: return
        val count = player.mediaItemCount
        if (count == 0) return
        if (player.currentMediaItemIndex < count - 1) {
            trimHistory()
            return
        }
        appending = true
        scope.launch {
            try {
                val snap = container.repository.queueNext(sid)
                val next = snap.current
                if (next != null) {
                    player.addMediaItem(MediaItems.of(next, container.offline.playbackUrl(next.id)))
                    // Si nos habíamos quedado sin siguiente y paró, retomamos.
                    if (player.playbackState == Player.STATE_ENDED) {
                        player.seekToNextMediaItem()
                        player.play()
                    }
                }
            } catch (_: Throwable) {
                // best-effort: no rompemos la reproducción actual si el servidor falla
            } finally {
                appending = false
                trimHistory()
            }
        }
    }

    /** Evita que la cola crezca sin límite: conserva ~15 pistas ya sonadas para "anterior". */
    private fun trimHistory() {
        val keepBehind = 15
        val idx = player.currentMediaItemIndex
        if (idx > keepBehind) {
            player.removeMediaItems(0, idx - keepBehind)
        }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Al cerrar la app: si no está reproduciendo, apagamos el servicio.
        if (!player.playWhenReady || player.mediaItemCount == 0) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        runCatching { equalizer?.release() }
        equalizer = null
        session?.let {
            player.release()
            it.release()
        }
        session = null
        scope.cancel()
        super.onDestroy()
    }
}
