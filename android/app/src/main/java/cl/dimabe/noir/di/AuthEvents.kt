package cl.dimabe.noir.di

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * Señales globales de autenticación. El interceptor de red (ApiProvider) emite en
 * [sessionExpired] cuando el backend responde 401 habiendo mandado un token: el JWT de
 * Noir (30 días) caducó. La UI lo observa para cerrar sesión y llevar al login, en vez
 * de fallar en silencio.
 */
class AuthEvents {
    private val _sessionExpired = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val sessionExpired: SharedFlow<Unit> = _sessionExpired.asSharedFlow()

    fun notifySessionExpired() {
        _sessionExpired.tryEmit(Unit)
    }
}
