package cl.dimabe.noir.di

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Temporizador de apagado: pausa la reproducción tras N minutos. */
class SleepTimer(private val onExpire: () -> Unit) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var job: Job? = null

    private val _remainingMs = MutableStateFlow(0L)
    val remainingMs: StateFlow<Long> = _remainingMs.asStateFlow()

    fun start(minutes: Int) {
        cancel()
        var left = minutes * 60_000L
        _remainingMs.value = left
        job = scope.launch {
            while (left > 0) {
                delay(1000)
                left -= 1000
                _remainingMs.value = left
            }
            onExpire()
        }
    }

    fun cancel() {
        job?.cancel()
        job = null
        _remainingMs.value = 0L
    }
}
