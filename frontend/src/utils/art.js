// Sube la resolución de una carátula reescribiendo la URL cuando el proveedor lo
// permite. Google sirve el tamaño pedido en servidor (no es un upscale del cliente),
// así que la imagen es realmente más nítida. Para el resto de fuentes devuelve la URL
// tal cual. Úsalo solo en las vistas grandes (reproductor, Now Playing, fondo); en las
// listas pequeñas conviene la miniatura original para ahorrar ancho de banda.
export function hiResArt(url, size = 600) {
  if (!url || typeof url !== 'string') return url;

  // YouTube Music / avatares de Google: lh3.googleusercontent.com, *.ggpht.com.
  // El bloque final "=w###-h###-..." o "=s###-..." define el tamaño.
  if (url.includes('googleusercontent.com') || url.includes('ggpht.com')) {
    if (/=(w\d+-h\d+|s\d+)/.test(url)) {
      return url.replace(/=(w\d+-h\d+|s\d+)(-[^=]*)?$/, `=w${size}-h${size}-l90-rj`);
    }
    return `${url}=w${size}-h${size}-l90-rj`;
  }

  // Miniaturas de vídeo de YouTube (i.ytimg.com / img.youtube.com). hqdefault (480×360)
  // existe siempre; maxresdefault puede dar 404, por eso no se usa.
  if (url.includes('ytimg.com/vi/') || url.includes('img.youtube.com/vi/')) {
    // Descarta el query firmado (sqp/rs): apunta al hqdefault limpio.
    return url.replace(/\/(default|mqdefault|hqdefault|sddefault|maxresdefault)\.jpg.*$/i, '/hqdefault.jpg');
  }

  return url;
}
