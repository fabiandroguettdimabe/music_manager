package cl.dimabe.noir.ui.eq

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import cl.dimabe.noir.di.AppContainer
import cl.dimabe.noir.di.AudioEffectsBus
import cl.dimabe.noir.ui.theme.NoirRed

@Composable
fun EqualizerScreen(container: AppContainer) {
    val caps by container.audioBus.capabilities.collectAsStateWithLifecycle()
    val settings by container.audioBus.settings.collectAsStateWithLifecycle()
    val bus = container.audioBus

    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
    ) {
        Text("Ecualizador", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Black)
        Spacer(Modifier.height(12.dp))

        val c = caps
        if (c == null) {
            Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                Text(
                    "Empieza a reproducir algo y vuelve aquí: el ecualizador se engancha al audio en curso " +
                        "de tu dispositivo.",
                    modifier = Modifier.padding(16.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            return@Column
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Activar ecualizador", modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
            Switch(
                checked = settings.enabled,
                onCheckedChange = { bus.setEnabled(it) },
                colors = SwitchDefaults.colors(checkedThumbColor = Color.White, checkedTrackColor = NoirRed),
            )
        }

        Spacer(Modifier.height(12.dp))
        Text("PRESETS", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(8.dp))
        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            AudioEffectsBus.PRESETS.keys.forEach { name ->
                FilterChip(
                    selected = settings.preset == name,
                    onClick = { bus.applyPreset(name) },
                    label = { Text(name) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = NoirRed,
                        selectedLabelColor = Color.White,
                    ),
                )
            }
        }

        Spacer(Modifier.height(20.dp))
        c.centerFreqsHz.forEachIndexed { i, hz ->
            val mb = settings.bandsMillibel.getOrElse(i) { 0 }
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 2.dp)) {
                Text(freqLabel(hz), modifier = Modifier.width(52.dp), style = MaterialTheme.typography.bodySmall)
                Slider(
                    value = mb.toFloat().coerceIn(c.minMillibel.toFloat(), c.maxMillibel.toFloat()),
                    valueRange = c.minMillibel.toFloat()..c.maxMillibel.toFloat(),
                    onValueChange = { bus.setBand(i, it.toInt()) },
                    enabled = settings.enabled,
                    colors = SliderDefaults.colors(
                        thumbColor = MaterialTheme.colorScheme.primary,
                        activeTrackColor = MaterialTheme.colorScheme.primary,
                    ),
                    modifier = Modifier.weight(1f),
                )
                Text(
                    gainLabel(mb),
                    modifier = Modifier.width(56.dp),
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.End,
                )
            }
        }
        Spacer(Modifier.height(120.dp))
    }
}

private fun freqLabel(hz: Int): String {
    if (hz < 1000) return "$hz"
    val k = hz / 1000.0
    return if (k == k.toInt().toDouble()) "${k.toInt()}k" else "%.1fk".format(k)
}

private fun gainLabel(millibel: Int): String = "%+d dB".format(millibel / 100)
