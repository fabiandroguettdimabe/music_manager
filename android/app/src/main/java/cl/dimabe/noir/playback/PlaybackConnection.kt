package cl.dimabe.noir.playback

import android.content.ComponentName
import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Estado del reproductor que consume la UI (Compose). */
data class PlayerUiState(
    val hasMedia: Boolean = false,
    val isPlaying: Boolean = false,
    val isBuffering: Boolean = false,
    val title: String = "",
    val artist: String = "",
    val artworkUri: String? = null,
    val positionMs: Long = 0L,
    val durationMs: Long = 0L,
    val mediaId: String? = null,
    val nextTitle: String? = null,
    val nextArtist: String? = null,
    val speed: Float = 1f,
)

/**
 * Puente entre la UI y PlaybackService vía un MediaController de Media3. Expone el
 * estado como StateFlow y las acciones de transporte. Debe usarse en el hilo principal.
 */
class PlaybackConnection(private val appContext: Context) {

    private var controller: MediaController? = null
    private var pendingQueue: List<MediaItem>? = null

    private val _state = MutableStateFlow(PlayerUiState())
    val state: StateFlow<PlayerUiState> = _state.asStateFlow()

    // El tick de progreso (500ms) solo debe correr MIENTRAS algo suena — si no, es un
    // timer infinito quemando CPU/batería con la app pausada o en 2° plano para nada.
    // Se auto-detiene solo (mira isPlaying) y el listener lo reactiva cuando hace falta.
    private val handler = Handler(Looper.getMainLooper())
    private var tickScheduled = false
    private val progressTick = object : Runnable {
        override fun run() {
            val c = controller
            if (c != null && c.isPlaying) {
                pushState(c)
                handler.postDelayed(this, 500)
            } else {
                tickScheduled = false
            }
        }
    }

    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) {
            pushState(player)
            if (player.isPlaying && !tickScheduled) {
                tickScheduled = true
                handler.post(progressTick)
            }
        }
    }

    fun connect() {
        if (controller != null) return
        val token = SessionToken(appContext, ComponentName(appContext, PlaybackService::class.java))
        val future = MediaController.Builder(appContext, token).buildAsync()
        future.addListener({
            val c = runCatching { future.get() }.getOrNull() ?: return@addListener
            controller = c
            c.addListener(listener)
            pendingQueue?.let { setQueue(it); pendingQueue = null }
            pushState(c)
            if (c.isPlaying && !tickScheduled) {
                tickScheduled = true
                handler.removeCallbacks(progressTick)
                handler.post(progressTick)
            }
        }, ContextCompat.getMainExecutor(appContext))
    }

    private fun pushState(p: Player) {
        val md = p.mediaMetadata
        val hasNext = p.currentMediaItemIndex < p.mediaItemCount - 1
        val nextMd = if (hasNext) p.getMediaItemAt(p.currentMediaItemIndex + 1).mediaMetadata else null
        _state.value = PlayerUiState(
            hasMedia = p.currentMediaItem != null,
            isPlaying = p.isPlaying,
            isBuffering = p.playbackState == Player.STATE_BUFFERING,
            title = md.title?.toString().orEmpty(),
            artist = md.artist?.toString().orEmpty(),
            artworkUri = md.artworkUri?.toString(),
            positionMs = p.currentPosition.coerceAtLeast(0L),
            durationMs = p.duration.let { if (it > 0L) it else 0L },
            mediaId = p.currentMediaItem?.mediaId,
            nextTitle = nextMd?.title?.toString(),
            nextArtist = nextMd?.artist?.toString(),
            speed = p.playbackParameters.speed,
        )
    }

    // ── acciones de transporte ──

    fun setQueue(items: List<MediaItem>) {
        val c = controller
        if (c == null) {
            pendingQueue = items
            return
        }
        if (items.isEmpty()) return
        c.setMediaItems(items)
        c.prepare()
        c.playWhenReady = true
    }

    fun playPause() {
        val c = controller ?: return
        if (c.isPlaying) c.pause() else c.play()
    }

    fun pause() {
        controller?.pause()
    }

    fun setSpeed(speed: Float) {
        controller?.setPlaybackSpeed(speed)
    }

    fun next() {
        controller?.seekToNextMediaItem()
    }

    fun previous() {
        val c = controller ?: return
        if (c.currentPosition > 3_000L) c.seekTo(0L) else c.seekToPreviousMediaItem()
    }

    fun seekTo(ms: Long) {
        controller?.seekTo(ms)
    }

    fun release() {
        handler.removeCallbacks(progressTick)
        controller?.removeListener(listener)
        controller?.release()
        controller = null
    }
}
