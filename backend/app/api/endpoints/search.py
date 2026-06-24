from fastapi import APIRouter, HTTPException, Query
from typing import Dict, Any
from app.services.ytmusic import get_ytmusic_client

router = APIRouter()

@router.get("/")
def search(q: str = Query(..., min_length=1)) -> Dict[str, Any]:
    """Search for songs or videos. Works with or without authentication."""
    try:
        yt = get_ytmusic_client()
        # Search primarily for songs
        results = yt.search(q, filter="songs", limit=20)
        
        # If no songs found, try videos
        if not results:
            results = yt.search(q, filter="videos", limit=20)
            
        tracks = []
        for r in results:
            # ytmusicapi search results have a specific format
            video_id = r.get("videoId")
            if not video_id:
                continue
                
            title = r.get("title", "Desconocido")
            artists = []
            for a in r.get("artists", []):
                if isinstance(a, dict) and "name" in a:
                    artists.append(a["name"])
            artist_str = ", ".join(artists) if artists else "Artista Desconocido"
            
            thumbnails = r.get("thumbnails", [])
            thumb_url = thumbnails[-1]["url"] if thumbnails else ""
            
            duration = r.get("duration", "")
            
            tracks.append({
                "id": video_id,
                "title": title,
                "artist": artist_str,
                "thumbnail": thumb_url,
                "duration": duration
            })
            
        return {"query": q, "tracks": tracks}
    except Exception as e:
        print(f"Error fetching search results: {e}")
        if "Sign in" in str(e):
            raise HTTPException(status_code=401, detail="Sesión expirada")
        raise HTTPException(status_code=500, detail=str(e))
