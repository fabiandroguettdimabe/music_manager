package cl.dimabe.noir.ui.settings

import android.annotation.SuppressLint
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView

// Login de Google que termina en music.youtube.com; de ahí sacamos la cookie de sesión.
private const val LOGIN_URL =
    "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F"

// UA de Chrome Android REAL (sin el token "; wv" del WebView). Sin esto Google suele
// bloquear el login embebido con "este navegador o app puede no ser seguro".
private const val CHROME_UA =
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/122.0.0.0 Mobile Safari/537.36"

// Mismo filtro que el backend/extensión: solo estas (+ __Secure-*). Los cientos de ST-*
// revientan el parser de YT Music, por eso se descartan.
private val RELEVANT = setOf(
    "SID", "HSID", "SSID", "APISID", "SAPISID", "LOGIN_INFO", "SIDCC", "YSC",
    "VISITOR_INFO1_LIVE", "VISITOR_PRIVACY_METADATA", "PREF", "CONSENT", "NID",
)
private val AUTH_KEYS = listOf("SAPISID", "__Secure-3PAPISID", "SID", "__Secure-1PSID", "__Secure-3PSID")

private fun isRelevant(name: String) = name in RELEVANT || name.startsWith("__Secure-")

/**
 * Junta las cookies de los dominios de Google y YouTube (CookieManager sí devuelve las
 * HttpOnly, a diferencia de document.cookie), las filtra y arma el header `Cookie`.
 * Devuelve null si aún no hay sesión iniciada (falta alguna auth key o LOGIN_INFO).
 */
private fun collectSessionCookie(): String? {
    val cm = CookieManager.getInstance()
    val merged = LinkedHashMap<String, String>()
    for (url in listOf("https://music.youtube.com", "https://www.youtube.com", "https://accounts.google.com")) {
        val raw = cm.getCookie(url) ?: continue
        for (part in raw.split(";")) {
            val eq = part.indexOf('=')
            if (eq <= 0) continue
            val name = part.substring(0, eq).trim()
            val value = part.substring(eq + 1).trim()
            if (isRelevant(name) && !merged.containsKey(name)) merged[name] = value
        }
    }
    val hasSession = AUTH_KEYS.any { merged.containsKey(it) } && merged.containsKey("LOGIN_INFO")
    if (!hasSession) return null
    return merged.entries.joinToString("; ") { "${it.key}=${it.value}" }
}

/**
 * Overlay a pantalla completa: el usuario inicia sesión en Google (2FA/CAPTCHA incluidos,
 * en su propia IP). Cuando detectamos la sesión de YouTube, [onCaptured] recibe el header
 * `Cookie` listo para /api/save-auth. [onCancel] cierra sin capturar.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun YtMusicLoginWebView(
    onCaptured: (String) -> Unit,
    onCancel: () -> Unit,
) {
    // Evita capturar dos veces si onPageFinished se dispara en varias redirecciones.
    val captured = remember { booleanArrayOf(false) }

    BackHandler(onBack = onCancel)

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "Conectar YouTube Music",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
                IconButton(onClick = onCancel) {
                    Icon(Icons.Filled.Close, contentDescription = "Cerrar")
                }
            }

            Box(Modifier.fillMaxSize()) {
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = { ctx ->
                        CookieManager.getInstance().apply {
                            setAcceptCookie(true)
                        }
                        WebView(ctx).apply {
                            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                            settings.javaScriptEnabled = true
                            settings.domStorageEnabled = true
                            settings.databaseEnabled = true
                            settings.userAgentString = CHROME_UA
                            webViewClient = object : WebViewClient() {
                                override fun onPageFinished(view: WebView?, url: String?) {
                                    CookieManager.getInstance().flush()
                                    if (captured[0]) return
                                    if (url != null && url.contains("music.youtube.com")) {
                                        val cookie = collectSessionCookie()
                                        if (cookie != null) {
                                            captured[0] = true
                                            onCaptured(cookie)
                                        }
                                    }
                                }
                            }
                            loadUrl(LOGIN_URL)
                        }
                    },
                )
            }
        }
    }
}
