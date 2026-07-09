package cl.dimabe.noir.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cl.dimabe.noir.data.net.AppPlaylistSummary
import cl.dimabe.noir.data.net.Track
import cl.dimabe.noir.data.repo.NoirRepository
import cl.dimabe.noir.di.AppContainer
import kotlinx.coroutines.launch

/**
 * Hoja inferior para añadir [track] a una lista de la app o crear una lista nueva con ella.
 * Usa los endpoints ya existentes del backend (POST library/playlists[/:id/tracks]).
 * Llama a [onResult] con un mensaje legible (éxito o error) y se cierra vía [onDismiss].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddToPlaylistSheet(
    track: Track,
    container: AppContainer,
    onDismiss: () -> Unit,
    onResult: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val repo = container.repository

    var playlists by remember { mutableStateOf<List<AppPlaylistSummary>?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var creating by remember { mutableStateOf(false) }
    var newName by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        playlists = runCatching { repo.appPlaylists() }
            .onFailure { loadError = NoirRepository.errorMessage(it) }
            .getOrNull()
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp)) {
            Text("Añadir a lista", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text(
                track.title,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.size(12.dp))

            when {
                loadError != null -> Text(loadError!!, color = MaterialTheme.colorScheme.error)
                playlists == null -> Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.size(10.dp))
                    Text("Cargando tus listas…")
                }
                else -> LazyColumn(Modifier.heightIn(max = 320.dp)) {
                    items(playlists!!, key = { it.id }) { pl ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable(enabled = !busy) {
                                    busy = true
                                    scope.launch {
                                        val msg = runCatching {
                                            repo.addTrackToAppPlaylist(pl.id, track); "Añadida a «${pl.name}»"
                                        }.getOrElse { NoirRepository.errorMessage(it) }
                                        onResult(msg)
                                        onDismiss()
                                    }
                                }
                                .padding(vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.AutoMirrored.Filled.QueueMusic, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                            Spacer(Modifier.size(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(pl.name, fontWeight = FontWeight.SemiBold)
                                Text(
                                    "${pl.count} pista(s)",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.size(12.dp))

            if (creating) {
                OutlinedTextField(
                    value = newName,
                    onValueChange = { newName = it },
                    label = { Text("Nombre de la lista") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.size(8.dp))
                Button(
                    enabled = !busy && newName.isNotBlank(),
                    onClick = {
                        busy = true
                        val name = newName.trim()
                        scope.launch {
                            val msg = runCatching {
                                repo.createAppPlaylist(name, listOf(track)); "Lista «$name» creada"
                            }.getOrElse { NoirRepository.errorMessage(it) }
                            onResult(msg)
                            onDismiss()
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Filled.Check, contentDescription = null)
                    Spacer(Modifier.size(8.dp))
                    Text("Crear con esta canción")
                }
            } else {
                OutlinedButton(onClick = { creating = true }, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Filled.Add, contentDescription = null)
                    Spacer(Modifier.size(8.dp))
                    Text("Crear lista nueva")
                }
            }
        }
    }
}
