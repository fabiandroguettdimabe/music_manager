import os
import json
import shutil
from fastapi import APIRouter, HTTPException, Body
from typing import Dict, Any

from app.services.ytmusic import get_ytmusic_client, find_oauth_path

router = APIRouter()


def _copy_to_fallback(filepath: str):
    """Copy oauth.json to parent directory as fallback path."""
    try:
        if os.path.exists("../main.py") or os.path.exists("../static"):
            shutil.copy2(filepath, "../oauth.json")
    except Exception:
        pass

@router.get("/status")
def get_status() -> Dict[str, Any]:
    """Returns the authentication status of the server."""
    auth_path = find_oauth_path()
    if not auth_path:
        return {"authenticated": False, "oauth_exists": False, "user_name": None}
    
    try:
        yt = get_ytmusic_client()
        # Trigger an API call that requires authentication to verify session
        yt.get_liked_songs(limit=1)
        
        # User details can sometimes be found in session config
        # Not fully reliable without a direct "me" endpoint, but usually works
        user_name = None
        if hasattr(yt, "session_config"):
            user_name = yt.session_config.get("name")
            
        return {"authenticated": True, "oauth_exists": True, "user_name": user_name}
    except Exception as e:
        # Expected error if session is expired
        err_msg = str(e)
        if "Sign in" in err_msg:
            return {"authenticated": False, "oauth_exists": True, "user_name": "Sesión expirada"}
        # Some other error
        print(f"Status check error: {e}")
        return {"authenticated": False, "oauth_exists": True, "user_name": None}

@router.post("/save-auth")
def save_auth(data: dict = Body(...)) -> Dict[str, str]:
    """Saves the oauth.json credential content."""
    try:
        auth_content = data.get("content")
        if not auth_content:
            raise HTTPException(status_code=400, detail="Contenido de autenticación vacío")
            
        is_json = False
        auth_data = None
        if isinstance(auth_content, str):
            try:
                auth_data = json.loads(auth_content)
                is_json = True
            except json.JSONDecodeError:
                is_json = False
        else:
            auth_data = auth_content
            is_json = True

        # Save to current directory as oauth.json
        filepath = "oauth.json"
        if is_json:
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(auth_data, f, indent=4)
        else:
            try:
                import ytmusicapi
                ytmusicapi.setup(filepath=filepath, headers_raw=auth_content)
            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"No se pudieron procesar las cabeceras del navegador: {str(e)}"
                )
            
        # Verify the saved client works
        try:
            from ytmusicapi import YTMusic
            yt = YTMusic(filepath)
            yt.get_library_playlists(limit=1)
            
            _copy_to_fallback(filepath)
        except Exception as e:
            if os.path.exists(filepath):
                os.remove(filepath)
            raise HTTPException(
                status_code=400, 
                detail=f"Las credenciales no son válidas para YouTube Music: {str(e)}"
            )
            
        return {"status": "ok", "message": "Auth configuration saved."}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/logout")
def logout() -> Dict[str, str]:
    """Deletes oauth.json effectively logging the user out."""
    for p in ["oauth.json", "../oauth.json"]:
        if os.path.exists(p):
            try:
                os.remove(p)
            except Exception as e:
                print(f"Failed to remove {p}: {e}")
    return {"status": "ok", "message": "Logged out."}

from pydantic import BaseModel

class OAuthInitRequest(BaseModel):
    client_id: str
    client_secret: str

class OAuthVerifyRequest(BaseModel):
    client_id: str
    client_secret: str
    device_code: str
    brand_account: str = None

