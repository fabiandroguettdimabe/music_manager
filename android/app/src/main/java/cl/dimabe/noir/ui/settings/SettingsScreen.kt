package cl.dimabe.noir.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import cl.dimabe.noir.data.repo.NoirRepository
import cl.dimabe.noir.di.AppContainer
import cl.dimabe.noir.di.DownloadProgress
import cl.dimabe.noir.ui.theme.NoirRed
import cl.dimabe.noir.ui.theme.NoirSurface2
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun SettingsScreen(container: AppContainer) {
    val scope = rememberCoroutineScope()
    val settings = container.settings
    val repo = container.repository

    val userName by settings.userName.collectAsStateWithLifecycle(initialValue = null)
    val userEmail by settings.userEmail.collectAsStateWithLifecycle(initialValue = null)
    val token by settings.token.collectAsStateWithLifecycle(initialValue = settings.cachedToken)
    val baseUrl by settings.baseUrl.collectAsStateWithLifecycle(initialValue = settings.cachedBaseUrl)

    var urlField by remember(baseUrl) { mutableStateOf(baseUrl) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var msg by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Ajustes", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Black)

        SectionTitle("Servidor")
        OutlinedTextField(
            value = urlField,
            onValueChange = { urlField = it },
            label = { Text("URL del backend") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            modifier = Modifier.fillMaxWidth(),
        )
        Button(
            onClick = {
                scope.launch {
                    settings.setBaseUrl(urlField.trim().trimEnd('/'))
                    msg = "URL guardada."
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Guardar URL") }

        SectionTitle("Cuenta")
        if (token != null) {
            Text(
                "Sesión iniciada: ${userName ?: userEmail ?: "usuario"}",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedButton(
                onClick = { scope.launch { settings.clearSession(); msg = "Sesión cerrada." } },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Cerrar sesión") }
        } else {
            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                label = { Text("Email") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Contraseña") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = {
                    busy = true
                    msg = null
                    scope.launch {
                        try {
                            val r = repo.login(email, password)
                            settings.setSession(r.token, r.user.name, r.user.email)
                            msg = "Sesión iniciada."
                        } catch (t: Throwable) {
                            msg = NoirRepository.errorMessage(t)
                        } finally {
                            busy = false
                        }
                    }
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (busy) CircularProgressIndicator(Modifier.height(20.dp), strokeWidth = 2.dp)
                else Text("Iniciar sesión")
            }
            Text(
                "Opcional. Sin cuenta usas la conexión compartida del servidor. Con cuenta, tus " +
                    "favoritos y ajustes se sincronizan con la web.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        if (msg != null) {
            Text(msg!!, color = MaterialTheme.colorScheme.primary)
        }

        Spacer(Modifier.height(8.dp))
        SectionTitle("Descargas offline")
        OfflineDownloadsSection(container)

        Spacer(Modifier.height(8.dp))
        SectionTitle("Acerca de")
        Text("Noir · v1.0", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(120.dp))
    }
}

/**
 * Manifiesto de descargas compartido con la web (`/api/offline`). "Sincronizar" encola en
 * Media3 el audio que falte (baja en 2° plano, con notificación de progreso propia); no
 * vuelve a bajar lo que ya está. Mientras corre, esta tarjeta muestra el avance real
 * (leído del índice de Media3 cada 2 s) en vez de solo el conteo del manifiesto.
 */
@Composable
private fun OfflineDownloadsSection(container: AppContainer) {
    val scope = rememberCoroutineScope()
    var manifestCount by remember { mutableStateOf<Int?>(null) }
    var progress by remember { mutableStateOf(DownloadProgress()) }
    var busy by remember { mutableStateOf(false) }
    var msg by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        manifestCount = runCatching { container.repository.offlineList().size }.getOrNull()
        while (true) {
            progress = withContext(Dispatchers.IO) { container.offline.snapshotProgress() }
            delay(2000)
        }
    }

    Surface(
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(Brush.horizontalGradient(listOf(NoirSurface2, NoirRed.copy(alpha = 0.55f))))
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.CloudDownload, contentDescription = null, tint = Color.White)
                Spacer(Modifier.width(8.dp))
                Text(
                    manifestCount?.let { "$it pista(s) en tu manifiesto" } ?: "Cargando manifiesto…",
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                )
            }
            if (progress.total > 0) {
                Text(
                    "${progress.completed}/${progress.total} descargadas" +
                        (if (progress.downloading > 0) " · bajando ${progress.downloading} (${progress.currentPercent}%)" else "") +
                        (if (progress.failed > 0) " · ${progress.failed} fallidas" else ""),
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xCCFFFFFF),
                )
                LinearProgressIndicator(
                    progress = { if (progress.total > 0) progress.completed / progress.total.toFloat() else 0f },
                    modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)),
                    color = Color.White,
                    trackColor = Color.White.copy(alpha = 0.25f),
                )
            }
        }
    }

    Button(
        onClick = {
            busy = true
            msg = null
            scope.launch {
                try {
                    container.offline.syncFromManifest()
                    msg = "Descargas encoladas. El progreso de arriba se actualiza solo."
                } catch (t: Throwable) {
                    msg = NoirRepository.errorMessage(t)
                } finally {
                    busy = false
                }
            }
        },
        enabled = !busy,
        modifier = Modifier.fillMaxWidth(),
    ) {
        if (busy) CircularProgressIndicator(Modifier.height(20.dp), strokeWidth = 2.dp)
        else Text("Sincronizar descargas")
    }
    OutlinedButton(
        onClick = { container.offline.removeAll(); msg = "Descargas locales eliminadas." },
        modifier = Modifier.fillMaxWidth(),
    ) { Text("Borrar descargas locales") }
    if (msg != null) {
        Text(msg!!, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text = text.uppercase(),
        style = MaterialTheme.typography.labelLarge,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(top = 8.dp),
    )
}
