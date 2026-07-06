package cl.dimabe.noir.di

/**
 * Estado compartido de la sesión de cola del servidor. La UI lo fija al iniciar una
 * cola (/queue/start); el servicio de reproducción lo lee para pedir /queue/next
 * y /queue/prev cuando avanza la pista (auto-avance o botón de la notificación).
 */
class PlaybackQueue {
    @Volatile
    var sessionId: String? = null

    @Volatile
    var mode: String = "bag"
}
