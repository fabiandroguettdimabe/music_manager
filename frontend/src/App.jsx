import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Play, Pause, SkipForward, SkipBack, Shuffle, Heart,
  Settings, Search, Music, Link2, ListMusic, X,
  RefreshCw, Volume2, Volume1, Volume, VolumeX, Tv, Lock, ChevronRight,
  Sun, Moon, Timer, BarChart2, Minimize2, Maximize2, Zap
} from 'lucide-react';
import './index.css';
import { cachePlaylist, getCachedPlaylist } from './utils/playlistCache.js';
import AuthWizard from './components/auth/AuthWizard';
import SpotifyAuthWizard from './components/auth/SpotifyAuthWizard';
import LoginScreen from './auth/LoginScreen';
import { apiMe, apiLogout } from './auth/apiClient';

const SESSION_KEY = 'rsp_session_v1';

function SpotifyIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
    </svg>
  );
}

export default function App() {
  // --- Core State ---
  const [allTracks, setAllTracks] = useState([]);
  const [shuffleBag, setShuffleBag] = useState([]);
  const [playedHistory, setPlayedHistory] = useState([]);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(80);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeTab, setActiveTab] = useState('library');
  const [queueTab, setQueueTab] = useState('next');
  const [isVideoVisible, setIsVideoVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [playlistTitle, setPlaylistTitle] = useState('Ninguna playlist seleccionada');

  // Auth — YouTube Music
  const [authStatus, setAuthStatus] = useState({ authenticated: false, oauth_exists: false });
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(null);
  const [externalId, setExternalId] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Spotify
  const [playerMode, setPlayerMode] = useState('youtube'); // 'youtube' | 'spotify'
  const [spotifyAuth, setSpotifyAuth] = useState({ authenticated: false, token_exists: false });
  const [spotifyPlaylists, setSpotifyPlaylists] = useState([]);
  const [showSpotifyModal, setShowSpotifyModal] = useState(false);

  // App auth (multi-usuario): undefined = comprobando, null = sin login, objeto = usuario
  const [appUser, setAppUser] = useState(undefined);

  // Toast
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  // Feature: Dark/Light Mode
  const [theme, setTheme] = useState(() => localStorage.getItem('rsp_theme') || 'dark');

  // Feature: Sleep Timer
  const [sleepTimer, setSleepTimer] = useState(null); // null | { remaining: number }
  const [showSleepModal, setShowSleepModal] = useState(false);
  const sleepTimerRef = useRef(null);

  // Feature: Play Statistics
  const [showStatsModal, setShowStatsModal] = useState(false);

  // Feature: Compact Mode
  const [isCompact, setIsCompact] = useState(false);

  // Feature: Crossfade
  const [crossfade, setCrossfade] = useState(true);
  const crossfadeRef = useRef(true);
  const fadeIntervalRef = useRef(null);

  // Feature: Priority Queue
  const [priorityQueue, setPriorityQueue] = useState([]);
  const priorityQueueRef = useRef([]);

  // Refs for player
  const ytPlayerRef = useRef(null);
  const audioRef = useRef(null);
  const usingFallbackRef = useRef(false);
  const progressTimerRef = useRef(null);
  const ytReadyRef = useRef(false);
  const skipDebounceRef = useRef(false);

  // Spotify refs
  const spotifyPlayerRef = useRef(null);
  const spotifyDeviceIdRef = useRef(null);
  const spotifyReadyRef = useRef(false);
  const spotifyPrevPosRef = useRef(0);
  const playerModeRef = useRef('youtube');

  // Refs to access latest state in callbacks
  const bagRef = useRef([]);
  const historyRef = useRef([]);
  const currentRef = useRef(null);
  const allRef = useRef([]);
  const volumeRef = useRef(80);
  const mutedRef = useRef(false);

  // Keep refs synced
  useEffect(() => { bagRef.current = shuffleBag; }, [shuffleBag]);
  useEffect(() => { historyRef.current = playedHistory; }, [playedHistory]);
  useEffect(() => { currentRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { allRef.current = allTracks; }, [allTracks]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { mutedRef.current = isMuted; }, [isMuted]);
  const isPlayingRef = useRef(false);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { playerModeRef.current = playerMode; }, [playerMode]);
  useEffect(() => { crossfadeRef.current = crossfade; }, [crossfade]);
  useEffect(() => { priorityQueueRef.current = priorityQueue; }, [priorityQueue]);

  // Feature: Touch gestures
  const touchStartRef = useRef(null);

  // --- Toast ---
  const showToast = useCallback((message, isError = false) => {
    clearTimeout(toastTimerRef.current);
    setToast({ message, isError });
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  // --- Spotify SDK ---
  const loadSpotifySDK = () => {
    if (window.Spotify?.Player) { initSpotifyPlayer(); return; }
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    document.body.appendChild(s);
    window.onSpotifyWebPlaybackSDKReady = initSpotifyPlayer;
  };

  const initSpotifyPlayer = async () => {
    try {
      const res = await fetch('/api/spotify/token');
      if (!res.ok) return;
      const { access_token: initialToken } = await res.json();

      const player = new window.Spotify.Player({
        name: 'Real Shuffle Player',
        getOAuthToken: async (cb) => {
          const r = await fetch('/api/spotify/token');
          if (r.ok) { const d = await r.json(); cb(d.access_token); }
        },
        volume: volumeRef.current / 100,
      });

      player.addListener('ready', ({ device_id }) => {
        spotifyDeviceIdRef.current = device_id;
        spotifyReadyRef.current = true;
        showToast('Spotify listo para reproducir');
      });
      player.addListener('not_ready', ({ device_id }) => {
        console.warn('[Spotify] Device went offline:', device_id);
        spotifyDeviceIdRef.current = null;
        spotifyReadyRef.current = false;
        // Auto-reconnect after brief delay
        setTimeout(() => {
          if (spotifyPlayerRef.current) spotifyPlayerRef.current.connect();
        }, 3000);
      });
      player.addListener('initialization_error', ({ message }) => {
        console.error('[Spotify] Initialization error:', message);
        showToast('Error al inicializar Spotify: ' + message, true);
      });
      player.addListener('authentication_error', ({ message }) => {
        console.error('[Spotify] Auth error:', message);
        showToast('Error de autenticación en Spotify. Reconecta tu cuenta.', true);
      });
      player.addListener('account_error', ({ message }) => {
        console.error('[Spotify] Account error:', message);
        showToast('Spotify Premium requerido para el reproductor integrado', true);
      });
      player.addListener('playback_error', ({ message }) => {
        console.error('[Spotify] Playback error:', message);
      });
      player.addListener('player_state_changed', (state) => {
        if (!state || playerModeRef.current !== 'spotify') return;
        const cur = state.track_window?.current_track;
        if (!cur) return;

        // Sync displayed track from SDK state (needed for context_uri playback mode)
        if (!currentRef.current || currentRef.current.uri !== cur.uri) {
          const s = Math.floor(cur.duration_ms / 1000);
          const sdkTrack = {
            id: cur.uri,
            title: cur.name,
            artist: (cur.artists || []).map(a => a.name).join(', '),
            thumbnail: cur.album?.images?.[0]?.url || '',
            duration: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`,
            duration_seconds: s,
            uri: cur.uri,
          };
          setCurrentTrack(sdkTrack);
          currentRef.current = sdkTrack;
        }

        const dur = cur.duration_ms / 1000;
        const pos = state.position / 1000;
        const prevPos = spotifyPrevPosRef.current;
        spotifyPrevPosRef.current = pos;
        // In our-shuffle mode: detect end of track and advance our bag. The SDK
        // signals end either as paused near the duration, or as paused reset to
        // position 0 right after having been near the end.
        const reachedEnd =
          (pos >= dur - 1.5 && pos > 0) ||
          (pos === 0 && prevPos > 0 && prevPos >= dur - 3);
        if (allRef.current.length > 0 && dur > 0 && state.paused && reachedEnd) {
          doNextTrack();
          return;
        }
        if (state.paused) { setIsPlaying(false); stopProgressTimer(); }
        else { setIsPlaying(true); startProgressTimer('spotify'); }
      });

      await player.connect();
      spotifyPlayerRef.current = player;
    } catch (e) {
      console.error('Spotify SDK init failed:', e);
    }
  };

  // Wait until the Web Playback SDK device is (re)connected and ready, polling
  // instead of using a fixed delay so a slow reconnect doesn't falsely "fail".
  const waitForSpotifyReady = async (timeoutMs = 12000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (spotifyReadyRef.current && spotifyDeviceIdRef.current) return true;
      await new Promise(r => setTimeout(r, 250));
    }
    return !!(spotifyReadyRef.current && spotifyDeviceIdRef.current);
  };

  const spotifyPlayUri = async (uri, _retry = false) => {
    if (!spotifyDeviceIdRef.current || !spotifyReadyRef.current) {
      if (!_retry && spotifyPlayerRef.current) {
        showToast('Reconectando Spotify…', false);
        spotifyPlayerRef.current.connect();
        if (await waitForSpotifyReady()) return spotifyPlayUri(uri, true);
      }
      showToast('Spotify no está listo. Cierra cualquier otra sesión de Spotify activa en otro dispositivo (teléfono/PC) o recarga la página.', true);
      return;
    }
    try {
      const res = await fetch('/api/spotify/token');
      if (!res.ok) throw new Error('No token');
      const { access_token } = await res.json();

      const resp = await fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${spotifyDeviceIdRef.current}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ uris: [uri] }),
        }
      );
      if (resp.ok || resp.status === 204) {
        // Restore volume in case a crossfade faded it to ~0 before playback started.
        try { spotifyPlayerRef.current.setVolume(mutedRef.current ? 0 : volumeRef.current / 100); } catch {}
        setIsPlaying(true);
        startProgressTimer('spotify');
      } else if (resp.status === 403) {
        showToast('Spotify Premium requerido para reproducir', true);
      } else {
        const err = await resp.json().catch(() => ({}));
        const msg = err?.error?.message || '';
        if (!_retry && (resp.status === 404 || msg.toLowerCase().includes('device'))) {
          spotifyDeviceIdRef.current = null;
          spotifyReadyRef.current = false;
          if (spotifyPlayerRef.current) {
            showToast('Dispositivo expirado, reconectando…', false);
            spotifyPlayerRef.current.connect();
            await new Promise(r => setTimeout(r, 4000));
            return spotifyPlayUri(uri, true);
          }
        }
        if (msg) showToast(msg, true);
      }
    } catch (e) {
      showToast('Error al reproducir en Spotify', true);
    }
  };

  const checkSpotifyStatus = async () => {
    try {
      const res = await fetch('/api/spotify/status');
      const data = await res.json();
      setSpotifyAuth(data);
      if (data.authenticated) {
        fetchSpotifyPlaylists();
        loadSpotifySDK();
        if (data.needs_reauth) {
          showToast('Tu sesión de Spotify necesita actualización. Desconecta y vuelve a conectar para habilitar todas las funciones.', true);
        }
      }
    } catch (e) {
      console.error('Spotify status check failed:', e);
    }
  };

  // Direct Spotify API call from the browser (Spotify allows CORS from browsers)
  // Token is cached per-load to avoid multiple /api/spotify/token round-trips
  const spotifyApiFetch = async (path, params = {}, token = null) => {
    if (!token) {
      const tokenRes = await fetch('/api/spotify/token');
      if (!tokenRes.ok) throw new Error('No autenticado con Spotify');
      ({ access_token: token } = await tokenRes.json());
    }
    const url = new URL(`https://api.spotify.com/v1${path}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = body?.error?.message || res.statusText;
      throw new Error(`Spotify ${res.status}: ${msg}`);
    }
    return [await res.json(), token];
  };

  const fmtSpotifyTrack = (t) => {
    const artists = (t.artists || []).map(a => a.name).join(', ');
    const imgs = t.album?.images || [];
    const s = Math.floor((t.duration_ms || 0) / 1000);
    return {
      id: t.uri || '',
      title: t.name || 'Desconocido',
      artist: artists || 'Artista Desconocido',
      thumbnail: imgs[0]?.url || '',
      duration: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`,
      duration_seconds: s,
      uri: t.uri || '',
      source: 'spotify',
    };
  };

  const fetchSpotifyPlaylists = async () => {
    try {
      let token = null;
      const all = [];
      let offset = 0;
      while (true) {
        const [data, tok] = await spotifyApiFetch('/me/playlists', { limit: 50, offset }, token);
        token = tok;
        const items = (data.items || []).filter(Boolean);
        all.push(...items.map(p => ({
          id: p.id,
          title: p.name || 'Sin título',
          count: p.tracks?.total || 0,
          thumbnail: p.images?.[0]?.url || '',
        })));
        if (items.length < 50 || !data.next) break;
        offset += 50;
      }
      setSpotifyPlaylists(all);
    } catch (e) { console.error('fetchSpotifyPlaylists:', e); }
  };

  const playSpotifyContext = async (contextUri, displayTitle, _retry = false) => {
    if (!spotifyDeviceIdRef.current || !spotifyReadyRef.current) {
      if (!_retry && spotifyPlayerRef.current) {
        showToast('Reconectando Spotify…', false);
        spotifyPlayerRef.current.connect();
        if (await waitForSpotifyReady()) return playSpotifyContext(contextUri, displayTitle, true);
      }
      showToast('Spotify no está listo. Cierra cualquier otra sesión de Spotify activa en otro dispositivo (teléfono/PC) o recarga la página.', true);
      return;
    }
    try {
      const res = await fetch('/api/spotify/token');
      if (!res.ok) throw new Error('No token');
      const { access_token } = await res.json();

      // Enable shuffle before starting
      await fetch(
        `https://api.spotify.com/v1/me/player/shuffle?state=true&device_id=${spotifyDeviceIdRef.current}`,
        { method: 'PUT', headers: { Authorization: `Bearer ${access_token}` } }
      );

      const resp = await fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${spotifyDeviceIdRef.current}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ context_uri: contextUri }),
        }
      );
      if (resp.ok || resp.status === 204) {
        // Native Spotify shuffle owns advancement here — clear our bag so the
        // our-shuffle end-detection in player_state_changed stays disabled.
        setAllTracks([]); allRef.current = [];
        setShuffleBag([]); bagRef.current = [];
        setPlayedHistory([]); historyRef.current = [];
        setPlayerMode('spotify');
        playerModeRef.current = 'spotify';
        setPlaylistTitle(displayTitle);
        setIsPlaying(true);
        startProgressTimer('spotify');
      } else if (resp.status === 403) {
        showToast('Spotify Premium requerido para reproducir', true);
      } else {
        const err = await resp.json().catch(() => ({}));
        const msg = err?.error?.message || '';
        // Device expired — reconnect and retry once
        if (!_retry && (resp.status === 404 || msg.toLowerCase().includes('device'))) {
          spotifyDeviceIdRef.current = null;
          spotifyReadyRef.current = false;
          if (spotifyPlayerRef.current) {
            showToast('Dispositivo expirado, reconectando…', false);
            spotifyPlayerRef.current.connect();
            await new Promise(r => setTimeout(r, 4000));
            return playSpotifyContext(contextUri, displayTitle, true);
          }
        }
        showToast(msg || 'Error al iniciar reproducción', true);
      }
    } catch (e) {
      showToast('Error al reproducir en Spotify', true);
    }
  };

  const loadSpotifyPlaylist = async (id, title, merge = false) => {
    if (!merge) setSelectedPlaylistId(`spotify:${id}`);
    if (!merge) setPlaylistTitle(`Cargando '${title}'…`);
    try {
      let token = null;
      const [pl, tok] = await spotifyApiFetch(`/playlists/${id}`, {}, null);
      token = tok;
      const playlistName = pl.name || title;
      const total = pl.tracks?.total || 0;
      const tracks = [];
      let offset = 0;
      while (true) {
        if (!merge) setPlaylistTitle(`Cargando '${playlistName}' (${tracks.length}/${total})…`);
        const [data, t2] = await spotifyApiFetch(`/playlists/${id}/tracks`, { limit: 100, offset }, token);
        token = t2;
        const items = data.items || [];
        for (const item of items) {
          const t = item?.track;
          if (t && t.type === 'track' && t.uri) tracks.push(fmtSpotifyTrack(t));
        }
        if (items.length < 100 || !data.next) break;
        offset += 100;
      }
      if (!tracks.length) { showToast('Playlist vacía o sin canciones accesibles', true); return; }
      if (merge) {
        addToShuffleBag(tracks, playlistName);
      } else {
        setPlayerMode('spotify');
        playerModeRef.current = 'spotify';
        initShuffleBag(tracks, playlistName);
      }
    } catch (e) {
      if (e.message.includes('403')) {
        if (merge) { showToast('No se puede mezclar: sin acceso a las canciones de esa playlist', true); return; }
        showToast(`Usando reproducción directa de Spotify para '${title}'`, false);
        await playSpotifyContext(`spotify:playlist:${id}`, title);
      } else {
        showToast(e.message, true);
        if (!merge) setPlaylistTitle('Error');
      }
    }
  };

  const loadSpotifyLiked = async (merge = false) => {
    if (!merge) setSelectedPlaylistId('spotify:liked');
    if (!merge) setPlaylistTitle('Cargando favoritos de Spotify…');
    try {
      let token = null;
      const tracks = [];
      let offset = 0;
      while (true) {
        if (!merge) setPlaylistTitle(`Cargando favoritos… (${tracks.length})`);
        const [data, tok] = await spotifyApiFetch('/me/tracks', { limit: 50, offset }, token);
        token = tok;
        const items = data.items || [];
        for (const item of items) {
          const t = item?.track;
          if (t && t.type === 'track' && t.uri) tracks.push(fmtSpotifyTrack(t));
        }
        if (items.length < 50 || !data.next) break;
        offset += 50;
      }
      if (!tracks.length) { showToast('No tienes canciones guardadas', true); return; }
      if (merge) {
        addToShuffleBag(tracks, 'Favoritos Spotify');
      } else {
        setPlayerMode('spotify');
        playerModeRef.current = 'spotify';
        initShuffleBag(tracks, 'Canciones que te gustan');
      }
    } catch (e) { showToast(e.message, true); if (!merge) setPlaylistTitle('Error'); }
  };

  const logoutSpotify = async () => {
    if (!confirm('¿Desconectar Spotify?')) return;
    if (spotifyPlayerRef.current) {
      try { spotifyPlayerRef.current.disconnect(); } catch {}
      spotifyPlayerRef.current = null;
    }
    await fetch('/api/spotify/logout', { method: 'POST' });
    setSpotifyAuth({ authenticated: false, token_exists: false });
    setSpotifyPlaylists([]);
    if (playerMode === 'spotify') setPlayerMode('youtube');
    showToast('Spotify desconectado');
  };

  const restoreSession = () => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (!s.allTracks?.length) return;
      const byId = Object.fromEntries(s.allTracks.map(t => [t.id, t]));
      const bag = (s.shuffleBagIds || []).map(id => byId[id]).filter(Boolean);
      const history = (s.playedHistoryIds || []).map(id => byId[id]).filter(Boolean);
      const current = s.currentTrackId ? byId[s.currentTrackId] : null;
      setAllTracks(s.allTracks);
      allRef.current = s.allTracks;
      setShuffleBag(bag);
      bagRef.current = bag;
      setPlayedHistory(history);
      historyRef.current = history;
      if (current) { setCurrentTrack(current); currentRef.current = current; }
      if (s.playerMode) { setPlayerMode(s.playerMode); playerModeRef.current = s.playerMode; }
      if (s.playlistTitle) setPlaylistTitle(s.playlistTitle);
      if (s.selectedPlaylistId) setSelectedPlaylistId(s.selectedPlaylistId);
      if (s.volume != null) { setVolume(s.volume); volumeRef.current = s.volume; }
    } catch { localStorage.removeItem(SESSION_KEY); }
  };

  // --- On Mount ---
  useEffect(() => {
    restoreSession();
    apiMe().then((u) => setAppUser(u || null)); // gate de login
    loadYouTubeAPI();

    // Handle Spotify OAuth callback redirect
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (code && state) {
      window.history.replaceState({}, '', window.location.pathname);
      const pending = sessionStorage.getItem('spotify_pending');
      if (pending) {
        sessionStorage.removeItem('spotify_pending');
        const { client_id, client_secret, redirect_uri } = JSON.parse(pending);
        fetch('/api/spotify/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, state, client_id, client_secret, redirect_uri }),
        })
          .then(r => r.json().then(d => ({ ok: r.ok, d })))
          .then(({ ok, d }) => {
            if (ok) {
              showToast('¡Spotify conectado!');
              checkSpotifyStatus();
            } else {
              showToast(d.detail || 'Error conectando Spotify', true);
            }
          })
          .catch(() => showToast('Error conectando Spotify', true));
      }
    }

    return () => {
      clearInterval(progressTimerRef.current);
      clearTimeout(toastTimerRef.current);
      clearInterval(sleepTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cargar estado de proveedores una vez autenticado en la app
  useEffect(() => {
    if (!appUser) return;
    checkAuthStatus();
    checkSpotifyStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appUser]);

  const handleAppLogout = () => {
    apiLogout();
    try { if (spotifyPlayerRef.current) spotifyPlayerRef.current.pause(); } catch {}
    try { if (ytPlayerRef.current && ytReadyRef.current) ytPlayerRef.current.stopVideo(); } catch {}
    try { if (audioRef.current) { audioRef.current.pause(); audioRef.current.removeAttribute('src'); } } catch {}
    setIsPlaying(false);
    setAuthStatus({ authenticated: false, oauth_exists: false });
    setPlaylists([]);
    setSpotifyAuth({ authenticated: false, token_exists: false });
    setSpotifyPlaylists([]);
    setCurrentTrack(null); currentRef.current = null;
    setAllTracks([]); allRef.current = [];
    setShuffleBag([]); bagRef.current = [];
    setPlayedHistory([]); historyRef.current = [];
    localStorage.removeItem(SESSION_KEY);
    setAppUser(null);
  };

  // --- Keyboard Shortcuts ---
  const keyHandlerRef = useRef(null);
  useEffect(() => {
    keyHandlerRef.current = { doNextTrack, doPrevTrack, togglePlayPause, toggleMute, applyVolume };
  });
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const h = keyHandlerRef.current;
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          h.togglePlayPause();
          break;
        case 'ArrowRight':
          if (!e.shiftKey) { e.preventDefault(); h.doNextTrack(); }
          break;
        case 'ArrowLeft':
          if (!e.shiftKey) { e.preventDefault(); h.doPrevTrack(); }
          break;
        case 'KeyM':
          h.toggleMute();
          break;
        case 'ArrowUp':
          e.preventDefault();
          h.applyVolume(Math.min(100, volumeRef.current + 5));
          break;
        case 'ArrowDown':
          e.preventDefault();
          h.applyVolume(Math.max(0, volumeRef.current - 5));
          break;
        default:
          break;
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Feature: Theme toggle persistence
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('rsp_theme', theme);
  }, [theme]);

  // Session persistence
  useEffect(() => {
    if (!allTracks.length || playlistTitle.startsWith('Cargando')) return;
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        allTracks,
        shuffleBagIds: shuffleBag.map(t => t.id),
        playedHistoryIds: playedHistory.map(t => t.id),
        currentTrackId: currentTrack?.id,
        playerMode,
        playlistTitle,
        selectedPlaylistId,
        volume,
      }));
    } catch {}
  }, [allTracks, shuffleBag, playedHistory, currentTrack, playerMode, playlistTitle, selectedPlaylistId, volume]);

  // Media Session API — register handlers once
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play', () => { if (!isPlayingRef.current) keyHandlerRef.current.togglePlayPause(); });
    navigator.mediaSession.setActionHandler('pause', () => { if (isPlayingRef.current) keyHandlerRef.current.togglePlayPause(); });
    navigator.mediaSession.setActionHandler('previoustrack', () => keyHandlerRef.current.doPrevTrack());
    navigator.mediaSession.setActionHandler('nexttrack', () => keyHandlerRef.current.doNextTrack());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Media Session API — update metadata on track change
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (currentTrack) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        artwork: currentTrack.thumbnail
          ? [{ src: currentTrack.thumbnail, sizes: '512x512', type: 'image/jpeg' }]
          : [],
      });
    }
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [currentTrack, isPlaying]);

  // --- YouTube IFrame API ---
  const loadYouTubeAPI = () => {
    if (window.YT && window.YT.Player) {
      createYTPlayer();
      return;
    }
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);

    window.onYouTubeIframeAPIReady = () => {
      createYTPlayer();
    };
  };

  const createYTPlayer = () => {
    if (ytPlayerRef.current) return;
    ytPlayerRef.current = new window.YT.Player('yt-player-el', {
      height: '100%',
      width: '100%',
      playerVars: {
        autoplay: 0, controls: 0, disablekb: 1, fs: 0,
        rel: 0, modestbranding: 1, iv_load_policy: 3, playsinline: 1
      },
      events: {
        onReady: () => { ytReadyRef.current = true; },
        onStateChange: onYTStateChange,
        onError: onYTError
      }
    });
  };

  const onYTStateChange = (e) => {
    if (usingFallbackRef.current) return;
    const YT = window.YT;
    if (e.data === YT.PlayerState.PLAYING) {
      setIsPlaying(true);
      startProgressTimer('yt');
    } else if (e.data === YT.PlayerState.PAUSED) {
      setIsPlaying(false);
      stopProgressTimer();
    } else if (e.data === YT.PlayerState.ENDED) {
      setIsPlaying(false);
      stopProgressTimer();
      doNextTrack();
    }
  };

  const onYTError = (e) => {
    console.warn('YT IFrame error code:', e.data);
    // 101 / 150 = embedding not allowed
    if (e.data === 101 || e.data === 150) {
      showToast('Restricción detectada. Cargando audio directo…');
      loadFallbackAudio(currentRef.current?.id);
    } else {
      showToast('Error de reproducción YT. Saltando…', true);
      safNextTrack();
    }
  };

  // Debounced next to avoid rapid-fire skipping
  const safNextTrack = useCallback(() => {
    if (skipDebounceRef.current) return;
    skipDebounceRef.current = true;
    setTimeout(() => { skipDebounceRef.current = false; }, 2000);
    doNextTrack();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Fallback Audio via backend proxy ---
  const loadFallbackAudio = async (videoId) => {
    if (!videoId) return;
    usingFallbackRef.current = true;
    stopProgressTimer();

    // Stop YouTube player
    if (ytPlayerRef.current && ytReadyRef.current) {
      try { ytPlayerRef.current.stopVideo(); } catch {}
    }

    const audio = audioRef.current;
    if (!audio) return;
    audio.src = `/api/stream-audio/${videoId}`;
    audio.volume = volumeRef.current / 100;
    audio.muted = mutedRef.current;

    try {
      await audio.play();
      setIsPlaying(true);
      startProgressTimer('audio');
    } catch (err) {
      console.error('Fallback audio play() failed:', err);
      showToast('No se pudo cargar el audio directo. Saltando…', true);
      usingFallbackRef.current = false;
      safNextTrack();
    }
  };

  // --- Progress Timer ---
  const startProgressTimer = (source) => {
    stopProgressTimer();
    progressTimerRef.current = setInterval(async () => {
      if (source === 'yt' && ytPlayerRef.current && ytReadyRef.current) {
        try {
          setCurrentTime(ytPlayerRef.current.getCurrentTime?.() || 0);
          setDuration(ytPlayerRef.current.getDuration?.() || 0);
        } catch {}
      } else if (source === 'audio' && audioRef.current) {
        setCurrentTime(audioRef.current.currentTime || 0);
        const d = audioRef.current.duration;
        if (d && isFinite(d)) setDuration(d);
      } else if (source === 'spotify' && spotifyPlayerRef.current) {
        try {
          const state = await spotifyPlayerRef.current.getCurrentState();
          if (state && !state.paused) {
            setCurrentTime(state.position / 1000);
            const cur = state.track_window?.current_track;
            if (cur) setDuration(cur.duration_ms / 1000);
          }
        } catch {}
      }
    }, 500);
  };

  const stopProgressTimer = () => {
    clearInterval(progressTimerRef.current);
  };

  // Feature: Crossfade — fade out current track volume
  const fadeOutCurrent = (durationMs = 1500) => {
    return new Promise(resolve => {
      clearInterval(fadeIntervalRef.current);
      const steps = 20;
      const stepMs = durationMs / steps;
      let step = 0;
      const startVol = volumeRef.current;
      fadeIntervalRef.current = setInterval(() => {
        step++;
        const ratio = 1 - step / steps;
        const v = startVol * ratio;
        if (playerModeRef.current === 'spotify' && spotifyPlayerRef.current) {
          spotifyPlayerRef.current.setVolume(v / 100);
        } else if (usingFallbackRef.current && audioRef.current) {
          audioRef.current.volume = v / 100;
        } else if (ytPlayerRef.current && ytReadyRef.current) {
          try { ytPlayerRef.current.setVolume(v); } catch {}
        }
        if (step >= steps) {
          clearInterval(fadeIntervalRef.current);
          resolve();
        }
      }, stepMs);
    });
  };

  // --- Shuffle Logic ---
  const fisherYates = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const initShuffleBag = (tracks, title) => {
    const shuffled = fisherYates(tracks);
    const first = shuffled.pop();
    setAllTracks(tracks);
    setShuffleBag(shuffled);
    setPlayedHistory([]);
    setPlaylistTitle(title || 'Playlist');
    setIsFavorite(false);
    bagRef.current = shuffled;
    historyRef.current = [];
    allRef.current = tracks;
    doPlayTrack(first, shuffled, []);
  };

  const addToShuffleBag = (newTracks, label) => {
    if (!allRef.current.length) {
      initShuffleBag(newTracks, label);
      return;
    }
    const shuffledNew = fisherYates(newTracks);
    const merged = [...allRef.current, ...newTracks];
    const newBag = [...bagRef.current, ...shuffledNew];
    setAllTracks(merged);
    allRef.current = merged;
    setShuffleBag(newBag);
    bagRef.current = newBag;
    setPlaylistTitle(prev => {
      const base = prev.includes(' ✚ ') ? prev.split(' ✚ ')[0] : prev;
      return `${base} ✚ ${label}`;
    });
    showToast(`+${newTracks.length} canciones de "${label}" mezcladas`);
  };

  // --- Playback ---
  const doPlayTrack = (track, bag, history) => {
    if (!track) return;
    clearInterval(fadeIntervalRef.current);
    usingFallbackRef.current = false;
    stopProgressTimer();
    setCurrentTime(0);
    setDuration(0);
    setIsFavorite(false);

    // Stop fallback audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
    }

    setCurrentTrack(track);
    currentRef.current = track;
    trackPlayStat(track);

    // Crossfade: restore volume after track starts
    if (crossfadeRef.current) {
      setTimeout(() => {
        if (playerModeRef.current === 'spotify' && spotifyPlayerRef.current) {
          spotifyPlayerRef.current.setVolume(volumeRef.current / 100);
        } else if (usingFallbackRef.current && audioRef.current) {
          audioRef.current.volume = volumeRef.current / 100;
        } else if (ytPlayerRef.current && ytReadyRef.current) {
          try { ytPlayerRef.current.setVolume(volumeRef.current); } catch {}
        }
      }, 300);
    }
    setShuffleBag(bag);
    bagRef.current = bag;
    setPlayedHistory(history);
    historyRef.current = history;

    // Determine player from track source (supports mixed bags)
    const src = track.source || playerModeRef.current;

    if (src === 'spotify') {
      // Switching to Spotify: stop YouTube if it was playing
      if (playerModeRef.current !== 'spotify') {
        if (ytPlayerRef.current && ytReadyRef.current) {
          try { ytPlayerRef.current.stopVideo(); } catch {}
        }
      }
      setPlayerMode('spotify');
      playerModeRef.current = 'spotify';
      spotifyPlayUri(track.uri || track.id);
    } else {
      // Switching to YouTube: pause Spotify if it was playing
      if (playerModeRef.current === 'spotify' && spotifyPlayerRef.current) {
        try { spotifyPlayerRef.current.pause(); } catch {}
      }
      setPlayerMode('youtube');
      playerModeRef.current = 'youtube';
      if (ytPlayerRef.current && ytReadyRef.current) {
        ytPlayerRef.current.setVolume(volumeRef.current);
        if (mutedRef.current) ytPlayerRef.current.mute();
        else ytPlayerRef.current.unMute();
        ytPlayerRef.current.loadVideoById(track.id);
        setIsPlaying(true);
      } else {
        loadFallbackAudio(track.id);
      }
    }
  };

  const doNextTrack = useCallback(() => {
    // Spotify en "reproducción directa" (contexto nativo, sin bolsa): delega en su SDK.
    if (playerModeRef.current === 'spotify' && allRef.current.length === 0 && spotifyReadyRef.current && spotifyPlayerRef.current) {
      spotifyPlayerRef.current.nextTrack();
      return;
    }
    // Priority queue takes precedence
    if (priorityQueueRef.current.length > 0) {
      const pq = [...priorityQueueRef.current];
      const next = pq.shift();
      setPriorityQueue(pq);
      priorityQueueRef.current = pq;
      const cur = currentRef.current;
      const newHistory = cur ? [...historyRef.current, cur] : [...historyRef.current];
      if (crossfadeRef.current && isPlayingRef.current) {
        fadeOutCurrent(1200).then(() => doPlayTrack(next, bagRef.current, newHistory));
        return;
      }
      doPlayTrack(next, bagRef.current, newHistory);
      return;
    }

    let bag = [...bagRef.current];
    const all = allRef.current;
    if (all.length === 0) return;

    if (bag.length === 0) {
      bag = fisherYates(all);
      showToast('¡Bolsa rebarajada!');
    }
    const next = bag.pop();
    const cur = currentRef.current;
    const newHistory = cur ? [...historyRef.current, cur] : [...historyRef.current];
    if (crossfadeRef.current && isPlayingRef.current) {
      fadeOutCurrent(1200).then(() => doPlayTrack(next, bag, newHistory));
      return;
    }
    doPlayTrack(next, bag, newHistory);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doPrevTrack = () => {
    // Spotify en "reproducción directa" (contexto nativo): delega en su SDK.
    if (playerModeRef.current === 'spotify' && allRef.current.length === 0 && spotifyReadyRef.current && spotifyPlayerRef.current) {
      spotifyPlayerRef.current.previousTrack();
      return;
    }
    const history = [...historyRef.current];
    if (history.length === 0) {
      showToast('No hay canciones en el historial');
      return;
    }
    const prev = history.pop();
    const cur = currentRef.current;
    const newBag = cur ? [...bagRef.current, cur] : [...bagRef.current];
    if (crossfadeRef.current && isPlayingRef.current) {
      fadeOutCurrent(1200).then(() => doPlayTrack(prev, newBag, history));
      return;
    }
    doPlayTrack(prev, newBag, history);
  };

  const togglePlayPause = () => {
    if (!currentRef.current) {
      if (allRef.current.length > 0) doNextTrack();
      return;
    }
    if (playerModeRef.current === 'spotify' && spotifyPlayerRef.current) {
      spotifyPlayerRef.current.togglePlay();
      return;
    }
    if (usingFallbackRef.current) {
      const audio = audioRef.current;
      if (!audio) return;
      if (isPlayingRef.current) { audio.pause(); setIsPlaying(false); stopProgressTimer(); }
      else { audio.play(); setIsPlaying(true); startProgressTimer('audio'); }
      return;
    }
    if (ytPlayerRef.current && ytReadyRef.current) {
      if (isPlayingRef.current) ytPlayerRef.current.pauseVideo();
      else ytPlayerRef.current.playVideo();
    }
  };

  const seekAt = (el, clientX) => {
    const rect = el.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const t = pos * (duration || 0);
    if (playerModeRef.current === 'spotify' && spotifyPlayerRef.current) {
      spotifyPlayerRef.current.seek(Math.round(t * 1000));
    } else if (usingFallbackRef.current && audioRef.current) {
      audioRef.current.currentTime = t;
    } else if (ytPlayerRef.current && ytReadyRef.current) {
      ytPlayerRef.current.seekTo(t, true);
    }
    setCurrentTime(t);
  };

  const handleProgressPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    seekAt(e.currentTarget, e.clientX);
  };

  const handleProgressPointerMove = (e) => {
    if (e.buttons !== 1) return;
    seekAt(e.currentTarget, e.clientX);
  };

  const applyVolume = (v) => {
    setVolume(v);
    volumeRef.current = v;
    if (mutedRef.current) { setIsMuted(false); mutedRef.current = false; }
    if (playerModeRef.current === 'spotify' && spotifyPlayerRef.current) {
      spotifyPlayerRef.current.setVolume(v / 100);
    } else if (usingFallbackRef.current && audioRef.current) {
      audioRef.current.volume = v / 100;
      audioRef.current.muted = false;
    } else if (ytPlayerRef.current && ytReadyRef.current) {
      ytPlayerRef.current.setVolume(v);
      ytPlayerRef.current.unMute();
    }
  };

  const volumeAt = (el, clientX) => {
    const rect = el.getBoundingClientRect();
    const v = Math.round(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * 100);
    applyVolume(v);
  };

  const handleVolumePointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    volumeAt(e.currentTarget, e.clientX);
  };

  const handleVolumePointerMove = (e) => {
    if (e.buttons !== 1) return;
    volumeAt(e.currentTarget, e.clientX);
  };

  // Feature: Touch gestures for artwork swipe
  const handleTouchStart = (e) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  };
  const handleTouchEnd = (e) => {
    if (!touchStartRef.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartRef.current.x;
    const dy = t.clientY - touchStartRef.current.y;
    touchStartRef.current = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) doNextTrack(); else doPrevTrack();
  };

  const toggleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    mutedRef.current = newMuted;
    if (playerModeRef.current === 'spotify' && spotifyPlayerRef.current) {
      spotifyPlayerRef.current.setVolume(newMuted ? 0 : volumeRef.current / 100);
    } else if (usingFallbackRef.current && audioRef.current) {
      audioRef.current.muted = newMuted;
    } else if (ytPlayerRef.current && ytReadyRef.current) {
      newMuted ? ytPlayerRef.current.mute() : ytPlayerRef.current.unMute();
    }
  };

  const selectFromQueue = (track) => {
    const newBag = bagRef.current.filter(t => t.id !== track.id);
    const cur = currentRef.current;
    const newHistory = cur ? [...historyRef.current, cur] : [...historyRef.current];
    doPlayTrack(track, newBag, newHistory);
  };

  const rollbackTo = (track) => {
    const history = historyRef.current;
    const idx = history.findIndex(t => t.id === track.id);
    if (idx === -1) return;
    const toReturn = history.slice(idx + 1);
    const cur = currentRef.current;
    if (cur) toReturn.push(cur);
    const newBag = [...bagRef.current, ...toReturn];
    const newHistory = history.slice(0, idx);
    doPlayTrack(track, newBag, newHistory);
  };

  const reshuffleBag = () => {
    if (allRef.current.length === 0) return;
    const shuffled = fisherYates(allRef.current);
    setShuffleBag(shuffled);
    bagRef.current = shuffled;
    showToast('¡Bolsa rebarajada!');
  };

  // Feature: Sleep Timer
  const activateSleepTimer = (minutes) => {
    clearInterval(sleepTimerRef.current);
    if (minutes === 0) { setSleepTimer(null); return; }
    const total = minutes * 60;
    setSleepTimer({ remaining: total });
    sleepTimerRef.current = setInterval(() => {
      setSleepTimer(prev => {
        if (!prev) return null;
        if (prev.remaining <= 1) {
          clearInterval(sleepTimerRef.current);
          // Pause all players
          if (playerModeRef.current === 'spotify' && spotifyPlayerRef.current) {
            spotifyPlayerRef.current.pause();
          } else if (usingFallbackRef.current && audioRef.current) {
            audioRef.current.pause();
          } else if (ytPlayerRef.current && ytReadyRef.current) {
            ytPlayerRef.current.pauseVideo();
          }
          setIsPlaying(false);
          stopProgressTimer();
          showToast('Sleep timer: reproducción pausada');
          return null;
        }
        return { remaining: prev.remaining - 1 };
      });
    }, 1000);
    showToast(`Sleep timer: ${minutes} min`);
    setShowSleepModal(false);
  };

  // Feature: Play Statistics
  const trackPlayStat = (track) => {
    if (!track?.id) return;
    try {
      const raw = localStorage.getItem('rsp_stats') || '{}';
      const stats = JSON.parse(raw);
      const entry = stats[track.id] || { title: track.title, artist: track.artist, thumbnail: track.thumbnail, count: 0 };
      entry.count += 1;
      entry.lastPlayed = new Date().toISOString();
      stats[track.id] = entry;
      localStorage.setItem('rsp_stats', JSON.stringify(stats));
    } catch {}
  };

  // Feature: Priority Queue
  const addToNext = (track, e) => {
    e.stopPropagation();
    setPriorityQueue(pq => {
      const next = [...pq, track];
      priorityQueueRef.current = next;
      return next;
    });
    showToast(`"${track.title}" → cola prioritaria`);
  };

  // --- API ---
  const checkAuthStatus = async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      setAuthStatus(data);
      if (data.authenticated) {
        fetchPlaylists();
      } else if (data.oauth_exists && !data.authenticated) {
        // oauth.json exists but session expired
        showToast(data.user_name || 'Sesión expirada. Reconfigura tu cuenta.', true);
      }
    } catch (e) {
      console.error('Auth check failed:', e);
    }
  };

  const fetchPlaylists = async () => {
    try {
      const res = await fetch('/api/playlists');
      if (res.ok) {
        const d = await res.json();
        setPlaylists(d.playlists || []);
      } else {
        const err = await res.json().catch(() => ({ detail: 'Error desconocido' }));
        showToast(err.detail || 'No se pudieron cargar las playlists', true);
        if (res.status === 401) {
          // Session expired, reset auth status
          setAuthStatus(prev => ({ ...prev, authenticated: false }));
        }
      }
    } catch (e) {
      console.error(e);
      showToast('Error de conexión con el servidor', true);
    }
  };

  const openAuthWizard = () => {
    setShowAuthModal(true);
  };

  const logout = async () => {
    if (!confirm('¿Cerrar sesión?')) return;
    await fetch('/api/logout', { method: 'POST' });
    showToast('Sesión cerrada');
    setShowAuthModal(false);
    setAuthStatus({ authenticated: false, oauth_exists: false });
    setPlaylists([]);
    checkAuthStatus();
  };

  const loadLikedSongs = async (merge = false) => {
    if (!authStatus.authenticated) return;
    if (!merge) setSelectedPlaylistId('liked');
    if (!merge) setPlaylistTitle('Cargando favoritos…');
    try {
      const res = await fetch('/api/liked-songs');
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
      const d = await res.json();
      if (!d.tracks.length) { showToast('No tienes canciones gustadas', true); return; }
      const tracks = d.tracks.map(t => ({ ...t, source: 'youtube' }));
      if (merge) addToShuffleBag(tracks, d.title);
      else initShuffleBag(tracks, d.title);
    } catch (e) { showToast(e.message, true); if (!merge) setPlaylistTitle('Error'); }
  };

  const loadPlaylist = async (id, title, merge = false) => {
    if (!id || !id.trim()) { showToast('Introduce un ID de playlist', true); return; }
    if (!merge) setSelectedPlaylistId(id);
    if (!merge) setPlaylistTitle(`Cargando '${title}'…`);

    // Show cached version immediately (only when replacing, not merging)
    const cached = !merge ? await getCachedPlaylist(id) : null;
    if (cached?.tracks?.length) {
      const cachedWithSrc = cached.tracks.map(t => ({ ...t, source: 'youtube' }));
      initShuffleBag(cachedWithSrc, cached.title);
      setPlaylistTitle(cached.title + ' (cache)');
    }

    try {
      const res = await fetch(`/api/playlist/${id}`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
      const d = await res.json();
      if (!d.tracks.length) { showToast('Playlist vacía', true); return; }
      const tracks = d.tracks.map(t => ({ ...t, source: 'youtube' }));
      await cachePlaylist(id, d.title, d.tracks);
      if (merge) addToShuffleBag(tracks, d.title);
      else initShuffleBag(tracks, d.title);
    } catch (e) {
      if (!cached && !merge) { showToast(e.message, true); setPlaylistTitle('Error'); }
      else if (!merge) showToast('Usando versión en caché (sin conexión o error)', false);
      else showToast(e.message, true);
    }
  };

  const handleGlobalSearch = async (e) => {
    e?.preventDefault();
    if (!globalSearchQuery.trim()) return;
    setIsSearching(true);
    setPlaylistTitle(`Resultados para "${globalSearchQuery}"`);
    // Don't wipe the current queue before the fetch — initShuffleBag replaces it
    // on success, so a failed search leaves the existing playlist/bag intact.

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(globalSearchQuery)}`);
      if (!res.ok) throw new Error('Error al buscar');
      const data = await res.json();
      const tracks = (data.tracks || []).map(t => ({ ...t, source: 'youtube' }));
      initShuffleBag(tracks, `Resultados de: ${globalSearchQuery}`);
    } catch (err) {
      console.error(err);
      showToast('Error en la búsqueda', true);
    } finally {
      setIsSearching(false);
    }
  };

  // --- Helpers ---
  const fmt = (s) => {
    if (!s || isNaN(s) || !isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bagProgress = allTracks.length ? ((allTracks.length - shuffleBag.length) / allTracks.length) * 100 : 0;
  const upcoming = useMemo(() => [...shuffleBag].reverse(), [shuffleBag]);

  const searchResults = searchQuery.trim()
    ? allTracks.filter(t =>
        t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.artist.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  const VolumeIcon = isMuted || volume === 0
    ? VolumeX
    : volume < 30 ? Volume : volume < 70 ? Volume1 : Volume2;

  // Gate de login (multi-usuario)
  if (appUser === undefined) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
        Cargando…
      </div>
    );
  }
  if (appUser === null) {
    return <LoginScreen onAuthed={(u) => setAppUser(u)} />;
  }

  return (
    <>
      {/* Hidden audio element for fallback playback */}
      <audio ref={audioRef}
        onEnded={doNextTrack}
        onError={() => {
          if (usingFallbackRef.current) {
            showToast('Error de audio directo. Saltando…', true);
            usingFallbackRef.current = false;
            safNextTrack();
          }
        }}
        preload="none"
      />

      {/* Ambient Background */}
      <div className="ambient-bg" style={{
        backgroundImage: currentTrack
          ? `radial-gradient(circle at 10% 20%, hsla(342,85%,20%,0.4) 0%, transparent 40%),
             radial-gradient(circle at 90% 80%, hsla(263,85%,20%,0.4) 0%, transparent 40%),
             radial-gradient(circle at 50% 50%, rgba(12,12,14,0.9) 0%, rgba(12,12,14,1) 100%),
             url('${currentTrack.thumbnail}')`
          : undefined
      }} />

      <div className={`app-container${isCompact ? ' compact' : ''}`}>
        {/* ═══════ SIDEBAR ═══════ */}
        <aside className="sidebar glass-panel">
          <div className="sidebar-header">
            <div className="logo">
              <div className="logo-icon"><Shuffle size={20} /></div>
              <h2>Real Shuffle</h2>
            </div>
            <div className={`auth-badge ${authStatus.authenticated ? 'authenticated' : 'guest'}`}>
              <span className="status-dot" />
              <span className="status-text">{authStatus.authenticated ? 'Autenticado' : 'Modo Invitado'}</span>
            </div>
          </div>

          <div className="sidebar-nav">
            <button className={`nav-btn ${activeTab === 'library' ? 'active' : ''}`} onClick={() => setActiveTab('library')}>
              <Music size={16} /> YT Music
            </button>
            <button className={`nav-btn ${activeTab === 'spotify' ? 'active' : ''} spotify-nav-btn`} onClick={() => setActiveTab('spotify')}>
              <SpotifyIcon /> Spotify
            </button>
            <button className={`nav-btn ${activeTab === 'search' ? 'active' : ''}`} onClick={() => setActiveTab('search')}>
              <Search size={16} /> Buscar
            </button>
            <button className={`nav-btn ${activeTab === 'external' ? 'active' : ''}`} onClick={() => setActiveTab('external')}>
              <Link2 size={16} /> Externa
            </button>
          </div>

          <div className="sidebar-content">
            {activeTab === 'library' && (
              <div className="tab-pane active">
                <div className="nav-section" style={{ display: 'flex', gap: 8 }}>
                  <button
                    className={`action-btn ${authStatus.authenticated ? '' : 'disabled'}`}
                    style={{ flex: 1 }}
                    onClick={() => loadLikedSongs(false)}
                    disabled={!authStatus.authenticated}
                  >
                    <Heart size={16} fill={authStatus.authenticated ? 'white' : 'none'} /> Favoritos
                  </button>
                  <button
                    className="playlist-merge-btn"
                    title="Mezclar favoritos YT con la bolsa actual"
                    onClick={() => loadLikedSongs(true)}
                    disabled={!authStatus.authenticated}
                  >
                    ✚
                  </button>
                </div>
                <div className="playlist-section">
                  <h3>Mis Playlists</h3>
                  <div className="playlists-container scrollable">
                    {authStatus.authenticated ? (
                      playlists.length === 0
                        ? <div className="list-placeholder-small">Cargando…</div>
                        : playlists.map(pl => (
                            <div key={pl.id}
                              className={`playlist-card ${selectedPlaylistId === pl.id ? 'active' : ''}`}
                              onClick={() => loadPlaylist(pl.id, pl.title, false)}
                            >
                              <img src={pl.thumbnail} alt="" />
                              <div className="playlist-meta">
                                <h4>{pl.title}</h4>
                                <span>{pl.count} canciones</span>
                              </div>
                              <button className="playlist-merge-btn" title="Mezclar con bolsa actual" onClick={e => { e.stopPropagation(); loadPlaylist(pl.id, pl.title, true); }}>✚</button>
                            </div>
                          ))
                    ) : (
                      <div className="list-placeholder">
                        <Lock className="placeholder-icon" size={32} />
                        <p>Inicia sesión con tu <code>oauth.json</code> para ver tu biblioteca.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            
            {activeTab === 'spotify' && (
              <div className="tab-pane active">
                {!spotifyAuth.authenticated ? (
                  <div className="list-placeholder">
                    <SpotifyIcon size={36} style={{ color: 'hsl(141,74%,42%)' }} />
                    <p>Conecta Spotify Premium para reproducir directamente.</p>
                    <button className="action-btn" style={{ background: 'linear-gradient(135deg,hsl(141,74%,42%),hsl(141,74%,32%))', boxShadow: '0 4px 16px rgba(30,215,96,0.3)' }} onClick={() => setShowSpotifyModal(true)}>
                      Conectar Spotify
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="nav-section" style={{ display: 'flex', gap: 8 }}>
                      <button className="action-btn" style={{ flex: 1, background: 'linear-gradient(135deg,hsl(141,74%,42%),hsl(141,74%,32%))', boxShadow: '0 4px 16px rgba(30,215,96,0.3)' }} onClick={() => loadSpotifyLiked(false)}>
                        <Heart size={16} fill="white" /> Favoritos
                      </button>
                      <button className="playlist-merge-btn" style={{ borderColor: 'rgba(30,215,96,0.3)', color: 'hsl(141,74%,42%)' }} title="Mezclar favoritos Spotify con la bolsa actual" onClick={() => loadSpotifyLiked(true)}>✚</button>
                    </div>
                    <div className="playlist-section">
                      <h3>Mis Playlists de Spotify</h3>
                      <div className="playlists-container scrollable">
                        {spotifyPlaylists.length === 0
                          ? <div className="list-placeholder-small">Cargando…</div>
                          : spotifyPlaylists.map(pl => (
                              <div key={pl.id}
                                className={`playlist-card ${selectedPlaylistId === `spotify:${pl.id}` ? 'active' : ''}`}
                                onClick={() => loadSpotifyPlaylist(pl.id, pl.title, false)}
                              >
                                <img src={pl.thumbnail} alt="" />
                                <div className="playlist-meta">
                                  <h4>{pl.title}</h4>
                                  <span>{pl.count} canciones</span>
                                </div>
                                <button className="playlist-merge-btn" style={{ borderColor: 'rgba(30,215,96,0.3)', color: 'hsl(141,74%,42%)' }} title="Mezclar con bolsa actual" onClick={e => { e.stopPropagation(); loadSpotifyPlaylist(pl.id, pl.title, true); }}>✚</button>
                              </div>
                            ))
                        }
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === 'search' && (
              <div className="tab-pane active">
                <div className="external-form" style={{ marginTop: '1rem' }}>
                  <label>Buscar Música en YouTube</label>
                  <form onSubmit={handleGlobalSearch} className="input-group">
                    <input placeholder="Ej. The Weeknd Blinding Lights" value={globalSearchQuery}
                      onChange={e => setGlobalSearchQuery(e.target.value)}
                    />
                    <button type="submit" className="icon-btn" disabled={isSearching}>
                      <Search size={16} />
                    </button>
                  </form>
                  {isSearching && <span className="input-help">Buscando...</span>}
                  <span className="input-help">Busca cualquier canción. {authStatus.authenticated ? '' : 'No requiere sesión.'}</span>
                </div>
              </div>
            )}

            {activeTab === 'external' && (
              <div className="tab-pane active">
                <div className="external-form">
                  <label>ID de Playlist de YouTube</label>
                  <div className="input-group">
                    <input placeholder="PLxxxxxxxxxxxx" value={externalId}
                      onChange={e => setExternalId(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && loadPlaylist(externalId.trim(), 'Playlist Externa')}
                    />
                    <button className="icon-btn" onClick={() => loadPlaylist(externalId.trim(), 'Playlist Externa')}>
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <span className="input-help">Pega el parámetro "list" de la URL.</span>
                </div>
              </div>
            )}
          </div>

          <div className="sidebar-footer">
            <button className="settings-btn" style={{ marginBottom: 8 }} onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              {theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
            </button>
            <button className="settings-btn" style={{ marginBottom: 8 }} onClick={() => setShowStatsModal(true)}>
              <BarChart2 size={16} /> Estadísticas
            </button>
            <button className="settings-btn" onClick={openAuthWizard}>
              <Settings size={16} /> Configurar YT Music
            </button>
            <button className="settings-btn" style={{ marginTop: 8, borderColor: spotifyAuth.authenticated ? 'rgba(30,215,96,0.3)' : undefined }} onClick={() => setShowSpotifyModal(true)}>
              <SpotifyIcon /> {spotifyAuth.authenticated ? `Spotify: ${spotifyAuth.user_name}` : 'Configurar Spotify'}
            </button>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Sesión: {appUser?.name || appUser?.email}
              </div>
              <button className="settings-btn" onClick={handleAppLogout}>
                <X size={16} /> Cerrar sesión
              </button>
            </div>
          </div>
        </aside>

        {/* ═══════ MAIN PLAYER ═══════ */}
        <main className="main-player">
          <header className="player-header">
            <div className="current-playlist-info">
              <span className="subtitle">Reproduciendo desde</span>
              <h1>{playlistTitle}</h1>
            </div>
            <div className="global-search">
              <div className="search-input-wrapper">
                <Search size={16} />
                <input placeholder="Buscar en la playlist…" value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
            <button className="volume-btn" onClick={() => setIsCompact(c => !c)} title={isCompact ? 'Expandir' : 'Modo compacto'} style={{ marginLeft: 8 }}>
              {isCompact ? <Maximize2 size={18} /> : <Minimize2 size={18} />}
            </button>
          </header>

          <div className="player-widget">
            <div className="player-card glass-panel">
              {/* Artwork */}
              <div className="artwork-container" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
                <img src={currentTrack?.thumbnail || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=600&auto=format&fit=crop'} alt="" />
                <div className={`yt-player-wrapper ${isVideoVisible ? '' : 'hidden'}`}>
                  <div id="yt-player-el" />
                </div>
                <button className={`video-toggle ${isVideoVisible ? 'active' : ''}`}
                  onClick={() => setIsVideoVisible(!isVideoVisible)}>
                  <Tv size={18} />
                </button>
              </div>

              {/* Track info */}
              <div className="track-details">
                <div className="meta">
                  <h2>{currentTrack?.title || 'Selecciona música para empezar'}</h2>
                  <p style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {currentTrack?.source === 'spotify' && <SpotifyIcon size={13} style={{ color: 'hsl(141,74%,42%)', flexShrink: 0 }} />}
                    {currentTrack?.artist || 'Listo para reproducir'}
                  </p>
                </div>
                <button className={`fav-btn ${isFavorite ? 'active' : ''}`}
                  onClick={() => { if (!currentTrack) return; setIsFavorite(!isFavorite); }}>
                  <Heart size={20} fill={isFavorite ? 'var(--accent)' : 'none'} />
                </button>
              </div>

              {/* Progress */}
              <div className="progress-section">
                <span>{fmt(currentTime)}</span>
                <div className="progress-bar-container"
                  onPointerDown={handleProgressPointerDown}
                  onPointerMove={handleProgressPointerMove}
                  style={{ touchAction: 'none' }}>
                  <div className="progress-bar-bg" />
                  <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
                  <div className="progress-knob" style={{ left: `${progress}%` }} />
                </div>
                <span>{fmt(duration)}</span>
              </div>

              {/* Controls */}
              <div className="controls-section">
                <button className="control-btn secondary" onClick={doPrevTrack}><SkipBack size={24} /></button>
                <button className={`control-btn play-btn ${isPlaying ? 'playing' : ''}`} onClick={togglePlayPause}>
                  {isPlaying
                    ? <Pause size={28} fill="currentColor" />
                    : <Play size={28} fill="currentColor" style={{ marginLeft: 4 }} />}
                </button>
                <button className="control-btn secondary" onClick={doNextTrack}><SkipForward size={24} /></button>
              </div>

              {/* Volume + EQ */}
              <div className="footer-controls">
                <div className="volume-control">
                  <button className="volume-btn" onClick={toggleMute}><VolumeIcon size={18} /></button>
                  <div className="volume-slider-container"
                    onPointerDown={handleVolumePointerDown}
                    onPointerMove={handleVolumePointerMove}
                    style={{ touchAction: 'none' }}>
                    <div className="volume-slider-bg" />
                    <div className="volume-slider-fill" style={{ width: `${isMuted ? 0 : volume}%` }} />
                    <div className="volume-knob" style={{ left: `${isMuted ? 0 : volume}%` }} />
                  </div>
                </div>
                <div className={`visualizer ${isPlaying ? 'active' : ''}`}>
                  <span className="bar" /><span className="bar" /><span className="bar" />
                  <span className="bar" /><span className="bar" />
                </div>
                <button
                  className="volume-btn"
                  style={{ color: sleepTimer ? 'var(--accent)' : undefined, position: 'relative' }}
                  onClick={() => setShowSleepModal(true)}
                  title="Sleep timer"
                >
                  <Timer size={18} />
                  {sleepTimer && (
                    <span style={{ position: 'absolute', top: -4, right: -4, fontSize: '0.6rem', background: 'var(--accent)', color: 'white', borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                      {Math.ceil(sleepTimer.remaining / 60)}
                    </span>
                  )}
                </button>
                <button className="volume-btn" onClick={() => setCrossfade(c => !c)} title={crossfade ? 'Desactivar crossfade' : 'Activar crossfade'} style={{ color: crossfade ? 'var(--accent)' : undefined }}>
                  <Zap size={16} />
                </button>
              </div>
            </div>
          </div>
        </main>

        {/* ═══════ QUEUE PANEL ═══════ */}
        <section className="queue-panel glass-panel">
          <div className="queue-header">
            <div className="title-with-icon">
              <ListMusic size={20} />
              <h2>{searchQuery.trim() ? 'Resultados' : 'Cola & Bolsa'}</h2>
            </div>
            {!searchQuery.trim() && (
              <button className="action-btn text-btn" onClick={reshuffleBag}>
                <RefreshCw size={12} /> Rebarajar
              </button>
            )}
          </div>

          {!searchQuery.trim() && (
            <div className="shuffle-stats">
              <div className="stat-item"><span className="stat-label">Total</span><span className="stat-val">{allTracks.length}</span></div>
              <div className="stat-item"><span className="stat-label">Quedan</span><span className="stat-val">{shuffleBag.length}</span></div>
              <div className="bag-progress"><div className="bag-progress-fill" style={{ width: `${bagProgress}%` }} /></div>
              <span className="bag-desc">Shuffle REAL: no se repite ninguna canción hasta agotar la bolsa.</span>
            </div>
          )}

          <div className="queue-lists-container">
            {!searchQuery.trim() && (
              <div className="queue-nav">
                <button className={`queue-nav-btn ${queueTab === 'next' ? 'active' : ''}`} onClick={() => setQueueTab('next')}>
                  Siguientes ({upcoming.length})
                </button>
                <button className={`queue-nav-btn ${queueTab === 'history' ? 'active' : ''}`} onClick={() => setQueueTab('history')}>
                  Sonadas ({playedHistory.length})
                </button>
              </div>
            )}

            <div className="queue-content scrollable">
              {searchQuery.trim() ? (
                <div className="track-list">
                  {searchResults.length === 0
                    ? <div className="list-placeholder-small">Sin resultados</div>
                    : searchResults.map(t => (
                        <div key={t.id} className={`queue-track-card ${currentTrack?.id === t.id ? 'active' : ''}`}
                          onClick={() => { selectFromQueue(t); setSearchQuery(''); }}>
                          <img src={t.thumbnail} alt="" />
                          <div className="queue-track-meta"><h4>{t.title}</h4><span>{t.artist}</span></div>
                          <div className="queue-track-duration">{t.duration}</div>
                        </div>
                      ))
                  }
                </div>
              ) : queueTab === 'next' ? (
                <div className="track-list">
                  {priorityQueue.length > 0 && (
                    <>
                      <div style={{ fontSize: '0.7rem', color: 'var(--accent)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, padding: '4px 0' }}>Siguiente forzado</div>
                      {priorityQueue.map((t, i) => (
                        <div key={`pq-${t.id}-${i}`} className="queue-track-card" style={{ borderColor: 'rgba(230,57,70, 0.3)' }}
                          onClick={() => { const pq = priorityQueue.filter((_, idx) => idx !== i); setPriorityQueue(pq); priorityQueueRef.current = pq; selectFromQueue(t); }}>
                          <img src={t.thumbnail} alt="" />
                          <div className="queue-track-meta"><h4 style={{ color: 'var(--accent)' }}>{t.title}</h4><span>{t.artist}</span></div>
                          <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }} onClick={e => { e.stopPropagation(); const pq = priorityQueue.filter((_, idx) => idx !== i); setPriorityQueue(pq); priorityQueueRef.current = pq; }}>✕</button>
                        </div>
                      ))}
                      {upcoming.length > 0 && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, padding: '8px 0 4px' }}>Shuffle bag</div>}
                    </>
                  )}
                  {upcoming.length === 0 && priorityQueue.length === 0
                    ? <div className="list-placeholder-small">Bolsa vacía</div>
                    : upcoming.map(t => (
                        <div key={t.id} className={`queue-track-card ${currentTrack?.id === t.id ? 'active' : ''}`}
                          onClick={() => selectFromQueue(t)}>
                          <img src={t.thumbnail} alt="" />
                          <div className="queue-track-meta"><h4>{t.title}</h4><span>{t.artist}</span></div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            {t.source && <span className={`track-source-badge ${t.source}`}>{t.source === 'spotify' ? 'SP' : 'YT'}</span>}
                            <div className="queue-track-duration">{t.duration}</div>
                            <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 6px', borderRadius: 6, fontSize: '0.7rem' }} title="Reproducir siguiente" onClick={e => addToNext(t, e)}>+next</button>
                          </div>
                        </div>
                      ))
                  }
                </div>
              ) : (
                <div className="track-list">
                  {playedHistory.length === 0
                    ? <div className="list-placeholder-small">Ninguna canción reproducida aún</div>
                    : [...playedHistory].reverse().map(t => (
                        <div key={t.id} className={`queue-track-card ${currentTrack?.id === t.id ? 'active' : ''}`}
                          onClick={() => rollbackTo(t)}>
                          <img src={t.thumbnail} alt="" />
                          <div className="queue-track-meta"><h4>{t.title}</h4><span>{t.artist}</span></div>
                          <div className="queue-track-duration">{t.duration}</div>
                        </div>
                      ))
                  }
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <AuthWizard
        show={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        authStatus={authStatus}
        onLogout={logout}
        onSuccess={() => checkAuthStatus()}
      />

      <SpotifyAuthWizard
        show={showSpotifyModal}
        onClose={() => setShowSpotifyModal(false)}
        spotifyAuth={spotifyAuth}
        onLogout={logoutSpotify}
        onSuccess={() => checkSpotifyStatus()}
      />

      {/* Sleep Timer Modal */}
      {showSleepModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowSleepModal(false)}>
          <div className="modal-card glass-panel animate-in" style={{ maxWidth: 360 }}>
            <div className="modal-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Timer size={18} /> Sleep Timer</h2>
              <button className="close-btn" onClick={() => setShowSleepModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body" style={{ gap: 12 }}>
              <p>Pausar la reproducción automáticamente después de:</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[5, 10, 15, 30, 45, 60].map(m => (
                  <button key={m} className="action-btn" style={{ background: sleepTimer?.remaining && Math.ceil(sleepTimer.remaining/60) <= m ? 'var(--accent-gradient)' : 'rgba(255,255,255,0.06)', color: 'var(--text-primary)', boxShadow: 'none', border: '1px solid var(--panel-border)' }} onClick={() => activateSleepTimer(m)}>
                    {m} min
                  </button>
                ))}
              </div>
              {sleepTimer && (
                <div style={{ textAlign: 'center', padding: '8px', borderRadius: 12, background: 'rgba(255,255,255,0.05)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Pausa en: {Math.floor(sleepTimer.remaining/60)}:{String(sleepTimer.remaining%60).padStart(2,'0')}
                </div>
              )}
              {sleepTimer && (
                <button className="action-btn danger-btn" onClick={() => activateSleepTimer(0)}>Cancelar timer</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Stats Modal */}
      {showStatsModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowStatsModal(false)}>
          <div className="modal-card glass-panel animate-in" style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <h2>Estadísticas de escucha</h2>
              <button className="close-btn" onClick={() => setShowStatsModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              {(() => {
                try {
                  const stats = JSON.parse(localStorage.getItem('rsp_stats') || '{}');
                  const sorted = Object.values(stats).sort((a,b) => b.count - a.count).slice(0, 20);
                  if (!sorted.length) return <p>Aún no hay canciones reproducidas.</p>;
                  return sorted.map((s, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--panel-border)' }}>
                      <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-muted)', width: 24, textAlign: 'right' }}>{i+1}</span>
                      <img src={s.thumbnail} alt="" style={{ width: 38, height: 38, borderRadius: 6, objectFit: 'cover' }} />
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{s.artist}</div>
                      </div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>{s.count}×</div>
                    </div>
                  ));
                } catch { return <p>Error cargando estadísticas.</p>; }
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, padding: '12px 24px',
          borderRadius: 12, fontSize: '0.85rem', fontWeight: 550, zIndex: 1000,
          background: toast.isError ? 'linear-gradient(135deg, hsl(0,84%,60%), hsl(340,80%,45%))' : 'rgba(255,255,255,0.95)',
          color: toast.isError ? 'white' : 'black',
          boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
          animation: 'modalSlideUp 0.3s ease'
        }}>{toast.message}</div>
      )}
    </>
  );
}
