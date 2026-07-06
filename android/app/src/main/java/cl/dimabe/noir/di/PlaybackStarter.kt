package cl.dimabe.noir.di

import cl.dimabe.noir.data.net.Track
import cl.dimabe.noir.data.repo.NoirRepository
import cl.dimabe.noir.playback.MediaItems
import cl.dimabe.noir.playback.PlaybackConnection

/**
 * Inicia una cola de reproducción: crea la sesión de real-shuffle en el servidor,
 * guarda el sessionId y carga en el reproductor la pista actual + la siguiente. A
 * partir de ahí, PlaybackService mantiene el resto pidiéndoselo al backend.
 */
class PlaybackStarter(
    private val repo: NoirRepository,
    private val queue: PlaybackQueue,
    private val connection: PlaybackConnection,
) {
    suspend fun start(tracks: List<Track>, mode: String, startId: String? = null) {
        if (tracks.isEmpty()) return
        val snap = repo.queueStart(tracks, mode, startId)
        queue.sessionId = snap.sessionId
        queue.mode = mode
        val current = snap.current ?: tracks.first()
        val items = buildList {
            add(MediaItems.of(current, repo.streamUrl(current.id)))
            snap.upNext?.let { add(MediaItems.of(it, repo.streamUrl(it.id))) }
        }
        connection.setQueue(items)
    }
}
