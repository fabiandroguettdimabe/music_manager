from fastapi import APIRouter

from app.api.endpoints import auth, playlists, stream, search, spotify

api_router = APIRouter()

api_router.include_router(auth.router, tags=["auth"])
api_router.include_router(playlists.router, tags=["playlists"])
api_router.include_router(search.router, prefix="/search", tags=["search"])
api_router.include_router(stream.router, tags=["stream"])
api_router.include_router(spotify.router, prefix="/spotify", tags=["spotify"])
