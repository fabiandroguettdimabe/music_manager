import os
import json
import time
import requests as req

SPOTIFY_TOKEN_FILE = "spotify_token.json"
SPOTIFY_API = "https://api.spotify.com/v1"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"


def find_token_path() -> str | None:
    for p in [SPOTIFY_TOKEN_FILE, f"../{SPOTIFY_TOKEN_FILE}"]:
        if os.path.exists(p):
            return p
    return None


def load_token() -> dict | None:
    path = find_token_path()
    if not path:
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_token(data: dict):
    with open(SPOTIFY_TOKEN_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4)


def get_access_token() -> str | None:
    """Returns a valid access token, refreshing automatically if needed."""
    data = load_token()
    if not data:
        return None

    now = time.time()
    if now >= data.get("expires_at", 0) - 60:
        try:
            resp = req.post(SPOTIFY_TOKEN_URL, data={
                "grant_type": "refresh_token",
                "refresh_token": data["refresh_token"],
                "client_id": data["_client_id"],
                "client_secret": data["_client_secret"],
            }, timeout=10)
            resp.raise_for_status()
            new_tok = resp.json()
            data["access_token"] = new_tok["access_token"]
            data["expires_at"] = int(now) + new_tok.get("expires_in", 3600)
            if "refresh_token" in new_tok:
                data["refresh_token"] = new_tok["refresh_token"]
            save_token(data)
        except Exception as e:
            print(f"Spotify token refresh failed: {e}")
            return None

    return data.get("access_token")


def spotify_get(path: str, params: dict = None) -> dict:
    token = get_access_token()
    if not token:
        raise Exception("Spotify: no autenticado")
    resp = req.get(
        f"{SPOTIFY_API}{path}",
        headers={"Authorization": f"Bearer {token}"},
        params=params,
        timeout=10,
    )
    if not resp.ok:
        try:
            body = resp.json()
            msg = body.get("error", {}).get("message", resp.reason)
        except Exception:
            msg = resp.reason
        raise Exception(f"Spotify {resp.status_code}: {msg}")
    return resp.json()
