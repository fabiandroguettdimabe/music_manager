package cl.dimabe.noir.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Equalizer
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import cl.dimabe.noir.data.net.Track
import cl.dimabe.noir.di.AppContainer
import kotlinx.coroutines.launch
import cl.dimabe.noir.ui.eq.EqualizerScreen
import cl.dimabe.noir.ui.library.LibraryScreen
import cl.dimabe.noir.ui.player.MiniPlayer
import cl.dimabe.noir.ui.player.NowPlayingScreen
import cl.dimabe.noir.ui.search.SearchScreen
import cl.dimabe.noir.ui.settings.SettingsScreen
import cl.dimabe.noir.ui.setup.SetupScreen

private val SPEEDS = listOf(1f, 1.25f, 1.5f, 0.75f)

@Composable
fun NoirRoot(container: AppContainer) {
    LaunchedEffect(Unit) { container.playbackConnection.connect() }
    val baseUrl by container.settings.baseUrl.collectAsStateWithLifecycle(
        initialValue = container.settings.cachedBaseUrl,
    )

    if (baseUrl.isBlank()) {
        SetupScreen(container = container)
    } else {
        HomeScaffold(container = container)
    }
}

@Composable
private fun HomeScaffold(container: AppContainer) {
    var tab by rememberSaveable { mutableStateOf(0) }
    var showNowPlaying by rememberSaveable { mutableStateOf(false) }
    var radioLoading by rememberSaveable { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    val playerState by container.playbackConnection.state.collectAsStateWithLifecycle()
    val favorites by container.favoritesStore.favorites.collectAsStateWithLifecycle()
    val sleepRemaining by container.sleepTimer.remainingMs.collectAsStateWithLifecycle()
    val token by container.settings.token.collectAsStateWithLifecycle(
        initialValue = container.settings.cachedToken,
    )

    val snackbarHostState = remember { SnackbarHostState() }
    // null = sin cuenta / desconocido; true/false = estado real de la sesión de YouTube.
    var ytAuthed by rememberSaveable { mutableStateOf<Boolean?>(null) }

    LaunchedEffect(Unit) { container.favoritesStore.load() }

    // #1: el JWT de Noir expiró (401) → cierra sesión, avisa y lleva a Ajustes (login).
    LaunchedEffect(Unit) {
        container.authEvents.sessionExpired.collect {
            container.settings.clearSession()
            tab = 3
            snackbarHostState.showSnackbar("Tu sesión expiró. Inicia sesión de nuevo.")
        }
    }

    // Historial: registra cada pista que empieza a sonar (más reciente primero).
    LaunchedEffect(playerState.mediaId) {
        val id = playerState.mediaId
        if (playerState.hasMedia && id != null) {
            container.settings.addRecentTrack(
                Track(
                    id = id,
                    title = playerState.title,
                    artist = playerState.artist,
                    thumbnail = playerState.artworkUri ?: "",
                ),
            )
        }
    }

    // #2: comprueba la salud de la conexión a YouTube al abrir Biblioteca (si hay cuenta).
    LaunchedEffect(tab, token) {
        ytAuthed = if (token == null) null
        else if (tab == 0) runCatching { container.repository.status().authenticated }.getOrNull() ?: ytAuthed
        else ytAuthed
    }

    val conn = container.playbackConnection
    val currentMediaId = playerState.mediaId
    val isFavorite = currentMediaId != null && favorites.containsKey(currentMediaId)

    Box(Modifier.fillMaxSize()) {
        Scaffold(
            containerColor = MaterialTheme.colorScheme.background,
            snackbarHost = { SnackbarHost(snackbarHostState) },
            bottomBar = {
                Column {
                    if (playerState.hasMedia) {
                        MiniPlayer(
                            state = playerState,
                            onClick = { showNowPlaying = true },
                            onPlayPause = { conn.playPause() },
                            onNext = { conn.next() },
                        )
                    }
                    NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                        val colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = MaterialTheme.colorScheme.primary,
                            selectedTextColor = MaterialTheme.colorScheme.primary,
                            indicatorColor = MaterialTheme.colorScheme.surfaceVariant,
                        )
                        NavigationBarItem(
                            selected = tab == 0,
                            onClick = { tab = 0 },
                            icon = { Icon(Icons.Filled.LibraryMusic, contentDescription = null) },
                            label = { Text("Biblioteca") },
                            colors = colors,
                        )
                        NavigationBarItem(
                            selected = tab == 1,
                            onClick = { tab = 1 },
                            icon = { Icon(Icons.Filled.Search, contentDescription = null) },
                            label = { Text("Buscar") },
                            colors = colors,
                        )
                        NavigationBarItem(
                            selected = tab == 2,
                            onClick = { tab = 2 },
                            icon = { Icon(Icons.Filled.Equalizer, contentDescription = null) },
                            label = { Text("Ecualizador") },
                            colors = colors,
                        )
                        NavigationBarItem(
                            selected = tab == 3,
                            onClick = { tab = 3 },
                            icon = { Icon(Icons.Filled.Settings, contentDescription = null) },
                            label = { Text("Ajustes") },
                            colors = colors,
                        )
                    }
                }
            },
        ) { padding ->
            Column(Modifier.padding(padding).fillMaxSize()) {
                // Banner de reconexión: sesión de YouTube caída (fuera de Ajustes, donde ya hay botón).
                if (token != null && ytAuthed == false && tab != 3) {
                    YtDisconnectedBanner(onReconnect = { tab = 3 })
                }
                Box(Modifier.fillMaxSize()) {
                    when (tab) {
                        0 -> LibraryScreen()
                        1 -> SearchScreen()
                        2 -> EqualizerScreen(container = container)
                        else -> SettingsScreen(container = container)
                    }
                }
            }
        }

        AnimatedVisibility(
            visible = showNowPlaying,
            enter = slideInVertically(initialOffsetY = { it }),
            exit = slideOutVertically(targetOffsetY = { it }),
        ) {
            NowPlayingScreen(
                state = playerState,
                isFavorite = isFavorite,
                sleepRemainingMs = sleepRemaining,
                onClose = { showNowPlaying = false },
                onPlayPause = { conn.playPause() },
                onNext = { conn.next() },
                onPrev = { conn.previous() },
                onSeek = { conn.seekTo(it) },
                onToggleFavorite = {
                    val id = playerState.mediaId
                    if (!id.isNullOrBlank()) {
                        container.favoritesStore.toggle(
                            Track(
                                id = id,
                                title = playerState.title,
                                artist = playerState.artist,
                                thumbnail = playerState.artworkUri ?: "",
                            ),
                        )
                    }
                },
                onCycleSpeed = {
                    val idx = SPEEDS.indexOfFirst { it == playerState.speed }
                    val next = SPEEDS[(idx + 1).mod(SPEEDS.size)]
                    conn.setSpeed(next)
                },
                onSetSleep = { container.sleepTimer.start(it) },
                onCancelSleep = { container.sleepTimer.cancel() },
                onFetchLyrics = { t, a, d ->
                    runCatching { container.repository.lyrics(t, a, d.takeIf { s -> s > 0 }) }.getOrNull()
                },
                radioLoading = radioLoading,
                onStartRadio = currentMediaId?.let { seedId ->
                    {
                        radioLoading = true
                        scope.launch {
                            try {
                                val tracks = container.repository.radio(seedId)
                                if (tracks.isNotEmpty()) container.playbackStarter.start(tracks, "bag")
                            } catch (_: Throwable) {
                                // silencioso: si radio falla, la reproducción actual sigue igual
                            } finally {
                                radioLoading = false
                            }
                        }
                    }
                },
            )
        }
    }
}

/** Aviso de que la sesión de YouTube Music se cayó, con acceso directo a reconectar. */
@Composable
private fun YtDisconnectedBanner(onReconnect: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.errorContainer) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                Icon(
                    Icons.Filled.CloudOff,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onErrorContainer,
                )
                Spacer(Modifier.width(10.dp))
                Text(
                    "YouTube Music desconectado",
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            TextButton(onClick = onReconnect) { Text("Reconectar") }
        }
    }
}
