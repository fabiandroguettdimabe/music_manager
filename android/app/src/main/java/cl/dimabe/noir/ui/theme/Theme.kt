package cl.dimabe.noir.ui.theme

import android.app.Activity
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val NoirColors = darkColorScheme(
    primary = NoirRed,
    onPrimary = Color.White,
    secondary = NoirRedBright,
    onSecondary = Color.White,
    background = NoirBlack,
    onBackground = NoirOnSurface,
    surface = NoirSurface,
    onSurface = NoirOnSurface,
    surfaceVariant = NoirSurface2,
    onSurfaceVariant = NoirMuted,
    error = NoirRedBright,
    outline = NoirMuted,
)

@Composable
fun NoirTheme(content: @Composable () -> Unit) {
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = false
        }
    }
    MaterialTheme(
        colorScheme = NoirColors,
        typography = NoirTypography,
        content = content,
    )
}
