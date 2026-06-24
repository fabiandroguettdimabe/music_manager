import os
import time
import secrets
from typing import Dict, Any

from fastapi import APIRouter, HTTPException
import requests as req

router = APIRouter()

SPOTIFY_AUTH_BASE = "https://accounts.spotify.com/authorize"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_SCOPES = (
    "streaming user-read-email user-read-private "
    "user-library-read playlist-read-private playlist-read-collaborative "
    "user-read-playback-state user-modify-playback-state"
)

# In-memory CSRF state store (expires after 10 min)
_pending_states: Dict[str, dict] = {}


REQUIRED_SCOPES = {
    "playlist-read-private",
    "playlist-read-collaborative",
    "user-library-read",
    "streaming",
    "user-read-private",
    "user-read-email",
    "user-read-playback-state",
    "user-modify-playback-state",
}


@router.get("/status")
def spotify_status() -> Dict[str, Any]:
    from app.services.spotify import load_token, get_access_token
    data = load_token()
    if not data:
        return {"authenticated": False, "token_exists": False}

    token = get_access_token()
    if not token:
        return {"authenticated": False, "token_exists": True}

    # Check stored scopes to detect stale tokens with incomplete scopes
    stored_scopes = set(data.get("scope", "").split())
    missing_scopes = REQUIRED_SCOPES - stored_scopes
    if missing_scopes:
        print(f"[Spotify] Token missing scopes: {missing_scopes}")

    try:
        resp = req.get(
            "https://api.spotify.com/v1/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=5,
        )
        if resp.ok:
            user = resp.json()
            imgs = user.get("images", [])
            return {
                "authenticated": True,
                "user_name": user.get("display_name", "Usuario"),
                "product": user.get("product", "unknown"),
                "image": imgs[0]["url"] if imgs else "",
                "needs_reauth": len(missing_scopes) > 0,
                "missing_scopes": list(missing_scopes),
            }
    except Exception as e:
        print(f"Spotify status error: {e}")

    return {"authenticated": False, "token_exists": True}


@router.get("/auth-url")
def spotify_auth_url(client_id: str, redirect_uri: str) -> Dict[str, str]:
    state = secrets.token_urlsafe(16)
    _pending_states[state] = {"client_id": client_id, "created_at": time.time()}

    # Clean up states older than 10 minutes
    stale = [k for k, v in _pending_states.items() if time.time() - v["created_at"] > 600]
    for k in stale:
        del _pending_states[k]

    params = "&".join([
        f"client_id={req.utils.quote(client_id)}",
        "response_type=code",
        f"redirect_uri={req.utils.quote(redirect_uri)}",
        f"scope={req.utils.quote(SPOTIFY_SCOPES)}",
        f"state={state}",
    ])
    return {"url": f"{SPOTIFY_AUTH_BASE}?{params}", "state": state}


@router.post("/exchange")
def spotify_exchange(data: dict) -> Dict[str, str]:
    code = data.get("code", "").strip()
    client_id = data.get("client_id", "").strip()
    client_secret = data.get("client_secret", "").strip()
    redirect_uri = data.get("redirect_uri", "").strip()

    if not all([code, client_id, client_secret, redirect_uri]):
        raise HTTPException(status_code=400, detail="Faltan parámetros requeridos")

    resp = req.post(SPOTIFY_TOKEN_URL, data={
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
        "client_secret": client_secret,
    }, timeout=10)

    if not resp.ok:
        err = resp.json()
        raise HTTPException(
            status_code=400,
            detail=err.get("error_description", "Error al intercambiar el código de autorización")
        )

    tok = resp.json()
    from app.services.spotify import save_token
    save_token({
        "_client_id": client_id,
        "_client_secret": client_secret,
        "access_token": tok["access_token"],
        "refresh_token": tok["refresh_token"],
        "expires_at": int(time.time()) + tok.get("expires_in", 3600),
        "scope": tok.get("scope", ""),
    })
    return {"status": "ok"}


@router.get("/token")
def spotify_get_token() -> Dict[str, str]:
    """Returns a valid access token, refreshing if needed. Called by the Web Playback SDK."""
    from app.services.spotify import get_access_token
    token = get_access_token()
    if not token:
        raise HTTPException(status_code=401, detail="No autenticado con Spotify")
    return {"access_token": token}


@router.get("/playlists")
def spotify_playlists() -> Dict[str, Any]:
    from app.services.spotify import spotify_get
    try:
        data = spotify_get("/me/playlists", params={"limit": 50})
        out = []
        for p in data.get("items", []):
            if not p:
                continue
            imgs = p.get("images", [])
            out.append({
                "id": p["id"],
                "title": p.get("name", "Sin título"),
                "count": p.get("tracks", {}).get("total", 0),
                "thumbnail": imgs[0]["url"] if imgs else "",
            })
        return {"playlists": out}
    except Exception as e:
        if "401" in str(e):
            raise HTTPException(status_code=401, detail="Sesión de Spotify expirada")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/liked")
def spotify_liked(limit: int = 500) -> Dict[str, Any]:
    from app.services.spotify import spotify_get
    try:
        tracks, offset = [], 0
        while len(tracks) < limit:
            batch = min(50, limit - len(tracks))
            data = spotify_get("/me/tracks", params={"limit": batch, "offset": offset})
            items = data.get("items", [])
            if not items:
                break
            for item in items:
                t = item.get("track")
                if t and t.get("type") == "track":
                    tracks.append(_fmt(t))
            if len(items) < batch:
                break
            offset += batch
        return {"title": "Canciones que te gustan", "tracks": tracks}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/playlist/{playlist_id}")
def spotify_playlist(playlist_id: str, limit: int = 500) -> Dict[str, Any]:
    from app.services.spotify import spotify_get
    try:
        pl = spotify_get(f"/playlists/{playlist_id}", params={"market": "from_token"})
        title = pl.get("name", "Playlist")
        tracks, offset = [], 0
        while len(tracks) < limit:
            batch = min(100, limit - len(tracks))
            data = spotify_get(
                f"/playlists/{playlist_id}/tracks",
                params={"limit": batch, "offset": offset, "market": "from_token"}
            )
            items = data.get("items", [])
            if not items:
                break
            for item in items:
                t = item.get("track")
                if t and t.get("type") == "track":
                    tracks.append(_fmt(t))
            if len(items) < batch:
                break
            offset += batch
        return {"title": title, "tracks": tracks}
    except Exception as e:
        err = str(e)
        print(f"[Spotify] playlist tracks error: {err}")
        if "403" in err:
            raise HTTPException(status_code=403, detail=err)
        if "401" in err:
            raise HTTPException(status_code=401, detail="Sesión de Spotify expirada. Reconecta tu cuenta.")
        raise HTTPException(status_code=500, detail=err)


@router.post("/logout")
def spotify_logout() -> Dict[str, str]:
    from app.services.spotify import find_token_path
    path = find_token_path()
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except Exception as e:
            print(f"Failed to remove Spotify token: {e}")
    return {"status": "ok"}


def _fmt(t: dict) -> dict:
    artists = ", ".join(a["name"] for a in t.get("artists", []))
    imgs = t.get("album", {}).get("images", [])
    ms = t.get("duration_ms", 0)
    s = ms // 1000
    return {
        "id": t.get("uri", ""),
        "title": t.get("name", "Desconocido"),
        "artist": artists or "Artista Desconocido",
        "thumbnail": imgs[0]["url"] if imgs else "",
        "duration": f"{s // 60}:{s % 60:02d}",
        "duration_seconds": s,
        "uri": t.get("uri", ""),
    }
