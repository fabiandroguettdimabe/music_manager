package cl.dimabe.noir.ui.player

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cl.dimabe.noir.data.net.LyricsResponse
import cl.dimabe.noir.data.net.SyncedLine

private sealed interface LyricsUi {
    data object Loading : LyricsUi
    data object Empty : LyricsUi
    data class Plain(val text: String) : LyricsUi
    data class Synced(val lines: List<SyncedLine>) : LyricsUi
}

@Composable
fun LyricsPanel(
    title: String,
    artist: String,
    durationSec: Int,
    positionMs: Long,
    accent: Color,
    onFetch: suspend (String, String, Int) -> LyricsResponse?,
    modifier: Modifier = Modifier,
) {
    var state by remember { mutableStateOf<LyricsUi>(LyricsUi.Loading) }

    LaunchedEffect(title, artist) {
        state = LyricsUi.Loading
        if (title.isBlank()) {
            state = LyricsUi.Empty
            return@LaunchedEffect
        }
        val res = onFetch(title, artist, durationSec)
        state = when {
            res == null -> LyricsUi.Empty
            !res.synced.isNullOrEmpty() -> LyricsUi.Synced(res.synced!!)
            !res.plain.isNullOrBlank() -> LyricsUi.Plain(res.plain!!)
            else -> LyricsUi.Empty
        }
    }

    Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        when (val s = state) {
            LyricsUi.Loading -> CircularProgressIndicator(color = accent)
            LyricsUi.Empty -> Text(
                "Sin letra disponible para esta canción",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            is LyricsUi.Plain -> Text(
                text = s.text,
                modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(4.dp),
                color = MaterialTheme.colorScheme.onSurface,
                textAlign = TextAlign.Center,
                lineHeight = 26.sp,
            )
            is LyricsUi.Synced -> SyncedLyrics(lines = s.lines, positionMs = positionMs, accent = accent)
        }
    }
}

@Composable
private fun SyncedLyrics(lines: List<SyncedLine>, positionMs: Long, accent: Color) {
    val posSec = positionMs / 1000.0
    val current = remember(lines, posSec.toInt()) {
        lines.indexOfLast { it.t <= posSec }.coerceAtLeast(0)
    }
    val listState = rememberLazyListState()

    LaunchedEffect(current) {
        // Centra la línea actual.
        runCatching { listState.animateScrollToItem(current.coerceAtLeast(0), scrollOffset = -260) }
    }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(vertical = 120.dp),
    ) {
        itemsIndexed(lines) { index, line ->
            val active = index == current
            Text(
                text = line.text.ifBlank { "♪" },
                modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                color = if (active) accent else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.55f),
                fontSize = if (active) 22.sp else 18.sp,
                fontWeight = if (active) FontWeight.Bold else FontWeight.Medium,
                textAlign = TextAlign.Center,
                lineHeight = 28.sp,
            )
        }
    }
}