@router.post("/oauth/init")
def oauth_init(req: OAuthInitRequest):
    from ytmusicapi.auth.oauth.credentials import OAuthCredentials
    try:
        credentials = OAuthCredentials(req.client_id, req.client_secret)
        code = credentials.get_code()
        return code
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/oauth/verify")
def oauth_verify(req: OAuthVerifyRequest):
    from ytmusicapi.auth.oauth.credentials import OAuthCredentials
    from ytmusicapi.auth.oauth.token import RefreshingToken
    try:
        credentials = OAuthCredentials(req.client_id, req.client_secret)
        raw_token = credentials.token_from_code(req.device_code)
        
        # We need to construct the RefreshingToken and save it
        ref_token = RefreshingToken(
            credentials=credentials,
            access_token=raw_token["access_token"],
            refresh_token=raw_token["refresh_token"],
            scope=raw_token["scope"],
            token_type=raw_token["token_type"],
            expires_in=raw_token.get("refresh_token_expires_in", raw_token["expires_in"])
        )
        ref_token.update(raw_token)
        
        # Save to oauth.json
        filepath = "oauth.json"
        
        token_dict = ref_token.as_dict()
        token_dict["_client_id"] = req.client_id
        token_dict["_client_secret"] = req.client_secret
        if req.brand_account and req.brand_account.strip():
            token_dict["_user"] = req.brand_account.strip()
        
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(token_dict, f, indent=4)
            
        _copy_to_fallback(filepath)
        return {"status": "ok", "message": "OAuth token saved successfully."}
    except Exception as e:
        err_str = str(e)
        if "authorization_pending" in err_str:
            raise HTTPException(status_code=400, detail="authorization_pending")
        raise HTTPException(status_code=400, detail=err_str)


class _SilentLogger:
    def debug(self, m): pass
    def warning(self, m): pass
    def error(self, m): pass


SUPPORTED_AUTO_BROWSERS = ['chrome', 'edge', 'firefox', 'brave', 'chromium', 'opera']

AUTH_COOKIE_KEYS = ('SAPISID', 'SSID', '__Secure-3PSID', 'SID', '__Secure-1PSID')


@router.post("/auth/browser-capture")
def browser_capture(data: dict = Body(...)) -> Dict[str, Any]:
    """Auto-extract YouTube Music session from an installed browser using yt-dlp."""
    browser = data.get("browser", "chrome").lower()
    if browser not in SUPPORTED_AUTO_BROWSERS:
        raise HTTPException(status_code=400, detail=f"Navegador no soportado: {browser}")

    try:
        from yt_dlp.cookies import extract_cookies_from_browser
    except ImportError:
        raise HTTPException(status_code=500, detail="yt-dlp no está disponible en el entorno.")

    try:
        jar = extract_cookies_from_browser(browser, logger=_SilentLogger())
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"No se pudo leer el perfil de {browser}: {e}. "
                   f"Cierra el navegador e intenta de nuevo, o usa el método manual."
        )

    cookies = {
        c.name: c.value
        for c in jar
        if 'youtube.com' in getattr(c, 'domain', '') or 'google.com' in getattr(c, 'domain', '')
    }

    if not cookies:
        raise HTTPException(
            status_code=404,
            detail=f"No se encontraron cookies de YouTube en {browser}. ¿Estás logueado en YouTube Music?"
        )

    if not any(k in cookies for k in AUTH_COOKIE_KEYS):
        raise HTTPException(
            status_code=401,
            detail="Cookies encontradas pero sin sesión activa de Google. Inicia sesión en YouTube Music primero."
        )

    cookie_str = '; '.join(f'{k}={v}' for k, v in cookies.items())
    headers_raw = (
        "Cookie: " + cookie_str + "\n"
        "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\n"
        "X-Goog-AuthUser: 0\n"
        "Accept-Language: es-419,es;q=0.9\n"
    )

    filepath = "oauth.json"
    try:
        import ytmusicapi
        ytmusicapi.setup(filepath=filepath, headers_raw=headers_raw)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"ytmusicapi no pudo procesar las cookies: {e}")

    try:
        from ytmusicapi import YTMusic
        yt = YTMusic(filepath)
        yt.get_library_playlists(limit=1)
    except Exception as e:
        if os.path.exists(filepath):
            os.remove(filepath)
        raise HTTPException(
            status_code=401,
            detail=f"Cookies capturadas pero YouTube Music rechazó la sesión: {e}"
        )

    _copy_to_fallback(filepath)
    return {
        "status": "ok",
        "message": f"¡Conectado exitosamente desde {browser}!",
        "cookie_count": len(cookies)
    }
