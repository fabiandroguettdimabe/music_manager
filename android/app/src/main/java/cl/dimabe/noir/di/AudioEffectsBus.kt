package cl.dimabe.noir.di

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Capacidades del ecualizador reales del dispositivo (las publica el servicio). */
data class EqCapabilities(
    val numBands: Int,
    val centerFreqsHz: List<Int>,
    val minMillibel: Int,
    val maxMillibel: Int,
)

/** Ajustes deseados del ecualizador (los escribe la UI; los aplica el servicio). */
data class EqSettings(
    val enabled: Boolean = false,
    val bandsMillibel: List<Int> = emptyList(),
    val preset: String? = null,
)

/**
 * Puente entre la UI del ecualizador y el `android.media.audiofx.Equalizer` que vive
 * en el servicio de reproducción (necesita el audioSessionId de ExoPlayer). El servicio
 * publica las capacidades y aplica los ajustes que escribe la UI.
 */
class AudioEffectsBus {
    val capabilities = MutableStateFlow<EqCapabilities?>(null)
    private val _settings = MutableStateFlow(EqSettings())
    val settings: StateFlow<EqSettings> = _settings.asStateFlow()

    fun setEnabled(on: Boolean) {
        _settings.value = _settings.value.copy(enabled = on)
    }

    fun setBand(index: Int, millibel: Int) {
        val caps = capabilities.value
        val n = caps?.numBands ?: _settings.value.bandsMillibel.size
        val bands = _settings.value.bandsMillibel.toMutableList()
        while (bands.size < n) bands.add(0)
        if (index in bands.indices) {
            bands[index] = if (caps != null) millibel.coerceIn(caps.minMillibel, caps.maxMillibel) else millibel
        }
        _settings.value = _settings.value.copy(bandsMillibel = bands, preset = "Personalizado", enabled = true)
    }

    fun applyPreset(name: String) {
        val caps = capabilities.value ?: return
        val gains = PRESETS[name] ?: return
        val bands = mapPresetToBands(gains, caps.numBands)
            .map { (it * 100).toInt().coerceIn(caps.minMillibel, caps.maxMillibel) }
        _settings.value = EqSettings(enabled = true, bandsMillibel = bands, preset = name)
    }

    companion object {
        // Ganancias por banda (dB) para una referencia de 5 bandas; se interpolan al nº real.
        val PRESETS: LinkedHashMap<String, List<Int>> = linkedMapOf(
            "Plano" to listOf(0, 0, 0, 0, 0),
            "Graves+" to listOf(6, 4, 1, 0, 1),
            "Voz" to listOf(-2, 0, 3, 4, 2),
            "Rock" to listOf(4, 2, -1, 2, 4),
            "Reggaetón" to listOf(6, 5, 0, 1, 3),
            "Agudos+" to listOf(0, 0, 1, 3, 5),
        )

        fun mapPresetToBands(gains: List<Int>, n: Int): List<Double> {
            if (n <= 0) return emptyList()
            if (n == gains.size) return gains.map { it.toDouble() }
            if (n == 1) return listOf(gains.first().toDouble())
            return (0 until n).map { i ->
                val pos = i.toDouble() * (gains.size - 1) / (n - 1)
                val lo = pos.toInt().coerceIn(0, gains.size - 1)
                val hi = (lo + 1).coerceAtMost(gains.size - 1)
                val frac = pos - lo
                gains[lo] * (1 - frac) + gains[hi] * frac
            }
        }
    }
}
