import os
import json
from ytmusicapi import YTMusic

_yt_client = None
_yt_client_mtime = None

def find_oauth_path() -> str | None:
    """Finds the oauth.json file in CWD or parent directory. Returns path or None."""
    for p in ["oauth.json", "../oauth.json"]:
        if os.path.exists(p):
            return p
    return None

def get_ytmusic_client() -> YTMusic:
    """Returns a cached YTMusic client, rebuilding only when oauth.json changes."""
    global _yt_client, _yt_client_mtime

    auth_path = find_oauth_path()
    if auth_path:
        try:
            current_mtime = os.path.getmtime(auth_path)
            if _yt_client is not None and _yt_client_mtime == current_mtime:
                return _yt_client

            with open(auth_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            client_id = data.get("_client_id")
            client_secret = data.get("_client_secret")
            user_id = data.get("_user")

            from ytmusicapi.auth.oauth.credentials import OAuthCredentials
            if client_id and client_secret:
                credentials = OAuthCredentials(client_id, client_secret)
                _yt_client = YTMusic(auth_path, oauth_credentials=credentials, user=user_id)
            else:
                _yt_client = YTMusic(auth_path, user=user_id)

            _yt_client_mtime = current_mtime
            return _yt_client
        except Exception as e:
            print(f"Error loading oauth.json, falling back to unauthenticated client: {e}")
            _yt_client = YTMusic()
            _yt_client_mtime = None
    else:
        # No auth file — if we were previously authenticated, invalidate cache
        if _yt_client_mtime is not None or _yt_client is None:
            _yt_client = YTMusic()
            _yt_client_mtime = None

    return _yt_client
