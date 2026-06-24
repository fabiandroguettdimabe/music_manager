import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router

def get_application() -> FastAPI:
    """Configures and returns the FastAPI application."""
    application = FastAPI(title="Real Shuffle Player API (Headless)")

    # Enable CORS so our React frontend can query the API
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Include all API routes
    application.include_router(api_router, prefix="/api")

    return application

app = get_application()

def start_server():
    """Starts the uvicorn API server."""
    print("\n=== Iniciando Backend API en http://0.0.0.0:8000 ===\n")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False, log_level="warning")

if __name__ == "__main__":
    start_server()
