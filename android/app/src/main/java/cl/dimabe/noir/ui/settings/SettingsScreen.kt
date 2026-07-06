package cl.dimabe.noir.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import cl.dimabe.noir.data.repo.NoirRepository
import cl.dimabe.noir.di.AppContainer
import kotlinx.coroutines.launch

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
        Text("Ajustes", style = MaterialTheme.typography.headlineMedium)

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
        SectionTitle("Acerca de")
        Text("Noir · v1.0", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(120.dp))
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
