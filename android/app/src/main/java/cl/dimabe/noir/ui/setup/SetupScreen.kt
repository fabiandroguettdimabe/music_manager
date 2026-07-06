package cl.dimabe.noir.ui.setup

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cl.dimabe.noir.data.prefs.SettingsStore
import cl.dimabe.noir.data.repo.NoirRepository
import cl.dimabe.noir.di.AppContainer
import cl.dimabe.noir.ui.theme.NoirBlack
import cl.dimabe.noir.ui.theme.NoirSurface2
import kotlinx.coroutines.launch

@Composable
fun SetupScreen(container: AppContainer) {
    val scope = rememberCoroutineScope()
    var url by rememberSaveable {
        mutableStateOf(container.settings.cachedBaseUrl.ifBlank { SettingsStore.DEFAULT_BACKEND_URL })
    }
    var testing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val settings = container.settings
    val repo = container.repository

    fun persist(clean: String) = scope.launch { settings.setBaseUrl(clean) }

    fun connect() {
        val clean = url.trim().trimEnd('/')
        if (clean.isBlank()) { error = "Escribe la URL del servidor."; return }
        testing = true
        error = null
        scope.launch {
            settings.updateCache(clean, settings.cachedToken)
            try {
                repo.ping()
                settings.setBaseUrl(clean) // OK → NoirRoot cambia a la pantalla principal
            } catch (t: Throwable) {
                error = "No se pudo conectar: ${NoirRepository.errorMessage(t)}"
            } finally {
                testing = false
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(NoirSurface2, NoirBlack)))
            .systemBarsPadding()
            .padding(28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "NOIR",
            color = MaterialTheme.colorScheme.primary,
            fontWeight = FontWeight.Black,
            fontSize = 56.sp,
        )
        Text(
            text = "Reproductor de barajado real",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(36.dp))

        OutlinedTextField(
            value = url,
            onValueChange = { url = it; error = null },
            label = { Text("URL del servidor") },
            placeholder = { Text("https://84-247-174-216.sslip.io") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = "Ya viene tu servidor por defecto — solo pulsa Conectar. " +
                "Puedes cambiarlo si usas otro backend (tu PC en la red local, etc.).",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 12.sp,
            textAlign = TextAlign.Center,
        )

        if (error != null) {
            Spacer(Modifier.height(16.dp))
            Text(error!!, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center)
        }

        Spacer(Modifier.height(24.dp))
        Button(
            onClick = { connect() },
            enabled = !testing,
            modifier = Modifier.fillMaxWidth().height(52.dp),
        ) {
            if (testing) {
                CircularProgressIndicator(modifier = Modifier.height(22.dp), strokeWidth = 2.dp)
            } else {
                Text("Conectar", fontWeight = FontWeight.Bold)
            }
        }

        if (error != null) {
            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = { persist(url.trim().trimEnd('/')) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Entrar de todas formas")
            }
        }
    }
}
