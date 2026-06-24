from fastapi import APIRouter, HTTPException
from typing import Dict, Any

from app.services.ytmusic import get_ytmusic_client, find_oauth_path
from ytmusicapi import YTMusic

router = APIRouter()

@router.get("/playlists")
def get_playlists() -> Dict[str, Any]:
    """Fetches user library playlists."""
    auth_path = find_oauth_path()
    if not auth_path:
        raise HTTPException(
            status_code=401, 
            detail="Autenticación requerida para ver playlists de biblioteca."
        )
    try:
        yt = get_ytmusic_client()
        playlists = yt.get_library_playlists(limit=100)
        if not playlists:
            raise HTTPException(
                status_code=401,
                detail="No se encontraron playlists. Tu sesión puede haber expirado. Re-importa las cabeceras del navegador."
            )
        out = []
        for p in playlists:
            thumbnail = ""
            if p.get("thumbnails"):
                thumbnail = p["thumbnails"][-1]["url"]
            out.append({
                "id": p.get("playlistId"),
                "title": p.get("title", "Sin título"),
                "count": p.get("count", 0),
                "thumbnail": thumbnail
            })
        return {"playlists": out}
    except HTTPException:
        raise
    except Exception as e:
        err_msg = str(e)
        if "Sign in" in err_msg:
            raise HTTPException(status_code=401, detail="Sesión expirada. Re-importa las cabeceras del navegador.")
        raise HTTPException(status_code=500, detail=f"Error al obtener playlists: {err_msg}")


@router.get("/liked-songs")
def get_liked_songs(limit: int = 5000) -> Dict[str, Any]:
    """Fetches liked songs from user account."""
    auth_path = find_oauth_path()
    if not auth_path:
        raise HTTPException(
            status_code=401, 
            detail="Autenticación requerida para obtener 'Canciones que te gustan'."
        )
    try:
        yt = get_ytmusic_client()
        data = yt.get_liked_songs(limit=limit)
        tracks = []
        for t in data.get("tracks", []):
            vid = t.get("videoId")
            if not vid:
                continue
            artist = t["artists"][0]["name"] if t.get("artists") else "Artista Desconocido"
            thumbnail = ""
            if t.get("thumbnails"):
                thumbnail = t["thumbnails"][-1]["url"]
            tracks.append({
                "id": vid,
                "title": t.get("title", "Canción Desconocida"),
                "artist": artist,
                "thumbnail": thumbnail,
                "duration": t.get("duration", "?"),
                "duration_seconds": t.get("duration_seconds", 0)
            })
        return {
            "title": "Canciones que te gustan",
            "tracks": tracks
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al obtener canciones gustadas: {str(e)}")


@router.get("/playlist/{playlist_id}")
def get_playlist(playlist_id: str, limit: int = 5000) -> Dict[str, Any]:
    """Fetches tracks of a specific playlist."""
    try:
        yt = get_ytmusic_client()
        pl = yt.get_playlist(playlist_id, limit=limit)
        tracks = []
        for t in pl.get("tracks", []):
            vid = t.get("videoId")
            if not vid:
                continue
            artist = t["artists"][0]["name"] if t.get("artists") else "Artista Desconocido"
            thumbnail = ""
            if t.get("thumbnails"):
                thumbnail = t["thumbnails"][-1]["url"]
            tracks.append({
                "id": vid,
                "title": t.get("title", "Canción Desconocida"),
                "artist": artist,
                "thumbnail": thumbnail,
                "duration": t.get("duration", "?"),
                "duration_seconds": t.get("duration_seconds", 0)
            })
            
        return {
            "title": pl.get("title", "Playlist"),
            "tracks": tracks
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al obtener playlist: {str(e)}")
