package cl.dimabe.noir.playback

import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import cl.dimabe.noir.data.net.Track

/** Construye un MediaItem de Media3 a partir de una pista + la URL de streaming. */
object MediaItems {
    fun of(track: Track, streamUrl: String): MediaItem {
        val metadata = MediaMetadata.Builder()
            .setTitle(track.title.ifBlank { "Sin título" })
            .setArtist(track.artist)
            .apply { if (track.thumbnail.isNotBlank()) setArtworkUri(Uri.parse(track.thumbnail)) }
            .build()
        return MediaItem.Builder()
            .setMediaId(track.id)
            .setUri(streamUrl)
            .setMediaMetadata(metadata)
            .build()
    }
}
