package cl.dimabe.noir.ui.library

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Autorenew
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import cl.dimabe.noir.data.net.PlaylistSummary
import cl.dimabe.noir.ui.components.AlbumArt
import cl.dimabe.noir.ui.theme.NoirRed
import cl.dimabe.noir.ui.theme.NoirSurface2

@Composable
fun LibraryScreen(vm: LibraryViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val favorites by vm.favorites.collectAsStateWithLifecycle()

    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "Biblioteca",
                style = MaterialTheme.typography.headlineMedium,
                modifier = Modifier.weight(1f),
            )
            ModeChip(mode = state.mode, onClick = vm::toggleMode)
        }

        if (state.starting) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
        }

        when {
            state.loading -> CenterBox { CircularProgressIndicator(color = NoirRed) }
            state.error != null -> CenterBox {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(state.error!!, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    TextButton(onClick = vm::load) { Text("Reintentar") }
                }
            }
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(
                    start = 16.dp, end = 16.dp, bottom = 140.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item { LikedCard(onClick = vm::playLiked) }
                if (favorites.isNotEmpty()) {
                    item { FavoritesCard(count = favorites.size, onClick = vm::playFavorites) }
                }
                if (!state.authenticated) item { NotConnectedCard() }
                items(state.playlists, key = { it.id }) { pl ->
                    PlaylistRow(pl = pl, onClick = { vm.playPlaylist(pl.id) })
                }
            }
        }
    }
}

@Composable
private fun ModeChip(mode: String, onClick: () -> Unit) {
    val reorden = mode == "reorden"
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(50),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(
                imageVector = if (reorden) Icons.Filled.Autorenew else Icons.Filled.Shuffle,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(18.dp),
            )
            Text(
                text = if (reorden) "Reorden" else "Bolsa",
                style = MaterialTheme.typography.labelLarge,
            )
        }
    }
}

@Composable
private fun LikedCard(onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Brush.horizontalGradient(listOf(NoirRed, NoirSurface2)))
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Favorite, contentDescription = null, tint = androidx.compose.ui.graphics.Color.White)
            Spacer(Modifier.size(14.dp))
            Column(Modifier.weight(1f)) {
                Text("Me gusta", fontWeight = FontWeight.Bold, color = androidx.compose.ui.graphics.Color.White)
                Text(
                    "Reproduce tus canciones favoritas",
                    style = MaterialTheme.typography.bodySmall,
                    color = androidx.compose.ui.graphics.Color(0xCCFFFFFF),
                )
            }
            Icon(Icons.Filled.PlayArrow, contentDescription = null, tint = androidx.compose.ui.graphics.Color.White)
        }
    }
}

@Composable
private fun FavoritesCard(count: Int, onClick: () -> Unit) {
    Surface(onClick = onClick, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Brush.horizontalGradient(listOf(NoirSurface2, NoirRed)))
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Star, contentDescription = null, tint = androidx.compose.ui.graphics.Color.White)
            Spacer(Modifier.size(14.dp))
            Column(Modifier.weight(1f)) {
                Text("Favoritos", fontWeight = FontWeight.Bold, color = androidx.compose.ui.graphics.Color.White)
                Text(
                    "$count guardadas · sincronizadas con la web",
                    style = MaterialTheme.typography.bodySmall,
                    color = androidx.compose.ui.graphics.Color(0xCCFFFFFF),
                )
            }
            Icon(Icons.Filled.PlayArrow, contentDescription = null, tint = androidx.compose.ui.graphics.Color.White)
        }
    }
}

@Composable
private fun NotConnectedCard() {
    Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
        Text(
            text = "Conecta YouTube Music desde la web para ver tus playlists aquí. La búsqueda y " +
                "\"Me gusta\" pueden requerir esa conexión en el servidor.",
            modifier = Modifier.padding(16.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun PlaylistRow(pl: PlaylistSummary, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AlbumArt(url = pl.thumbnail, modifier = Modifier.size(56.dp), corner = 10.dp)
        Spacer(Modifier.size(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                text = pl.title,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (pl.count > 0) {
                Text(
                    text = "${pl.count} canciones",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Icon(
            Icons.Filled.PlayArrow,
            contentDescription = "Reproducir",
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun CenterBox(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) { content() }
}
