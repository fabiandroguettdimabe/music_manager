package cl.dimabe.noir.ui.library

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Autorenew
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SmartDisplay
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import cl.dimabe.noir.data.net.AppPlaylistSummary
import cl.dimabe.noir.data.net.PlaylistSummary
import cl.dimabe.noir.ui.components.AlbumArt
import cl.dimabe.noir.ui.theme.NoirRed
import cl.dimabe.noir.ui.theme.NoirRedBright
import cl.dimabe.noir.ui.theme.NoirSurface2

@Composable
fun LibraryScreen(vm: LibraryViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val favorites by vm.favorites.collectAsStateWithLifecycle()

    Box(
        Modifier
            .fillMaxSize()
            .background(
                Brush.radialGradient(
                    colors = listOf(NoirRed.copy(alpha = 0.16f), Color.Transparent),
                    radius = 900f,
                ),
            ),
    ) {
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
                    fontWeight = FontWeight.Black,
                    modifier = Modifier.weight(1f),
                )
                ModeChip(mode = state.mode, onClick = vm::toggleMode)
            }

            SourceTabs(source = state.source, onSelect = vm::switchSource)

            if (state.starting) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = NoirRedBright)
            }

            when {
                state.loading -> CenterBox { CircularProgressIndicator(color = NoirRed) }
                state.error != null -> CenterBox {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(state.error!!, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        TextButton(onClick = vm::load) { Text("Reintentar") }
                        if (state.offlineCount > 0) {
                            TextButton(onClick = vm::playOfflineManifest) {
                                Text("Reproducir descargadas (${state.offlineCount})")
                            }
                        }
                    }
                }
                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 140.dp, top = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    if (state.source == LibrarySource.BIBLIOTECA) {
                        item {
                            LibraryHero(
                                playlistCount = state.playlists.size,
                                trackCount = state.playlists.sumOf { it.count },
                                mode = state.mode,
                            )
                        }
                        item { LikedCard(onClick = vm::playLiked) }
                        if (favorites.isNotEmpty()) {
                            item { FavoritesCard(count = favorites.size, onClick = vm::playFavorites) }
                        }
                        if (!state.authenticated) item { NotConnectedCard() }
                        if (!state.authenticated && state.offlineCount > 0) {
                            item { OfflineFallbackCard(count = state.offlineCount, onClick = vm::playOfflineManifest) }
                        }
                        items(state.playlists, key = { it.id }) { pl ->
                            PlaylistRow(pl = pl, onClick = { vm.playPlaylist(pl.id) })
                        }
                    } else if (state.source == LibrarySource.LISTAS) {
                        if (state.appPlaylists.isEmpty()) item { EmptySourceCard("Aún no guardaste listas propias. Créalas desde la web (\"Mis listas\").") }
                        items(state.appPlaylists, key = { it.id }) { pl ->
                            AppPlaylistRow(
                                pl = pl,
                                onClick = { vm.playAppPlaylist(pl.id) },
                                onRename = { newName -> vm.renamePlaylist(pl.id, newName) },
                                onDelete = { vm.deletePlaylist(pl.id) },
                            )
                        }
                    } else {
                        if (state.source == LibrarySource.SPOTIFY && state.spotifyConnected) {
                            item { LikedCard(onClick = vm::playLiked, label = "Me gusta (Spotify)") }
                        }
                        if (state.source == LibrarySource.SPOTIFY && !state.spotifyConnected) {
                            item { EmptySourceCard("Conecta tu cuenta de Spotify desde la web para ver estas listas.") }
                        }
                        if (state.playlists.isEmpty() && state.source != LibrarySource.SPOTIFY) {
                            item { EmptySourceCard("No hay playlists en esta fuente todavía.") }
                        }
                        items(state.playlists, key = { it.id }) { pl ->
                            PlaylistRow(pl = pl, onClick = { vm.playPlaylist(pl.id) })
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SourceTabs(source: LibrarySource, onSelect: (LibrarySource) -> Unit) {
    val tabs = listOf(
        Triple(LibrarySource.BIBLIOTECA, "YT Music", Icons.Filled.MusicNote),
        Triple(LibrarySource.YOUTUBE, "YouTube", Icons.Filled.SmartDisplay),
        Triple(LibrarySource.SPOTIFY, "Spotify", Icons.Filled.MusicNote),
        Triple(LibrarySource.LISTAS, "Mis listas", Icons.Filled.FolderOpen),
    )
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        for ((src, label, icon) in tabs) {
            val active = source == src
            Surface(
                onClick = { onSelect(src) },
                shape = RoundedCornerShape(50),
                color = if (active) NoirRed else MaterialTheme.colorScheme.surfaceVariant,
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Icon(
                        icon,
                        contentDescription = null,
                        tint = if (active) Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(16.dp),
                    )
                    Text(
                        label,
                        style = MaterialTheme.typography.labelLarge,
                        color = if (active) Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
                        fontWeight = if (active) FontWeight.Bold else FontWeight.Normal,
                    )
                }
            }
        }
    }
}

@Composable
private fun LibraryHero(playlistCount: Int, trackCount: Int, mode: String) {
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surface,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    Brush.horizontalGradient(listOf(NoirSurface2, NoirRed.copy(alpha = 0.85f), NoirRedBright.copy(alpha = 0.55f))),
                )
                .padding(18.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(58.dp)
                    .clip(RoundedCornerShape(18.dp))
                    .background(Color.White.copy(alpha = 0.14f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (mode == "reorden") Icons.Filled.Autorenew else Icons.Filled.Shuffle,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(30.dp),
                )
            }
            Spacer(Modifier.size(14.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    text = if (mode == "reorden") "Reorden continuo" else "Bolsa aleatoria",
                    fontWeight = FontWeight.Black,
                    fontSize = MaterialTheme.typography.titleMedium.fontSize,
                    color = Color.White,
                )
                Text(
                    text = "$playlistCount listas · $trackCount canciones sincronizadas",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xCCFFFFFF),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
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
private fun LikedCard(onClick: () -> Unit, label: String = "Me gusta") {
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
            Icon(Icons.Filled.Favorite, contentDescription = null, tint = Color.White)
            Spacer(Modifier.size(14.dp))
            Column(Modifier.weight(1f)) {
                Text(label, fontWeight = FontWeight.Bold, color = Color.White)
                Text(
                    "Reproduce tus canciones favoritas",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xCCFFFFFF),
                )
            }
            Icon(Icons.Filled.PlayArrow, contentDescription = null, tint = Color.White)
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
            Icon(Icons.Filled.Star, contentDescription = null, tint = Color.White)
            Spacer(Modifier.size(14.dp))
            Column(Modifier.weight(1f)) {
                Text("Favoritos", fontWeight = FontWeight.Bold, color = Color.White)
                Text(
                    "$count guardadas · sincronizadas con la web",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xCCFFFFFF),
                )
            }
            Icon(Icons.Filled.PlayArrow, contentDescription = null, tint = Color.White)
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
private fun OfflineFallbackCard(count: Int, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(Icons.Filled.CloudDownload, contentDescription = null, tint = NoirRedBright)
            Column(Modifier.weight(1f)) {
                Text("Reproducir lo descargado", fontWeight = FontWeight.SemiBold)
                Text(
                    "Sin conexión al servicio online. $count pista(s) cacheadas en el servidor.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Icon(Icons.Filled.PlayArrow, contentDescription = null, tint = NoirRedBright)
        }
    }
}

@Composable
private fun EmptySourceCard(text: String) {
    Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
        Text(
            text = text,
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
private fun AppPlaylistRow(
    pl: AppPlaylistSummary,
    onClick: () -> Unit,
    onRename: (String) -> Unit,
    onDelete: () -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 6.dp, horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(56.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(Brush.horizontalGradient(listOf(NoirSurface2, NoirRed))),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Filled.FolderOpen, contentDescription = null, tint = Color.White)
        }
        Spacer(Modifier.size(12.dp))
        Column(Modifier.weight(1f)) {
            Text(pl.name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (pl.count > 0) {
                Text(
                    "${pl.count} canciones",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Icon(Icons.Filled.PlayArrow, contentDescription = "Reproducir", tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Box {
            IconButton(onClick = { menuOpen = true }) {
                Icon(Icons.Filled.MoreVert, contentDescription = "Más opciones", tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                DropdownMenuItem(text = { Text("Renombrar") }, onClick = { menuOpen = false; renaming = true })
                DropdownMenuItem(text = { Text("Eliminar") }, onClick = { menuOpen = false; confirmDelete = true })
            }
        }
    }

    if (renaming) {
        var text by remember { mutableStateOf(pl.name) }
        AlertDialog(
            onDismissRequest = { renaming = false },
            title = { Text("Renombrar lista") },
            text = {
                OutlinedTextField(value = text, onValueChange = { text = it }, singleLine = true, modifier = Modifier.fillMaxWidth())
            },
            confirmButton = {
                TextButton(onClick = { onRename(text); renaming = false }) { Text("Guardar") }
            },
            dismissButton = { TextButton(onClick = { renaming = false }) { Text("Cancelar") } },
        )
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("¿Eliminar \"${pl.name}\"?") },
            text = { Text("Esta acción no se puede deshacer.") },
            confirmButton = {
                TextButton(onClick = { onDelete(); confirmDelete = false }) { Text("Eliminar", color = NoirRed) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancelar") } },
        )
    }
}

@Composable
private fun CenterBox(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) { content() }
}
