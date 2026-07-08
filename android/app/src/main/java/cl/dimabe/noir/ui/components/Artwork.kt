package cl.dimabe.noir.ui.components

import android.graphics.drawable.BitmapDrawable
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.palette.graphics.Palette
import cl.dimabe.noir.ui.theme.NoirRed
import coil.ImageLoader
import coil.request.ImageRequest
import coil.request.SuccessResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Extrae un color de acento vivo de la carátula (Palette) y lo anima. Si no hay imagen
 * o el color es demasiado apagado/oscuro, cae al rojo Noir. Se usa para teñir la pantalla
 * de reproducción (fondo, controles) según la portada — como Spotify/Apple Music.
 */
@Composable
fun rememberArtworkAccent(url: String?): State<Color> {
    val context = LocalContext.current
    var target by remember { mutableStateOf(NoirRed) }

    LaunchedEffect(url) {
        target = if (url.isNullOrBlank()) {
            NoirRed
        } else {
            runCatching {
                val loader = ImageLoader(context)
                val req = ImageRequest.Builder(context)
                    .data(url)
                    .allowHardware(false)
                    .size(144)
                    .build()
                val result = loader.execute(req)
                val bmp = (result as? SuccessResult)?.drawable?.let { it as? BitmapDrawable }?.bitmap
                    ?: return@runCatching NoirRed
                withContext(Dispatchers.Default) {
                    val palette = Palette.from(bmp).maximumColorCount(16).generate()
                    val rgb = palette.vibrantSwatch?.rgb
                        ?: palette.lightVibrantSwatch?.rgb
                        ?: palette.dominantSwatch?.rgb
                        ?: palette.mutedSwatch?.rgb
                    if (rgb != null) refine(Color(rgb)) else NoirRed
                }
            }.getOrDefault(NoirRed)
        }
    }

    return animateColorAsState(targetValue = target, animationSpec = tween(700), label = "accent")
}

/**
 * Evita acentos casi negros o CLAROS/pasteles: el acento tiñe el fondo detrás de texto e
 * íconos claros (blancos), así que cualquier color con luminancia media-alta (beige, rosa
 * pálido, celeste, etc.) igual deja el texto ilegible si no se oscurece bastante.
 */
private fun refine(c: Color): Color {
    val l = c.luminance()
    return when {
        l < 0.06f -> lerp(c, NoirRed, 0.6f)
        l > 0.55f -> lerp(c, NoirRed, 0.65f)
        l > 0.35f -> lerp(c, NoirRed, 0.35f)
        else -> c
    }
}

private fun lerp(a: Color, b: Color, t: Float): Color = Color(
    red = a.red + (b.red - a.red) * t,
    green = a.green + (b.green - a.green) * t,
    blue = a.blue + (b.blue - a.blue) * t,
    alpha = 1f,
)
