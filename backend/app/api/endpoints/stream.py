import yt_dlp
import requests
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

router = APIRouter()

@router.get("/stream-audio/{video_id}")
def stream_audio(video_id: str, request: Request):
    """Resolves the video ID and proxies its audio stream, forwarding range headers."""
    url = f"https://music.youtube.com/watch?v={video_id}"
    opts = {
        "format": "bestaudio/best",
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            stream_url = info["url"]
            
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "*/*",
                "Accept-Encoding": "identity",
            }
            
            range_header = request.headers.get("range")
            if range_header:
                headers["Range"] = range_header
                
            req = requests.get(stream_url, headers=headers, stream=True)
            
            def iter_content():
                try:
                    for chunk in req.iter_content(chunk_size=1024 * 64):
                        if chunk:
                            yield chunk
                except GeneratorExit:
                    req.close()
            
            response_headers = {
                "Accept-Ranges": "bytes",
            }
            if "Content-Range" in req.headers:
                response_headers["Content-Range"] = req.headers["Content-Range"]
            if "Content-Length" in req.headers:
                response_headers["Content-Length"] = req.headers["Content-Length"]
                
            content_type = req.headers.get("Content-Type", "audio/webm")
            
            return StreamingResponse(
                iter_content(),
                status_code=req.status_code,
                media_type=content_type,
                headers=response_headers
            )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error al transmitir audio desde el backend: {str(e)}"
        )
