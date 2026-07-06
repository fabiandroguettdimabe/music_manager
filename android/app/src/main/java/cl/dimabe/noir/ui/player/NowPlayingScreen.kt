package cl.dimabe.noir.ui.player

import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bedtime
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Lyrics
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.QueueMusic
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cl.dimabe.noir.data.net.LyricsResponse
import cl.dimabe.noir.playback.PlayerUiState
import cl.dimabe.noir.ui.components.AlbumArt
import cl.dimabe.noir.ui.components.formatMs
import cl.dimabe.noir.ui.components.rememberArtworkAccent
import cl.dimabe.noir.ui.theme.NoirBlack

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun NowPlayingScreen(
    state: PlayerUiState,
    isFavorite: Boolean,
    sleepRemainingMs: Long,
    onClose: () -> Unit,
    onPlayPause: () -> Unit,
    onNext: () -> Unit,
    onPrev: () -> Unit,
    onSeek: (Long) -> Unit,
    onToggleFavorite: () -> Unit,
    onCycleSpeed: () -> Unit,
    onSetSleep: (Int) -> Unit,
    onCancelSleep: () -> Unit,
    onFetchLyrics: suspend (String, String, Int) -> LyricsResponse?,
) {
    BackHandler { onClose() }

    val accent by rememberArtworkAccent(state.artworkUri)
    var showLyrics by remember { mutableStateOf(false) }
    var dragging by remember { mutableStateOf(false) }
    var dragValue by remember { mutableFloatStateOf(0f) }
    val dur = state.durationMs.coerceAtLeast(0L)
    val maxRange = if (dur > 0L) dur.toFloat() else 1f
    val posValue = (if (dragging) dragValue else state.positionMs.toFloat()).coerceIn(0f, maxRange)

    Box(Modifier.fillMaxSize().background(NoirBlack)) {
        // Fondo: carátula desenfocada + degradado del color de acento.
        if (!state.artworkUri.isNullOrBlank()) {
            AlbumArt(
                url = state.artworkUri,
                corner = 0.dp,
                modifier = Modifier
                    .fillMaxSize()
                    .then(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Modifier.blur(38.dp) else Modifier),
            )
        }
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        listOf(accent.copy(alpha = 0.60f), NoirBlack.copy(alpha = 0.86f), NoirBlack),
                    ),
                ),
        )

        Column(
            modifier = Modifier.fillMaxSize().padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Barra superior
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 30.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onClose) {
                    Icon(Icons.Filled.KeyboardArrowDown, contentDescription = "Cerrar", modifier = Modifier.size(30.dp))
                }
                Text(
                    text = if (showLyrics) "LETRA" else "REPRODUCIENDO",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    letterSpacing = 2.sp,
                    modifier = Modifier.weight(1f),
                    textAlign = TextAlign.Center,
                )
                IconButton(onClick = { showLyrics = !showLyrics }) {
                    Icon(
                        Icons.Filled.Lyrics,
                        contentDescription = "Letra",
                        tint = if (showLyrics) accent else MaterialTheme.colorScheme.onSurface,
                    )
                }
                IconButton(onClick = onToggleFavorite) {
                    Icon(
                        imageVector = if (isFavorite) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                        contentDescription = "Favorito",
                        tint = if (isFavorite) accent else MaterialTheme.colorScheme.onSurface,
                    )
                }
            }

            Spacer(Modifier.height(14.dp))
            // Zona principal: carátula o letra.
            Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                if (showLyrics) {
                    LyricsPanel(
                        title = state.title,
                        artist = state.artist,
                        durationSec = (dur / 1000L).toInt(),
                        positionMs = state.positionMs,
                        accent = accent,
                        onFetch = onFetchLyrics,
                    )
                } else {
                    AlbumArt(
                        url = state.artworkUri,
                        modifier = Modifier.fillMaxWidth().aspectRatio(1f),
                        corner = 20.dp,
                    )
                }
            }

            Spacer(Modifier.height(14.dp))
            Text(
                text = state.title.ifBlank { "—" },
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                modifier = Modifier.fillMaxWidth().basicMarquee(),
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = state.artist,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )

            Spacer(Modifier.height(16.dp))
            Slider(
                value = posValue,
                valueRange = 0f..maxRange,
                onValueChange = { dragging = true; dragValue = it },
                onValueChangeFinished = { onSeek(dragValue.toLong()); dragging = false },
                colors = SliderDefaults.colors(thumbColor = accent, activeTrackColor = accent),
            )
            Row(Modifier.fillMaxWidth()) {
                Text(formatMs(posValue.toLong()), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.weight(1f))
                Text(formatMs(dur), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onPrev, modifier = Modifier.size(58.dp)) {
                    Icon(Icons.Filled.SkipPrevious, contentDescription = "Anterior", modifier = Modifier.size(38.dp))
                }
                Spacer(Modifier.size(18.dp))
                Surface(onClick = onPlayPause, shape = CircleShape, color = accent, modifier = Modifier.size(74.dp)) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = if (state.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                            contentDescription = "Reproducir/Pausar",
                            tint = Color.White,
                            modifier = Modifier.size(38.dp),
                        )
                    }
                }
                Spacer(Modifier.size(18.dp))
                IconButton(onClick = onNext, modifier = Modifier.size(58.dp)) {
                    Icon(Icons.Filled.SkipNext, contentDescription = "Siguiente", modifier = Modifier.size(38.dp))
                }
            }

            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Chip(icon = Icons.Filled.Speed, label = speedLabel(state.speed), active = state.speed != 1f, accent = accent, onClick = onCycleSpeed)
                SleepChip(sleepRemainingMs = sleepRemainingMs, accent = accent, onSetSleep = onSetSleep, onCancelSleep = onCancelSleep)
            }

            Spacer(Modifier.height(10.dp))
            if (!state.nextTitle.isNullOrBlank()) {
                Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.7f), modifier = Modifier.fillMaxWidth()) {
                    Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.QueueMusic, contentDescription = null, tint = accent)
                        Spacer(Modifier.size(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text("A CONTINUACIÓN", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, letterSpacing = 1.sp)
                            Text(
                                text = buildString {
                                    append(state.nextTitle)
                                    if (!state.nextArtist.isNullOrBlank()) append(" · ${state.nextArtist}")
                                },
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

private fun speedLabel(speed: Float): String =
    if (speed == speed.toInt().toFloat()) "${speed.toInt()}x" else "${speed}x"

@Composable
private fun Chip(icon: ImageVector, label: String, active: Boolean, accent: Color, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(50),
        color = if (active) accent else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.7f),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(icon, contentDescription = null, tint = if (active) Color.White else MaterialTheme.colorScheme.onSurface, modifier = Modifier.size(18.dp))
            Text(label, color = if (active) Color.White else MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
private fun SleepChip(sleepRemainingMs: Long, accent: Color, onSetSleep: (Int) -> Unit, onCancelSleep: () -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val active = sleepRemainingMs > 0L
    Box {
        Chip(
            icon = Icons.Filled.Bedtime,
            label = if (active) formatMs(sleepRemainingMs) else "Dormir",
            active = active,
            accent = accent,
            onClick = { expanded = true },
        )
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            listOf(5, 10, 15, 30, 45, 60).forEach { m ->
                DropdownMenuItem(text = { Text("$m minutos") }, onClick = { onSetSleep(m); expanded = false })
            }
            if (active) {
                DropdownMenuItem(text = { Text("Cancelar") }, onClick = { onCancelSleep(); expanded = false })
            }
        }
    }
}
