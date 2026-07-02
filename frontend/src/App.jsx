import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  Play, Pause, SkipForward, SkipBack, Heart,
  Settings, Search, Music, Link2, ListMusic, X,
  RefreshCw, Volume2, Volume1, Volume, VolumeX, Tv, Lock, ChevronRight,
  Sun, Moon, Timer, BarChart2, Minimize2, Maximize2, Zap, Loader2, Repeat1, Keyboard, ListPlus, Trash2, Radio, Sliders, Headphones,
  Sparkles, Folder, FolderOpen
} from 'lucide-react';
import './index.css';
import { cachePlaylist, getCachedPlaylist } from './utils/playlistCache.js';
import { hiResArt } from './utils/art.js';
import AuthWizard from './components/auth/AuthWizard';
import SpotifyAuthWizard from './components/auth/SpotifyAuthWizard';
import LoginScreen from './auth/LoginScreen';
import { apiMe, apiLogout } from './auth/apiClient';
import VirtualList from './components/ui/VirtualList';
import Logo from './components/ui/Logo';
import { SkeletonRows, EmptyState } from './components/ui/Skeleton';
import SleepTimerModal from './components/modals/SleepTimerModal';
import StatsModal from './components/modals/StatsModal';
import ShortcutsModal from './components/modals/ShortcutsModal';
import FavoritesModal from './components/modals/FavoritesModal';
import AssistantModal from './components/modals/AssistantModal';
import SavedListsModal from './components/modals/SavedListsModal';
import CreatePlaylistModal from './components/modals/CreatePlaylistModal';
import NowPlaying from './components/player/NowPlaying';
import Visualizer from './components/player/Visualizer';
import EqualizerModal from './components/modals/EqualizerModal';
import QualityModal from './components/modals/QualityModal';

const SESSION_KEY = 'rsp_session_v1';
// Frecuencias centrales de las 5 bandas del ecualizador (Web Audio).
const EQ_FREQS = [60, 230, 910, 3600, 14000];

// "3:45" o "1:03:45" → segundos. Vacío/no numérico → 0.
function durToSecs(d) {
  if (!d || typeof d !== 'string') return 0;
  const parts = d.split(':').map((n) => parseInt(n, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

// Segundos → "3 h 42 min" / "42 min" / "2 min".
function fmtLong(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h > 0) return `${h} h${m ? ` ${m} min` : ''}`;
  return `${Math.max(1, m)} min`;
}

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
  // Fuente de la pestaña Buscar: 'youtube' (por defecto) o 'spotify'.
  const [searchSource, setSearchSource] = useState('youtube');
  const [isFavorite, setIsFavorite] = useState(false);
  // Repetir la canción actual.
  const [repeatOne, setRepeatOne] = useState(false);
  const repeatOneRef = useRef(false);
  // Favoritos locales (persisten): mapa { trackId: track }. El ♥ los gestiona.
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('rsp_favorites') || '{}'); } catch { return {}; }
  });
  const favoritesRef = useRef(favorites);
  // Overlay de atajos de teclado.
  const [showShortcuts, setShowShortcuts] = useState(false);
  // Menú "Ajustes" del footer del sidebar (colapsado por defecto).
  const [showSettings, setShowSettings] = useState(false);
  // Gestor de favoritas.
  const [showFavManager, setShowFavManager] = useState(false);
  // Velocidad de reproducción (YT + audio directo; Spotify no lo soporta).
  const [playbackRate, setPlaybackRate] = useState(1);
  const playbackRateRef = useRef(1);
  // Mostrar tiempo restante en vez de duración total.
  const [showRemaining, setShowRemaining] = useState(false);
  const [playlistTitle, setPlaylistTitle] = useState('Ninguna playlist seleccionada');

  // Auth — YouTube Music
  const [authStatus, setAuthStatus] = useState({ authenticated: false, oauth_exists: false });
  const [playlists, setPlaylists] = useState([]);
  // Playlists de YouTube "normal" (no Music) — incluyen videos no-musicales
  const [youtubePlaylists, setYoutubePlaylists] = useState([]);
  const [ytPlaylistsLoaded, setYtPlaylistsLoaded] = useState(false);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(null);
  // Organización de la biblioteca por categoría (género/tipo) asignada por la IA.
  // playlistCats: { [playlistId]: { category, emoji } } · persistido en localStorage.
  const [playlistCats, setPlaylistCats] = useState(() => {
    try { return JSON.parse(localStorage.getItem('playlistCats') || '{}'); } catch { return {}; }
  });
  const [collapsedCats, setCollapsedCats] = useState(() => {
    try { return JSON.parse(localStorage.getItem('collapsedCats') || '{}'); } catch { return {}; }
  });
  // Orden de categorías por afinidad musical (lo sugiere la IA); [] = alfabético.
  const [catOrder, setCatOrder] = useState(() => {
    try { return JSON.parse(localStorage.getItem('catOrder') || '[]'); } catch { return []; }
  });
  const [groupByCat, setGroupByCat] = useState(() => localStorage.getItem('groupByCat') === '1');
  const [catLoading, setCatLoading] = useState(false);
  const [plFilter, setPlFilter] = useState(''); // filtro de texto de la biblioteca (no persistido)
  const dragPlIdRef = useRef(null); // id de la playlist que se está arrastrando entre categorías
  const [showCreatePl, setShowCreatePl] = useState(false); // modal "crear playlist y subir"
  const [externalId, setExternalId] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Spotify
  const [playerMode, setPlayerMode] = useState('youtube'); // 'youtube' | 'spotify'
  const [spotifyAuth, setSpotifyAuth] = useState({ authenticated: false, token_exists: false });
  const [spotifyPlaylists, setSpotifyPlaylists] = useState([]);
  const [spotifyPlLoading, setSpotifyPlLoading] = useState(false);
  const [spotifyPlError, setSpotifyPlError] = useState(null);
  const [spotifyRetryIn, setSpotifyRetryIn] = useState(null); // cuenta regresiva 429 (s)
  const spotifyRetryTimer = useRef(null);
  const retryRemainingRef = useRef(0);
  const [showSpotifyModal, setShowSpotifyModal] = useState(false);

  // App auth (multi-usuario): undefined = comprobando, null = sin login, objeto = usuario
  const [appUser, setAppUser] = useState(undefined);

  // Toast
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  // Feature: Dark/Light Mode
  const [theme, setTheme] = useState(() => localStorage.getItem('rsp_theme') || 'dark');
  // Color dominante de la carátula (para teñir el fondo ambiental). h/s en grados/%.
  const [ambientColor, setAmbientColor] = useState({ h: 0, s: 72 });
  // Pestaña activa en móvil (barra inferior): una vista a la vez. Ignorado en desktop (CSS).
  const [mobileTab, setMobileTab] = useState('player'); // 'player' | 'library' | 'queue'
  // Smart-play: reproducir pistas de Spotify vía YouTube (sin Premium, inmune a 429).
  const [spotifyViaYoutube, setSpotifyViaYoutube] = useState(() => localStorage.getItem('rsp_sp_via_yt') !== '0');
  const spotifyViaYoutubeRef = useRef(true);
  const ytMatchCacheRef = useRef(new Map()); // uri/clave → pista YT resuelta (caché de sesión)

  // Feature: Sleep Timer
  const [sleepTimer, setSleepTimer] = useState(null); // null | { remaining: number }
  const [showSleepModal, setShowSleepModal] = useState(false);
  const sleepTimerRef = useRef(null);

  // Feature: Play Statistics
  const [showStatsModal, setShowStatsModal] = useState(false);

  // Feature: Compact Mode
  const [isCompact, setIsCompact] = useState(false);

  // Asistente IA (Gemini): recomienda, organiza y crea listas desde una playlist
  const [showAssistant, setShowAssistant] = useState(false);
  const [assistantSource, setAssistantSource] = useState(null);

  // Mis Listas: guarda la lista cargada (cualquier servicio) y reproduce desde la copia
  const [showSavedLists, setShowSavedLists] = useState(false);

  // Vista Now Playing (pantalla completa) + motor de reproducción activo (para el chip)
  const [showNowPlaying, setShowNowPlaying] = useState(false);
  const [engine, setEngine] = useState('youtube'); // 'youtube' | 'audio' | 'spotify'
  const [isBuffering, setIsBuffering] = useState(false); // feedback de carga/recuperación
  const [playlistLoading, setPlaylistLoading] = useState(false); // overlay de "cargando lista"
  const [unavailableCount, setUnavailableCount] = useState(0); // pistas no disponibles de la playlist cargada

  // Feature: Crossfade
  const [crossfade, setCrossfade] = useState(true);
  const crossfadeRef = useRef(true);
  const fadeIntervalRef = useRef(null);

  // Feature: Priority Queue
  const [priorityQueue, setPriorityQueue] = useState([]);
  const priorityQueueRef = useRef([]);

  // Feature: Radio infinita (autoplay) — cuando la bolsa se agota, anexa temas
  // relacionados (cola automix de YT Music) para que la música no pare.
  const [radioMode, setRadioMode] = useState(() => localStorage.getItem('rsp_radio') === '1');
  const radioModeRef = useRef(radioMode);
  const radioFetchingRef = useRef(false); // evita peticiones de radio solapadas
  const [radioLoading, setRadioLoading] = useState(false);

  // Rebarajar: feedback visual (giro del icono + resalte del contador "Quedan").
  const [reshuffling, setReshuffling] = useState(false);
  const [bagFlash, setBagFlash] = useState(false);

  // Feature: Modo Hi-Fi + Ecualizador (Web Audio) — solo aplica al motor de audio
  // directo (proxy same-origin, sin taint). Activarlo fuerza ese motor para YouTube.
  const [eqEnabled, setEqEnabled] = useState(() => localStorage.getItem('rsp_eq_on') === '1');
  const eqEnabledRef = useRef(eqEnabled);
  const hifiModeRef = useRef(eqEnabled); // Hi-Fi = forzar audio directo (ligado al EQ)
  const [eqBands, setEqBands] = useState(() => {
    try {
      const b = JSON.parse(localStorage.getItem('rsp_eq') || 'null');
      return Array.isArray(b) && b.length === EQ_FREQS.length ? b : EQ_FREQS.map(() => 0);
    } catch { return EQ_FREQS.map(() => 0); }
  });
  const audioCtxRef = useRef(null);
  const eqNodesRef = useRef(null); // { ctx, source, filters: [], normGain }
  const normGainRef = useRef(null); // GainNode para la normalización de volumen
  const [showEq, setShowEq] = useState(false);
  // Normalización de volumen (ReplayGain): iguala el loudness entre pistas. Como el
  // EQ, opera en el grafo Web Audio → requiere el modo Hi-Fi (audio directo).
  const [normalizeEnabled, setNormalizeEnabled] = useState(() => localStorage.getItem('rsp_norm') === '1');
  const normalizeEnabledRef = useRef(normalizeEnabled);

  // Feature: Comparador de calidad + A/B de escucha (Spotify vs YouTube).
  const [showQuality, setShowQuality] = useState(false);
  const [qualityCtx, setQualityCtx] = useState(null); // { ytId, spotifyUri, title, artist, source }

  // Refs for player
  const ytPlayerRef = useRef(null);
  const audioRef = useRef(null);
  const usingFallbackRef = useRef(false);
  const progressTimerRef = useRef(null);
  const ytReadyRef = useRef(false);
  const skipDebounceRef = useRef(false);
  // <audio> silencioso que "ancla" la MediaSession a nuestra página (ver ensureMediaAnchor).
  const mediaAnchorRef = useRef(null);
  // Auto-conexión de YouTube: se desactiva tras una desconexión explícita del
  // usuario; el timestamp limita la frecuencia de captura (revalidación periódica).
  const ytAutoConnectDisabledRef = useRef(false);
  const lastCaptureAttemptRef = useRef(0);
  // Throttle para la revalidación al volver el foco a la pestaña.
  const lastVisibilityRevalidateRef = useRef(0);
  // Prefetch: id de la última pista cuya URL de audio ya pedimos calentar.
  const lastPrefetchedRef = useRef(null);
  // Recuperación de stalls del audio de respaldo.
  const stallTimerRef = useRef(null);
  const stallCountRef = useRef(0);
  // Red de seguridad anti-silencio: cortacircuitos de fallos consecutivos, watchdog
  // del IFrame (detecta reproducción "pegada"), y confirmación de que YT arrancó.
  const consecutiveFailuresRef = useRef(0);
  const ytWatchdogRef = useRef(null);
  const ytConfirmedRef = useRef(false);
  const breakerTrippedRef = useRef(false);
  // Pistas que fallaron (borradas/no disponibles): se auto-saltan en la sesión.
  const deadTracksRef = useRef(new Set());
  // Reanudar donde lo dejaste: posición pendiente + si ya arrancó la reproducción.
  const pendingResumeRef = useRef(null);
  const startedRef = useRef(false);
  const lastTimeRef = useRef(0);

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
  useEffect(() => { repeatOneRef.current = repeatOne; }, [repeatOne]);
  useEffect(() => {
    radioModeRef.current = radioMode;
    try { localStorage.setItem('rsp_radio', radioMode ? '1' : '0'); } catch { /* cuota */ }
  }, [radioMode]);
  useEffect(() => {
    eqEnabledRef.current = eqEnabled;
    try { localStorage.setItem('rsp_eq_on', eqEnabled ? '1' : '0'); } catch { /* cuota */ }
  }, [eqEnabled]);
  useEffect(() => {
    normalizeEnabledRef.current = normalizeEnabled;
    try { localStorage.setItem('rsp_norm', normalizeEnabled ? '1' : '0'); } catch { /* cuota */ }
  }, [normalizeEnabled]);
  useEffect(() => {
    // Hi-Fi (forzar audio directo) si está activo el EQ o la normalización.
    hifiModeRef.current = eqEnabled || normalizeEnabled;
  }, [eqEnabled, normalizeEnabled]);
  useEffect(() => {
    try { localStorage.setItem('rsp_eq', JSON.stringify(eqBands)); } catch { /* cuota */ }
    applyEqGains(eqBands);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eqBands]);
  useEffect(() => { playbackRateRef.current = playbackRate; }, [playbackRate]);
  useEffect(() => {
    favoritesRef.current = favorites;
    try { localStorage.setItem('rsp_favorites', JSON.stringify(favorites)); } catch { /* cuota */ }
  }, [favorites]);
  useEffect(() => {
    try { localStorage.setItem('playlistCats', JSON.stringify(playlistCats)); } catch { /* cuota */ }
  }, [playlistCats]);
  useEffect(() => {
    try { localStorage.setItem('collapsedCats', JSON.stringify(collapsedCats)); } catch { /* cuota */ }
  }, [collapsedCats]);
  useEffect(() => {
    try { localStorage.setItem('catOrder', JSON.stringify(catOrder)); } catch { /* cuota */ }
  }, [catOrder]);
  useEffect(() => {
    try { localStorage.setItem('groupByCat', groupByCat ? '1' : '0'); } catch { /* cuota */ }
  }, [groupByCat]);

  // Feature: Touch gestures
  const touchStartRef = useRef(null);

  // --- Toast ---
  const showToast = useCallback((message, isError = false) => {
    clearTimeout(toastTimerRef.current);
    setToast({ message, isError });
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  // --- Web Audio: grafo del ecualizador ---
  // Crea (una sola vez) AudioContext + MediaElementSource sobre el <audio> y una
  // cadena de BiquadFilters. El audio directo se sirve por proxy same-origin, así
  // que el nodo NO queda "tainted" y el EQ suena. Tras crearlo, el audio del
  // elemento sale SIEMPRE por el grafo → con ganancias a 0 es transparente.
  const ensureEqGraph = () => {
    if (eqNodesRef.current) return eqNodesRef.current;
    const audio = audioRef.current;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!audio || !Ctx) return null;
    try {
      const ctx = new Ctx();
      const source = ctx.createMediaElementSource(audio);
      const filters = EQ_FREQS.map((freq, i) => {
        const f = ctx.createBiquadFilter();
        f.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
        f.frequency.value = freq;
        f.Q.value = 1.0;
        f.gain.value = 0;
        return f;
      });
      // Cadena: source → filtros EQ → gain de normalización → destino.
      const normGain = ctx.createGain();
      normGain.gain.value = 1;
      let node = source;
      for (const f of filters) { node.connect(f); node = f; }
      node.connect(normGain);
      normGain.connect(ctx.destination);
      audioCtxRef.current = ctx;
      normGainRef.current = normGain;
      eqNodesRef.current = { ctx, source, filters, normGain };
      return eqNodesRef.current;
    } catch (e) {
      console.warn('EQ: no se pudo crear el grafo de audio:', e?.message);
      return null;
    }
  };

  const applyEqGains = (bands) => {
    const g = eqNodesRef.current;
    if (!g) return;
    bands.forEach((val, i) => { if (g.filters[i]) g.filters[i].gain.value = val; });
  };

  // Nivela el volumen de la pista actual: gain = 10^(-loudnessDb/20), acotado.
  const applyNormalization = async (videoId) => {
    const norm = normGainRef.current;
    if (!normalizeEnabledRef.current || !norm || !videoId) return;
    try {
      const r = await fetch(`/api/loudness/${videoId}`);
      if (!r.ok) return;
      const { loudnessDb } = await r.json();
      const gain = loudnessDb == null ? 1 : Math.max(0.3, Math.min(3, Math.pow(10, -loudnessDb / 20)));
      const ctx = eqNodesRef.current?.ctx;
      try { norm.gain.setTargetAtTime(gain, ctx ? ctx.currentTime : 0, 0.25); }
      catch { norm.gain.value = gain; }
    } catch { /* best-effort */ }
  };

  const resumeAudioCtx = () => {
    const ctx = eqNodesRef.current?.ctx;
    if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch { /* ignore */ } }
  };

  // Posición de reproducción actual sin importar el motor (para conmutar sin saltos).
  const getCurrentPlaybackTime = () => {
    try {
      if (usingFallbackRef.current && audioRef.current) return audioRef.current.currentTime || 0;
      if (ytPlayerRef.current && ytReadyRef.current) return ytPlayerRef.current.getCurrentTime() || 0;
    } catch { /* ignore */ }
    return 0;
  };

  const getEngineDuration = () => {
    try {
      if (usingFallbackRef.current && audioRef.current && isFinite(audioRef.current.duration)) return audioRef.current.duration || 0;
      if (ytPlayerRef.current && ytReadyRef.current) return ytPlayerRef.current.getDuration?.() || 0;
    } catch { /* ignore */ }
    return 0;
  };

  // Seek genérico a un instante (segundos) en el motor activo. Ref-safe: lo usan los
  // controles de la pantalla de bloqueo (Media Session) además de la barra de progreso.
  const seekToSeconds = (t) => {
    const dur = getEngineDuration();
    const clamped = dur > 0 ? Math.max(0, Math.min(t, dur)) : Math.max(0, t);
    if (playerModeRef.current === 'spotify' && spotifyPlayerRef.current) spotifyPlayerRef.current.seek(Math.round(clamped * 1000));
    else if (usingFallbackRef.current && audioRef.current) audioRef.current.currentTime = clamped;
    else if (ytPlayerRef.current && ytReadyRef.current) ytPlayerRef.current.seekTo(clamped, true);
    setCurrentTime(clamped); lastTimeRef.current = clamped;
    updateMediaPositionState(clamped, dur); // refleja el salto en el scrubber del lockscreen al instante
  };

  // Publica la posición en la sesión multimedia del SO (scrubber en la pantalla de bloqueo).
  const updateMediaPositionState = (position, dur) => {
    if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;
    if (!dur || !isFinite(dur) || dur <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: dur,
        position: Math.max(0, Math.min(position, dur)),
        playbackRate: playbackRateRef.current || 1,
      });
    } catch { /* ignore */ }
  };

  // Crea (una sola vez) el <audio> silencioso que ancla la sesión multimedia.
  // Con el motor de YouTube el audio suena en un IFrame cross-origin y Android
  // atribuiría los controles del lockscreen a la sesión de *YouTube* (título del
  // vídeo, botones que no llaman a nuestro shuffle). Reproduciendo una pista
  // silenciosa en NUESTRO documento, Chrome muestra NUESTRA sesión (metadata +
  // handlers). El audio directo y Spotify ya viven en la página, así que no lo usan.
  const ensureMediaAnchor = () => {
    if (!mediaAnchorRef.current) {
      const el = new Audio('/silence.wav');
      el.loop = true;
      el.preload = 'auto';
      mediaAnchorRef.current = el;
    }
    return mediaAnchorRef.current;
  };

  // --- Spotify SDK ---
  const loadSpotifySDK = () => {
    if (window.Spotify?.Player) { initSpotifyPlayer(); return; }
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    document.body.appendChild(s);
    window.onSpotifyWebPlaybackSDKReady = initSpotifyPlayer;
  };

  // El Web Playback SDK de Spotify exige DRM (Widevine/EME). En Firefox hay que
  // habilitarlo; sin él el dispositivo nunca queda "ready" (authentication_error).
  const checkDrmSupport = async () => {
    if (!navigator.requestMediaKeySystemAccess) return false;
    try {
      await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{
        initDataTypes: ['cenc'],
        audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
      }]);
      return true;
    } catch {
      return false;
    }
  };

  const initSpotifyPlayer = async () => {
    try {
      const res = await fetch('/api/spotify/token');
      if (!res.ok) return;
      await res.json();

      // Aviso temprano y accionable si el navegador no tiene DRM (causa típica en Firefox).
      if (!(await checkDrmSupport())) {
        showToast('Para reproducir Spotify, tu navegador necesita DRM. En Firefox: Ajustes → "Reproducir contenido controlado por DRM"; o abre la app en Chrome/Edge.', true);
      }

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
        showToast('Spotify no pudo iniciar el reproductor. Suele ser DRM: en Firefox activa "Reproducir contenido controlado por DRM" (Ajustes) o usa Chrome/Edge.', true);
      });
      player.addListener('account_error', ({ message }) => {
        console.error('[Spotify] Account error:', message);
        showToast('Spotify Premium requerido para el reproductor integrado', true);
      });
      player.addListener('playback_error', ({ message }) => {
        console.error('[Spotify] Playback error:', message);
        // En modo bolsa propia, una pista que Spotify no puede reproducir (no disponible
        // en tu país, etc.) no debe dejar el reproductor en silencio: pasa a la siguiente.
        if (playerModeRef.current === 'spotify' && allRef.current.length > 0) {
          failCurrentAndAdvance('Una canción de Spotify no se pudo reproducir. Pasando a la siguiente…');
        }
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
          onTrackEnded();
          return;
        }
        if (state.paused) { setIsPlaying(false); stopProgressTimer(); }
        else { setIsPlaying(true); startProgressTimer('spotify'); setEngine('spotify'); markPlaybackStarted(); }
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
      showToast('Spotify no está listo. Si usas Firefox, activa el DRM (Ajustes → "Reproducir contenido controlado por DRM") o usa Chrome/Edge; también cierra otras sesiones de Spotify activas o recarga la página.', true);
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

  const checkSpotifyStatus = async ({ attempt = 0 } = {}) => {
    try {
      const res = await fetch('/api/spotify/status');
      // Backend aún arrancando → 5xx/error del proxy: reintentar (abajo) en vez de rendirse.
      if (!res.ok) throw new Error(`status ${res.status}`);
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
      // Mismo caso que checkAuthStatus: espera al backend con backoff y carga las
      // playlists de Spotify sin necesidad de recargar la página.
      if (attempt < 8) {
        await new Promise((r) => setTimeout(r, Math.min(5000, 300 * 2 ** attempt)));
        return checkSpotifyStatus({ attempt: attempt + 1 });
      }
      console.error('Spotify status check failed tras reintentos:', e);
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
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      // 429 (rate limit) o 5xx → esperar y reintentar. Si Spotify expone
      // Retry-After lo respeta; si no, backoff exponencial (tope 15 s).
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        const ra = Number(res.headers.get('retry-after'));
        const secs = Number.isFinite(ra) && ra > 0 ? ra : 2 ** attempt;
        await new Promise((r) => setTimeout(r, Math.min(secs, 15) * 1000));
        continue;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = body?.error?.message || res.statusText;
        throw new Error(`Spotify ${res.status}: ${msg}`);
      }
      return [await res.json(), token];
    }
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

  // Aplica el estado de rate-limit: bloqueo largo (>10 min) muestra ETA y NO reintenta
  // en bucle; bloqueo corto hace cuenta regresiva + reintento automático.
  const applyRateLimit = (secs) => {
    clearInterval(spotifyRetryTimer.current);
    if (!secs || secs <= 0) { setSpotifyRetryIn(null); return; }
    if (secs > 600) {
      setSpotifyRetryIn(null);
      const eta = secs >= 3600 ? `~${Math.round(secs / 3600)} h` : `~${Math.ceil(secs / 60)} min`;
      setSpotifyPlError(`Spotify bloqueó la app por exceso de peticiones (429). Se libera en ${eta}. Usa tus listas ya guardadas o YouTube Music mientras tanto.`);
      return;
    }
    setSpotifyPlError(null);
    retryRemainingRef.current = secs;
    setSpotifyRetryIn(secs);
    spotifyRetryTimer.current = setInterval(() => {
      retryRemainingRef.current -= 1;
      if (retryRemainingRef.current <= 0) {
        clearInterval(spotifyRetryTimer.current);
        setSpotifyRetryIn(null);
        fetchSpotifyPlaylists();
      } else {
        setSpotifyRetryIn(retryRemainingRef.current);
      }
    }, 1000);
  };

  const fetchSpotifyPlaylists = async () => {
    // Si ya sabemos que Spotify nos limitó, no le pegamos más (evita alargar el bloqueo).
    try {
      const j = await (await fetch('/api/spotify/ratelimit')).json();
      if (j?.limited && j.retryAfter > 0) { applyRateLimit(j.retryAfter); return; }
    } catch { /* ignore */ }
    setSpotifyPlLoading(true);
    setSpotifyPlError(null);
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
          // Feb-2026: Spotify renombró `tracks` → `items` en el objeto playlist.
          count: (p.items ?? p.tracks)?.total || 0,
          thumbnail: p.images?.[0]?.url || '',
        })));
        if (items.length < 50 || !data.next) break;
        offset += 50;
      }
      setSpotifyPlaylists(all);
      setSpotifyPlError(null);
      setSpotifyRetryIn(null);
    } catch (e) {
      console.error('fetchSpotifyPlaylists:', e);
      if (/429/.test(e.message)) {
        // Mide el Retry-After real (sonda en el backend) y muestra ETA o cuenta regresiva.
        let secs = 0;
        try { const j = await (await fetch('/api/spotify/ratelimit?measure=1')).json(); secs = Number(j?.retryAfter) || 0; } catch { /* ignore */ }
        if (secs > 0) applyRateLimit(secs);
        else setSpotifyPlError('Spotify está limitando peticiones (429). Espera un momento y reintenta.');
      } else {
        setSpotifyPlError('No se pudieron cargar tus playlists de Spotify.');
      }
    } finally {
      setSpotifyPlLoading(false);
    }
  };

  const playSpotifyContext = async (contextUri, displayTitle, _retry = false) => {
    if (!spotifyDeviceIdRef.current || !spotifyReadyRef.current) {
      if (!_retry && spotifyPlayerRef.current) {
        showToast('Reconectando Spotify…', false);
        spotifyPlayerRef.current.connect();
        if (await waitForSpotifyReady()) return playSpotifyContext(contextUri, displayTitle, true);
      }
      showToast('Spotify no está listo. Si usas Firefox, activa el DRM (Ajustes → "Reproducir contenido controlado por DRM") o usa Chrome/Edge; también cierra otras sesiones de Spotify activas o recarga la página.', true);
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
        stopYouTubePlayback(); // que no quede YouTube sonando en paralelo
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
    if (!merge) { setPlaylistTitle(`Cargando '${title}'…`); setPlaylistLoading(true); }
    try {
      let token = null;
      const [pl, tok] = await spotifyApiFetch(`/playlists/${id}`, { market: 'from_token' }, null);
      token = tok;
      const playlistName = pl.name || title;
      // Feb-2026: Spotify renombró el contenido de la playlist `tracks` → `items`, y
      // cada elemento `.track` → `.item`. Soportamos ambas formas por robustez.
      const contents = pl.items ?? pl.tracks;
      const total = contents?.total || 0;

      // Cache-first: si ya está (casi) completa en la DB, úsala SIN paginar Spotify.
      try {
        const cr = await fetch(`/api/library/synced/spotify/${id}`);
        if (cr.ok) {
          const cd = await cr.json();
          if (cd.tracks?.length && total > 0 && cd.tracks.length >= total * 0.85) {
            if (merge) addToShuffleBag(cd.tracks, playlistName);
            else { setPlayerMode('spotify'); playerModeRef.current = 'spotify'; initShuffleBag(cd.tracks, playlistName); }
            return;
          }
        }
      } catch { /* sin caché → carga en vivo */ }

      const tracks = [];
      const pushItems = (items) => {
        for (const item of items || []) {
          const t = item?.item ?? item?.track;
          if (t && t.type === 'track' && t.uri) tracks.push(fmtSpotifyTrack(t));
        }
      };
      // El objeto /playlists/{id} suele traer los primeros 100 tracks inline.
      pushItems(contents?.items);

      // Pagina el resto vía /items (antes /tracks; retirado en mar-2026 para apps en
      // Development Mode). Si está bloqueado (403/404) conservamos los inline.
      let tracksBlocked = false;
      try {
        let offset = contents?.items?.length || 0;
        let hasMore = !!contents?.next;
        while (hasMore && tracks.length < total) {
          if (!merge) setPlaylistTitle(`Cargando '${playlistName}' (${tracks.length}/${total})…`);
          const [data, t2] = await spotifyApiFetch(`/playlists/${id}/items`, { limit: 100, offset, market: 'from_token' }, token);
          token = t2;
          const items = data.items || [];
          pushItems(items);
          hasMore = items.length === 100 && !!data.next;
          offset += 100;
        }
      } catch (e) {
        if (e.message.includes('403') || e.message.includes('404')) tracksBlocked = true;
        else throw e;
      }

      // Si no se pudo leer NADA (ni inline), caemos a reproducción en directo abajo.
      if (!tracks.length) throw new Error('Spotify 403: canciones no accesibles');

      if (tracksBlocked && tracks.length < total) {
        showToast(`Cargadas ${tracks.length} de ${total} canciones (Spotify limita el resto para esta app).`, false);
      }

      // Cacheo on-demand: guarda la copia completa en la DB para próximas veces
      // (luego se carga desde ahí sin volver a pedir a Spotify).
      if (!tracksBlocked) {
        fetch('/api/library/cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'spotify', providerId: id, title: playlistName, thumbnail: pl.images?.[0]?.url || '', tracks }),
        }).catch(() => {});
      }

      if (merge) {
        addToShuffleBag(tracks, playlistName);
      } else {
        setPlayerMode('spotify');
        playerModeRef.current = 'spotify';
        initShuffleBag(tracks, playlistName);
      }
    } catch (e) {
      // Tras la migración de feb-2026, Spotify solo entrega las pistas de playlists
      // PROPIAS o colaborativas. Para editoriales/algorítmicas o de otros usuarios
      // (Discover Weekly, Daily Mix…) devuelve solo metadata → solo reproducción en
      // directo (shuffle nativo), sin mezclar pista a pista ni verlas en la bolsa.
      const blocked = e.message.includes('403') || e.message.includes('404');
      if (blocked) {
        if (merge) {
          showToast('No se puede mezclar: Spotify solo entrega las pistas de tus playlists propias o colaborativas. Las editoriales o de otros usuarios (Discover Weekly, etc.) solo se pueden reproducir en directo.', true);
          return;
        }
        showToast(`Esa playlist no se puede leer por la API; reproduciendo en directo '${title}'`, false);
        await playSpotifyContext(`spotify:playlist:${id}`, title);
      } else if (e.message.includes('401')) {
        showToast('Sesión de Spotify caducada. Desconecta y vuelve a conectar tu cuenta.', true);
        if (!merge) setPlaylistTitle('Error');
      } else {
        showToast(e.message, true);
        if (!merge) setPlaylistTitle('Error');
      }
    } finally {
      if (!merge) setPlaylistLoading(false);
    }
  };

  const loadSpotifyLiked = async (merge = false) => {
    if (!merge) setSelectedPlaylistId('spotify:liked');
    if (!merge) { setPlaylistTitle('Cargando favoritos de Spotify…'); setPlaylistLoading(true); }
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
    finally { if (!merge) setPlaylistLoading(false); }
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
      // Reanudar donde lo dejaste: si hay posición guardada para la pista actual.
      try {
        const r = JSON.parse(localStorage.getItem('rsp_resume') || 'null');
        if (r && current && r.id === current.id && r.t > 5) pendingResumeRef.current = r;
      } catch { /* ignore */ }
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
      clearTimeout(stallTimerRef.current);
      clearTimeout(ytWatchdogRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cargar estado de proveedores una vez autenticado en la app
  useEffect(() => {
    if (!appUser) return;
    checkAuthStatus();
    checkSpotifyStatus();
    // Watchdog: revalida la cookie de YouTube Music cada 5 min y la renueva sola
    // desde Firefox si caducó (silencioso, sin recargar playlists si sigue activa).
    const iv = setInterval(() => checkAuthStatus({ silent: true }), 5 * 60 * 1000);
    // También revalida al volver el foco a la pestaña (p.ej. tras suspender el
    // equipo horas), con throttle de 60 s para no repetir al alternar pestañas.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastVisibilityRevalidateRef.current < 60 * 1000) return;
      lastVisibilityRevalidateRef.current = now;
      checkAuthStatus({ silent: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisible);
    };
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
    setYoutubePlaylists([]);
    setYtPlaylistsLoaded(false);
    // Próximo login podrá auto-conectar de nuevo.
    ytAutoConnectDisabledRef.current = false;
    lastCaptureAttemptRef.current = 0;
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
    keyHandlerRef.current = {
      doNextTrack, doPrevTrack, togglePlayPause, toggleMute, applyVolume,
      toggleShortcuts: () => setShowShortcuts((s) => !s),
      toggleRepeat: () => setRepeatOne((r) => !r),
    };
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
        case 'KeyR':
          h.toggleRepeat();
          break;
        case 'Slash':
          if (e.shiftKey) { e.preventDefault(); h.toggleShortcuts(); }
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

  // Smart-play: persistir preferencia + sincronizar ref.
  useEffect(() => {
    spotifyViaYoutubeRef.current = spotifyViaYoutube;
    localStorage.setItem('rsp_sp_via_yt', spotifyViaYoutube ? '1' : '0');
  }, [spotifyViaYoutube]);

  // Feature: Theme toggle persistence
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('rsp_theme', theme);
  }, [theme]);

  // Feature: Acento dinámico — tiñe la UI con el color dominante de la carátula.
  useEffect(() => {
    const url = currentTrack?.thumbnail;
    const root = document.documentElement;
    if (!url) { root.style.removeProperty('--accent'); root.style.removeProperty('--accent-glow'); return; }
    let cancelled = false;
    const rgbToHsl = (r, g, b) => {
      r /= 255; g /= 255; b /= 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      let h = 0; const l = (max + min) / 2;
      const d = max - min;
      const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
      if (d !== 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60; if (h < 0) h += 360;
      }
      return [h, s * 100, l * 100];
    };
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      try {
        const c = document.createElement('canvas');
        const w = (c.width = 16), h = (c.height = 16);
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 125) continue; // ignora píxeles transparentes
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
        if (!n) return;
        const [hue, sat, lum] = rgbToHsl(Math.round(r / n), Math.round(g / n), Math.round(b / n));
        // Clamp de saturación/luminosidad para que el acento siempre tenga buen contraste.
        const H = Math.round(hue);
        const S = Math.round(Math.max(55, Math.min(85, sat)));
        const L = Math.round(Math.max(45, Math.min(60, lum)));
        root.style.setProperty('--accent', `hsl(${H}, ${S}%, ${L}%)`);
        // El halo/glow también reacciona al álbum (antes era rojo fijo) → todo coherente.
        root.style.setProperty('--accent-glow', `hsla(${H}, ${S}%, ${L}%, 0.5)`);
        // El fondo ambiental usa el mismo tono (con saturación acotada) en vez del rojo fijo.
        if (!cancelled) setAmbientColor({ h: Math.round(hue), s: Math.round(Math.max(45, Math.min(78, sat))) });
      } catch {
        /* carátula sin CORS → canvas "tainted"; se mantiene el acento del tema */
      }
    };
    img.onerror = () => {};
    img.src = url;
    return () => { cancelled = true; };
  }, [currentTrack?.thumbnail]);

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

  // Guardar la posición de reproducción para "reanudar donde lo dejaste".
  useEffect(() => {
    const save = () => {
      const id = currentRef.current?.id;
      if (!id || !isPlayingRef.current) return;
      try { localStorage.setItem('rsp_resume', JSON.stringify({ id, t: lastTimeRef.current })); } catch {}
    };
    const iv = setInterval(save, 4000);
    window.addEventListener('beforeunload', save);
    return () => { clearInterval(iv); window.removeEventListener('beforeunload', save); };
  }, []);

  // Media Session API — register handlers once
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play', () => { if (!isPlayingRef.current) keyHandlerRef.current.togglePlayPause(); });
    navigator.mediaSession.setActionHandler('pause', () => { if (isPlayingRef.current) keyHandlerRef.current.togglePlayPause(); });
    navigator.mediaSession.setActionHandler('previoustrack', () => keyHandlerRef.current.doPrevTrack());
    navigator.mediaSession.setActionHandler('nexttrack', () => keyHandlerRef.current.doNextTrack());
    // Scrubber + avance/retroceso desde la pantalla de bloqueo / auriculares.
    const setSeek = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* no soportado */ } };
    setSeek('seekto', (d) => { if (d && d.seekTime != null) seekToSeconds(d.seekTime); });
    setSeek('seekforward', (d) => seekToSeconds(getCurrentPlaybackTime() + ((d && d.seekOffset) || 10)));
    setSeek('seekbackward', (d) => seekToSeconds(getCurrentPlaybackTime() - ((d && d.seekOffset) || 10)));
    setSeek('stop', () => { if (isPlayingRef.current) keyHandlerRef.current.togglePlayPause(); });

    // Desbloquea el ancla en el primer gesto: la política de autoplay solo permite
    // reproducir un <audio> nuevo si el primer play() ocurre dentro de una interacción.
    // Tras esto, el efecto de sincronización ya puede arrancarla/pararla por código.
    const unlockAnchor = () => {
      ensureMediaAnchor().play()
        .then(() => { if (!isPlayingRef.current) { try { mediaAnchorRef.current.pause(); } catch { /* ignore */ } } })
        .catch(() => { /* se reintenta en el siguiente gesto */ });
    };
    window.addEventListener('pointerdown', unlockAnchor, { once: true });
    return () => window.removeEventListener('pointerdown', unlockAnchor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Media Session API — update metadata on track change
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (currentTrack) {
      // Varias resoluciones para que Motorola/Android elija la más nítida en el
      // lockscreen; hiResArt sube la calidad en Google/YouTube. Sin carátula → icono.
      const thumb = currentTrack.thumbnail;
      const artwork = thumb
        ? [96, 192, 256, 384, 512].map((s) => ({ src: hiResArt(thumb, s), sizes: `${s}x${s}`, type: 'image/jpeg' }))
        : [
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          ];
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title || 'Noir',
        artist: currentTrack.artist || '',
        album: playlistTitle || 'Noir',
        artwork,
      });
    }
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    // El scrubber del lockscreen se actualiza también al pausar/reanudar.
    updateMediaPositionState(getCurrentPlaybackTime(), getEngineDuration());
  }, [currentTrack, isPlaying, playlistTitle]);

  // Sincroniza el ancla de MediaSession con la reproducción. Solo es necesaria con
  // el motor de YouTube (IFrame cross-origin); con audio directo/Spotify la sesión
  // ya es de nuestra página. Ver ensureMediaAnchor().
  useEffect(() => {
    const needsAnchor = isPlaying && engine === 'youtube';
    if (needsAnchor) {
      ensureMediaAnchor().play().catch(() => { /* aún sin desbloquear; se retomará */ });
    } else if (mediaAnchorRef.current) {
      try { mediaAnchorRef.current.pause(); } catch { /* ignore */ }
    }
  }, [isPlaying, engine]);

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
      setEngine('youtube');
      markPlaybackStarted();
    } else if (e.data === YT.PlayerState.PAUSED) {
      setIsPlaying(false);
      setIsBuffering(false);
      stopProgressTimer();
    } else if (e.data === YT.PlayerState.ENDED) {
      setIsPlaying(false);
      stopProgressTimer();
      // Fin PREMATURO del IFrame: a veces YouTube emite ENDED a mitad de la canción
      // (hipo de stream / restricción) lejos del final real. No es fin de verdad → en
      // vez de saltar, pasamos al audio directo del backend desde la misma posición.
      let cur = 0, dur = 0;
      try { cur = ytPlayerRef.current?.getCurrentTime?.() || 0; dur = ytPlayerRef.current?.getDuration?.() || 0; } catch {}
      if (dur > 0 && dur - cur > 5 && currentRef.current?.id) {
        showToast('Reproducción interrumpida. Pasando a audio directo…');
        loadFallbackAudio(currentRef.current.id, cur);
        return;
      }
      onTrackEnded();
    }
  };

  const onYTError = (e) => {
    console.warn('YT IFrame error code:', e.data);
    // Códigos del IFrame: 101/150 = incrustación deshabilitada por el dueño,
    // 100 = video no disponible/privado, 5 = error del reproductor HTML5,
    // 2 = parámetro inválido. En todos los casos (excepto sin id) intentamos
    // reproducirlo aquí con el stream de audio directo del backend (cliente IOS
    // anónimo, que suele saltarse las restricciones que bloquean YouTube Music)
    // antes de descartarlo. Si el stream tampoco puede, el onError del <audio>
    // (o el catch de loadFallbackAudio) salta a la siguiente canción.
    const videoId = currentRef.current?.id;
    if (!videoId) { failCurrentAndAdvance('No se pudo reproducir la pista. Pasando a la siguiente…'); return; }
    if (e.data === 101 || e.data === 150) {
      showToast('No disponible en YouTube Music. Reproduciendo audio directo…');
    } else {
      showToast('Restricción de reproducción. Intentando audio directo…');
    }
    loadFallbackAudio(videoId);
  };

  // Debounced next to avoid rapid-fire skipping
  const safNextTrack = useCallback(() => {
    if (skipDebounceRef.current) return;
    skipDebounceRef.current = true;
    setTimeout(() => { skipDebounceRef.current = false; }, 2000);
    doNextTrack();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Red de seguridad: que la música nunca quede en silencio sin recuperación ──
  const MAX_CONSECUTIVE_FAILURES = 6;

  const clearYtWatchdog = () => { clearTimeout(ytWatchdogRef.current); ytWatchdogRef.current = null; };

  // Vigila el IFrame tras loadVideoById: si en 12 s no confirmó reproducción y no
  // caímos al audio directo, se quedó pegado (autoplay bloqueado, buffering infinito,
  // bloqueo regional sin emitir error) → probamos el audio directo del backend.
  const armYtWatchdog = (videoId) => {
    clearYtWatchdog();
    ytConfirmedRef.current = false;
    ytWatchdogRef.current = setTimeout(() => {
      if (ytConfirmedRef.current || usingFallbackRef.current) return;
      if (playerModeRef.current !== 'youtube') return;
      if (currentRef.current?.id !== videoId) return;
      showToast('El reproductor de YouTube no respondió. Probando audio directo…');
      loadFallbackAudio(videoId);
    }, 12000);
  };

  // La reproducción arrancó de verdad: reinicia contador de fallos y vigías.
  const markPlaybackStarted = () => {
    consecutiveFailuresRef.current = 0;
    breakerTrippedRef.current = false;
    ytConfirmedRef.current = true;
    clearYtWatchdog();
    setIsBuffering(false);
    if (playbackRateRef.current !== 1) applyRate(playbackRateRef.current);
  };

  // Una pista no se pudo reproducir → avanza a la siguiente. Pero si fallan demasiadas
  // seguidas (fallo sistémico: red caída, sesión caducada, backend abajo) detiene el
  // bucle y avisa con un mensaje accionable, en vez de saltar en silencio para siempre.
  const failCurrentAndAdvance = (reason) => {
    clearYtWatchdog();
    // Recordar la pista que falló para no volver a intentarla en esta sesión.
    if (currentRef.current?.id) deadTracksRef.current.add(currentRef.current.id);
    consecutiveFailuresRef.current += 1;
    if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
      consecutiveFailuresRef.current = 0;
      breakerTrippedRef.current = true;
      usingFallbackRef.current = false;
      setIsPlaying(false);
      setIsBuffering(false);
      stopProgressTimer();
      showToast('No se pudo reproducir varias canciones seguidas. Revisa tu conexión o reconecta el servicio (YouTube Music / Spotify) y pulsa play para reintentar.', true);
      return;
    }
    if (reason) showToast(reason, true);
    safNextTrack();
  };

  // Detiene por completo la reproducción de YouTube (IFrame + audio directo + watchdog).
  // Se usa al cambiar a Spotify, porque los cargadores de Spotify fijan el modo a
  // 'spotify' antes de reproducir y no se puede condicionar la parada al modo previo.
  const stopYouTubePlayback = () => {
    clearYtWatchdog();
    usingFallbackRef.current = false;
    if (ytPlayerRef.current && ytReadyRef.current) {
      try { ytPlayerRef.current.stopVideo(); } catch {}
    }
    if (audioRef.current) {
      try { audioRef.current.pause(); } catch {}
    }
  };

  // --- Fallback Audio via backend proxy ---
  const loadFallbackAudio = async (videoId, startAt = 0) => {
    if (!videoId) return;
    clearYtWatchdog();
    usingFallbackRef.current = true;
    stopProgressTimer();

    // Modo Hi-Fi (EQ y/o normalización): asegura el grafo y reanuda el contexto (el
    // audio va por proxy same-origin, así que el MediaElementSource no queda "tainted").
    if (eqEnabledRef.current || normalizeEnabledRef.current) {
      ensureEqGraph();
      resumeAudioCtx();
      applyEqGains(eqBands);
      applyNormalization(videoId);
    }

    // Stop YouTube player
    if (ytPlayerRef.current && ytReadyRef.current) {
      try { ytPlayerRef.current.stopVideo(); } catch {}
    }

    const audio = audioRef.current;
    if (!audio) return;
    audio.src = `/api/stream-audio/${videoId}`;
    audio.volume = volumeRef.current / 100;
    audio.muted = mutedRef.current;
    // Reanudar desde una posición (p.ej. al pasar del IFrame interrumpido al audio).
    if (startAt > 1) {
      const seekOnce = () => {
        audio.removeEventListener('loadedmetadata', seekOnce);
        try { if (isFinite(audio.duration)) audio.currentTime = startAt; } catch {}
      };
      audio.addEventListener('loadedmetadata', seekOnce);
    }

    try {
      await audio.play();
      setIsPlaying(true);
      startProgressTimer('audio');
      setEngine('audio');
      markPlaybackStarted();
    } catch (err) {
      console.error('Fallback audio play() failed:', err);
      // Autoplay bloqueado por el navegador: NO es un fallo de la pista; no saltar,
      // esperar a que el usuario pulse play (un gesto desbloquea el audio).
      if (err?.name === 'NotAllowedError') {
        usingFallbackRef.current = false;
        setIsPlaying(false);
        showToast('Pulsa play para iniciar la reproducción (el navegador bloqueó el autoplay).', true);
        return;
      }
      usingFallbackRef.current = false;
      failCurrentAndAdvance('No se pudo cargar el audio directo. Probando la siguiente…');
    }
  };

  // --- Recuperación de stalls del audio de respaldo ---
  // Si el <audio> se queda esperando datos (red inestable / URL al borde de caducar),
  // reintentamos resumiendo desde la posición actual; el backend re-resuelve la URL si
  // googlevideo devolvió 403. Tras varios intentos fallidos saltamos a la siguiente.
  const clearStallWatch = () => { clearTimeout(stallTimerRef.current); stallTimerRef.current = null; };

  const recoverFallbackStall = () => {
    const audio = audioRef.current;
    const id = currentRef.current?.id;
    if (!audio || !id || !usingFallbackRef.current || !isPlayingRef.current) return;
    stallCountRef.current += 1;
    if (stallCountRef.current > 2) {
      usingFallbackRef.current = false;
      stallCountRef.current = 0;
      failCurrentAndAdvance('Audio inestable. Probando la siguiente…');
      return;
    }
    const pos = audio.currentTime || 0;
    showToast('Reconectando audio…');
    audio.src = `/api/stream-audio/${id}?r=${Date.now()}`; // fuerza re-descarga (re-resuelve si caducó)
    audio.load();
    const onLoaded = () => {
      audio.removeEventListener('loadedmetadata', onLoaded);
      try { if (pos > 0 && isFinite(audio.duration)) audio.currentTime = pos; } catch {}
      audio.play().catch(() => {});
    };
    audio.addEventListener('loadedmetadata', onLoaded);
  };

  const onAudioWaiting = () => {
    if (!usingFallbackRef.current) return;
    setIsBuffering(true);
    clearStallWatch();
    stallTimerRef.current = setTimeout(recoverFallbackStall, 8000);
  };
  const onAudioPlaying = () => { clearStallWatch(); stallCountRef.current = 0; markPlaybackStarted(); };

  // El <audio> disparó 'ended'. Si fue lejos del final real (stream cortado), NO es
  // fin de verdad → reanuda desde la posición en vez de saltar. Solo avanza si de
  // verdad llegó al final (o la duración es desconocida).
  const handleAudioEnded = () => {
    const a = audioRef.current;
    if (usingFallbackRef.current && a && isFinite(a.duration) && a.duration - (a.currentTime || 0) > 3) {
      recoverFallbackStall();
      return;
    }
    onTrackEnded();
  };

  // --- Prefetch de la siguiente pista ---
  // Calienta la caché de URL de audio del backend para la próxima canción de la
  // bolsa (o de la cola prioritaria). Si esa pista acaba cayendo al audio directo,
  // la URL ya estará resuelta y el cambio será instantáneo. Best-effort, solo YouTube.
  const prefetchNext = () => {
    try {
      const pq = priorityQueueRef.current;
      const bag = bagRef.current;
      const next = pq.length ? pq[0] : (bag.length ? bag[bag.length - 1] : null);
      if (!next) return;
      // Smart-play: pre-resolver la siguiente pista de Spotify a YouTube (calienta caché).
      if (spotifyViaYoutubeRef.current && next.source === 'spotify') {
        resolveSpotifyToYt(next).then((yt) => { if (yt?.id) fetch(`/api/prefetch-audio/${yt.id}`).catch(() => {}); });
        return;
      }
      if (next.source === 'spotify' || next.uri || !next.id) return;
      if (lastPrefetchedRef.current === next.id) return;
      lastPrefetchedRef.current = next.id;
      fetch(`/api/prefetch-audio/${next.id}`).catch(() => {});
    } catch {}
  };

  // --- Progress Timer ---
  const startProgressTimer = (source) => {
    stopProgressTimer();
    progressTimerRef.current = setInterval(async () => {
      if (source === 'yt' && ytPlayerRef.current && ytReadyRef.current) {
        try {
          const t = ytPlayerRef.current.getCurrentTime?.() || 0;
          const d = ytPlayerRef.current.getDuration?.() || 0;
          setCurrentTime(t); lastTimeRef.current = t;
          setDuration(d);
          updateMediaPositionState(t, d);
        } catch {}
      } else if (source === 'audio' && audioRef.current) {
        const t = audioRef.current.currentTime || 0;
        setCurrentTime(t); lastTimeRef.current = t;
        const d = audioRef.current.duration;
        if (d && isFinite(d)) { setDuration(d); updateMediaPositionState(t, d); }
      } else if (source === 'spotify' && spotifyPlayerRef.current) {
        try {
          const state = await spotifyPlayerRef.current.getCurrentState();
          if (state && !state.paused) {
            const t = state.position / 1000;
            setCurrentTime(t); lastTimeRef.current = t;
            const cur = state.track_window?.current_track;
            if (cur) { const d = cur.duration_ms / 1000; setDuration(d); updateMediaPositionState(t, d); }
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
    // Nueva playlist = intento limpio: descarta cortes/pistas muertas previas.
    consecutiveFailuresRef.current = 0;
    breakerTrippedRef.current = false;
    deadTracksRef.current = new Set();
    setUnavailableCount(0);
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
    // Dedupe: no volver a meter canciones que ya están en la bolsa (por uri/id).
    const keyOf = (t) => t.uri || t.id;
    const have = new Set(allRef.current.map(keyOf));
    const fresh = (newTracks || []).filter((t) => {
      const k = keyOf(t);
      if (!k || have.has(k)) return false;
      have.add(k);
      return true;
    });
    const dupes = (newTracks?.length || 0) - fresh.length;
    if (!fresh.length) {
      showToast(`"${label}" ya estaba en la bolsa (0 nuevas)`, false);
      return;
    }
    const shuffledNew = fisherYates(fresh);
    const merged = [...allRef.current, ...fresh];
    const newBag = [...bagRef.current, ...shuffledNew];
    setAllTracks(merged);
    allRef.current = merged;
    setShuffleBag(newBag);
    bagRef.current = newBag;
    setPlaylistTitle(prev => {
      const base = prev.includes(' ✚ ') ? prev.split(' ✚ ')[0] : prev;
      return `${base} ✚ ${label}`;
    });
    showToast(`+${fresh.length} de "${label}" mezcladas${dupes ? ` (${dupes} duplicadas omitidas)` : ''}`);
  };

  // --- Playback ---
  // Smart-play: resuelve una pista de Spotify a su equivalente de YouTube (cacheado).
  const resolveSpotifyToYt = async (track) => {
    const key = track.uri || track.id || `${track.artist} ${track.title}`;
    const hit = ytMatchCacheRef.current.get(key);
    if (hit) return hit;
    try {
      const params = new URLSearchParams({ title: track.title || '', artist: track.artist || '' });
      if (track.uri) params.set('uri', track.uri);
      if (track.duration_seconds) params.set('duration', String(Math.round(track.duration_seconds * 1000)));
      const r = await fetch(`/api/library/match?${params.toString()}`);
      if (!r.ok) return null;
      const d = await r.json();
      if (d.track?.id) {
        const yt = { ...d.track, source: 'youtube' };
        ytMatchCacheRef.current.set(key, yt);
        return yt;
      }
    } catch { /* ignore */ }
    return null;
  };

  const doPlayTrack = (track, bag, history) => {
    if (!track) return;

    // Smart-play: si está activo y la pista es de Spotify, resuélvela a YouTube y reprodúcela
    // por ahí (sin Premium, sin depender de la API de Spotify). `_ytResolved` evita recursión.
    if (spotifyViaYoutubeRef.current && track.source === 'spotify' && !track._ytResolved) {
      setIsBuffering(true);
      setCurrentTrack(track);
      currentRef.current = track;
      setShuffleBag(bag); bagRef.current = bag;
      setPlayedHistory(history); historyRef.current = history;
      resolveSpotifyToYt(track).then((yt) => {
        if (yt) doPlayTrack({ ...yt, _ytResolved: true }, bag, history);
        else doPlayTrack({ ...track, _ytResolved: true }, bag, history); // sin match → SDK de Spotify
      });
      return;
    }

    clearInterval(fadeIntervalRef.current);
    clearStallWatch();
    clearYtWatchdog();
    stallCountRef.current = 0;
    setIsBuffering(true);
    usingFallbackRef.current = false;
    stopProgressTimer();
    setCurrentTime(0);
    setDuration(0);
    setIsFavorite(!!favoritesRef.current[track.id]);

    // Stop fallback audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
    }

    setCurrentTrack(track);
    currentRef.current = track;
    trackPlayStat(track);

    // Reanudar donde lo dejaste: si hay una posición guardada para ESTA pista, úsala.
    const resumeAt = pendingResumeRef.current && pendingResumeRef.current.id === track.id
      ? pendingResumeRef.current.t : 0;
    pendingResumeRef.current = null;
    startedRef.current = true;

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
      // Pasar a Spotify: detener SIEMPRE YouTube (IFrame + audio directo). El modo ya
      // puede venir marcado como 'spotify' (loadSpotify* lo fija antes de llamar aquí),
      // así que NO se puede condicionar la parada a "si el modo previo no era spotify"
      // o el IFrame seguiría sonando en paralelo.
      stopYouTubePlayback();
      setPlayerMode('spotify');
      playerModeRef.current = 'spotify';
      spotifyPlayUri(track.uri || track.id);
    } else {
      // Pasar a YouTube: pausar SIEMPRE Spotify si el SDK existe.
      if (spotifyPlayerRef.current) {
        try { spotifyPlayerRef.current.pause(); } catch {}
      }
      setPlayerMode('youtube');
      playerModeRef.current = 'youtube';
      if (hifiModeRef.current) {
        // Modo Hi-Fi + EQ: forzar el audio directo (único motor que el EQ puede procesar).
        loadFallbackAudio(track.id, resumeAt);
      } else if (ytPlayerRef.current && ytReadyRef.current) {
        ytPlayerRef.current.setVolume(volumeRef.current);
        if (mutedRef.current) ytPlayerRef.current.mute();
        else ytPlayerRef.current.unMute();
        ytPlayerRef.current.loadVideoById(resumeAt > 1 ? { videoId: track.id, startSeconds: resumeAt } : track.id);
        setIsPlaying(true);
        armYtWatchdog(track.id);
      } else {
        loadFallbackAudio(track.id, resumeAt);
      }
    }

    // Adelanta la resolución de la URL de audio de la siguiente pista.
    prefetchNext();
  };

  // Radio: cuántas pistas quedan en la bolsa para disparar la recarga anticipada.
  const RADIO_LOW_WATER = 5;

  // Inserta pistas de radio (dedup) intercalándolas en posiciones aleatorias de lo
  // que queda por sonar, y las añade al universo de la bolsa. Devuelve cuántas nuevas.
  const appendRadioTracks = (incoming) => {
    const keyOf = (t) => t.uri || t.id;
    const have = new Set(allRef.current.map(keyOf));
    const dead = deadTracksRef.current;
    const fresh = (incoming || [])
      .filter((t) => {
        const k = keyOf(t);
        if (!k || have.has(k) || dead.has(t.id)) return false;
        have.add(k);
        return true;
      })
      .map((t) => ({ ...t, source: t.source || 'youtube', radio: true }));
    if (!fresh.length) return 0;

    const merged = [...allRef.current, ...fresh];
    setAllTracks(merged); allRef.current = merged;

    // Intercalar en la bolsa restante para que suenen pronto, pero mezcladas.
    const bag = [...bagRef.current];
    for (const t of fisherYates(fresh)) {
      const pos = Math.floor(Math.random() * (bag.length + 1));
      bag.splice(pos, 0, t);
    }
    setShuffleBag(bag); bagRef.current = bag;
    return fresh.length;
  };

  // Pide la cola automix de la semilla y extiende la bolsa (radio infinita).
  const maybeRefillRadio = useCallback(async (seedTrack) => {
    if (!radioModeRef.current || radioFetchingRef.current) return;
    // La radio usa la cola de YT Music: necesita un videoId de YouTube.
    const seed = seedTrack && seedTrack.source !== 'spotify' ? seedTrack.id : null;
    if (!seed) return;
    radioFetchingRef.current = true;
    setRadioLoading(true);
    try {
      const res = await fetch(`/api/radio/${seed}?limit=25`);
      if (!res.ok) return;
      const data = await res.json();
      const added = appendRadioTracks(data.tracks || []);
      if (added) {
        setBagFlash(true); setTimeout(() => setBagFlash(false), 900);
        showToast(`📻 Radio: +${added} temas relacionados`);
      }
    } catch {
      /* silencioso: si falla, se reintenta en el próximo salto */
    } finally {
      radioFetchingRef.current = false;
      setRadioLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    // Saltar pistas muertas (borradas/no disponibles). Si TODAS están muertas,
    // reproducir igual y dejar que el cortacircuitos lo gestione.
    const dead = deadTracksRef.current;
    const playableExists = all.some((t) => !dead.has(t.id));
    let next = null;
    let refilled = false;
    for (let i = 0; i <= all.length; i++) {
      if (bag.length === 0) { bag = fisherYates(all); refilled = true; }
      const cand = bag.pop();
      if (!cand) break;
      if (!playableExists || !dead.has(cand.id)) { next = cand; break; }
    }
    if (!next) return;
    if (refilled && playableExists) showToast('¡Bolsa rebarajada!');
    // Radio infinita: si quedan pocas por sonar, precarga afines del tema que va a sonar.
    if (radioModeRef.current && bag.length <= RADIO_LOW_WATER) maybeRefillRadio(next);
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

  // Fin REAL de pista: repetir la misma si está activo "repetir una", o avanzar.
  const onTrackEnded = () => {
    markPlaybackStarted();
    if (repeatOneRef.current && currentRef.current) {
      doPlayTrack(currentRef.current, bagRef.current, historyRef.current);
      return;
    }
    doNextTrack();
  };

  const toggleFavorite = () => {
    const t = currentRef.current;
    if (!t) return;
    setFavorites((prev) => {
      const next = { ...prev };
      let nowFav;
      if (next[t.id]) { delete next[t.id]; nowFav = false; }
      else { next[t.id] = t; nowFav = true; }
      setIsFavorite(nowFav);
      favoritesRef.current = next;
      // Si es una pista de Spotify, refleja el ♥ también en tu biblioteca de Spotify.
      if (t.source === 'spotify' && typeof t.uri === 'string' && t.uri.startsWith('spotify:track:')) {
        syncSpotifyLiked(t.uri.split(':').pop(), nowFav);
      }
      return next;
    });
  };

  // Guarda/quita una pista en "Tus me gusta" de Spotify (PUT/DELETE /me/tracks).
  const syncSpotifyLiked = async (trackId, liked) => {
    if (!trackId) return;
    try {
      const res = await fetch('/api/spotify/token');
      if (!res.ok) return;
      const { access_token } = await res.json();
      const resp = await fetch(`https://api.spotify.com/v1/me/tracks?ids=${trackId}`, {
        method: liked ? 'PUT' : 'DELETE',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      });
      if (resp.ok || resp.status === 200 || resp.status === 204) {
        showToast(liked ? '♥ Guardado en tus Me gusta de Spotify' : 'Quitado de tus Me gusta de Spotify');
      }
    } catch {
      /* silencioso: el favorito local ya quedó guardado igual */
    }
  };

  const RATES = [1, 1.25, 1.5, 2, 0.75];
  const applyRate = (r) => {
    if (playerModeRef.current === 'spotify') return; // el SDK de Spotify no soporta velocidad
    if (usingFallbackRef.current && audioRef.current) { try { audioRef.current.playbackRate = r; } catch {} }
    else if (ytPlayerRef.current && ytReadyRef.current) { try { ytPlayerRef.current.setPlaybackRate(r); } catch {} }
  };
  const cycleRate = () => {
    const i = RATES.indexOf(playbackRateRef.current);
    const r = RATES[(i + 1) % RATES.length];
    setPlaybackRate(r); playbackRateRef.current = r;
    applyRate(r);
  };

  const loadLocalFavorites = (merge = false) => {
    const tracks = Object.values(favoritesRef.current);
    if (!tracks.length) { showToast('Aún no tienes favoritas. Pulsa el ♥ en una canción.', true); return; }
    if (merge) addToShuffleBag(tracks, 'Mis favoritas');
    else { setSelectedPlaylistId('favorites'); initShuffleBag(tracks, 'Mis favoritas'); }
  };

  const removeFavorite = (id) => {
    setFavorites((prev) => {
      const next = { ...prev }; delete next[id]; favoritesRef.current = next;
      if (currentRef.current?.id === id) setIsFavorite(false);
      return next;
    });
  };
  const clearFavorites = () => {
    if (!confirm('¿Vaciar todas tus favoritas?')) return;
    setFavorites({}); favoritesRef.current = {}; setIsFavorite(false);
  };
  const exportFavorites = () => {
    const blob = new Blob([JSON.stringify(Object.values(favoritesRef.current), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'noir-favoritas.json'; a.click();
    URL.revokeObjectURL(url);
  };
  const importFavorites = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const arr = JSON.parse(reader.result);
        const list = Array.isArray(arr) ? arr : Object.values(arr || {});
        setFavorites((prev) => {
          const next = { ...prev };
          for (const t of list) { if (t && t.id) next[t.id] = t; }
          favoritesRef.current = next;
          return next;
        });
        showToast(`Importadas ${list.length} favoritas`);
      } catch { showToast('Archivo de favoritas inválido', true); }
    };
    reader.readAsText(file);
  };

  const togglePlayPause = () => {
    if (!currentRef.current) {
      if (allRef.current.length > 0) doNextTrack();
      return;
    }
    // Tras restaurar sesión, la pista está seleccionada pero aún no cargada en ningún
    // reproductor → el primer "play" la arranca y reanuda donde la dejaste.
    if (!startedRef.current) {
      doPlayTrack(currentRef.current, bagRef.current, historyRef.current);
      return;
    }
    // Tras un corte por fallos repetidos, "play" reintenta la pista actual de cero.
    if (breakerTrippedRef.current) {
      breakerTrippedRef.current = false;
      consecutiveFailuresRef.current = 0;
      doPlayTrack(currentRef.current, bagRef.current, historyRef.current);
      return;
    }
    if (playerModeRef.current === 'spotify' && spotifyPlayerRef.current) {
      spotifyPlayerRef.current.togglePlay();
      return;
    }
    if (usingFallbackRef.current) {
      const audio = audioRef.current;
      if (!audio) return;
      if (isPlayingRef.current) { audio.pause(); setIsPlaying(false); setIsBuffering(false); stopProgressTimer(); clearStallWatch(); }
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

  // Tilt 3D de la carátula siguiendo el cursor. Manipula el DOM directamente (CSS vars)
  // para no provocar re-renders de React en cada movimiento del ratón.
  const handleArtTilt = (e) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--tiltY', `${(px * 9).toFixed(2)}deg`);
    el.style.setProperty('--tiltX', `${(-py * 9).toFixed(2)}deg`);
  };
  const resetArtTilt = (e) => {
    e.currentTarget.style.setProperty('--tiltX', '0deg');
    e.currentTarget.style.setProperty('--tiltY', '0deg');
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
    setMobileTab('player'); // en móvil, salta al reproductor al elegir una canción (ignorado en desktop)
  };

  // --- Modo Hi-Fi: EQ + normalización ---
  // Si Hi-Fi acaba de activarse y suena una pista de YouTube por el IFrame, la
  // reengancha al audio directo desde la misma posición para que el efecto actúe ya.
  const applyHifiEngineChange = () => {
    const t = currentRef.current;
    if (t && t.source !== 'spotify' && !usingFallbackRef.current) {
      ensureEqGraph();
      resumeAudioCtx();
      loadFallbackAudio(t.id, getCurrentPlaybackTime());
    }
  };

  const toggleEq = () => {
    const on = !eqEnabledRef.current;
    eqEnabledRef.current = on;
    hifiModeRef.current = on || normalizeEnabledRef.current;
    setEqEnabled(on);
    if (on) {
      ensureEqGraph();                 // el click es un gesto → permite crear/reanudar el ctx
      resumeAudioCtx();
      applyEqGains(eqBands);
      showToast('🎚️ Ecualizador activado (modo Hi-Fi).');
      applyHifiEngineChange();
    } else {
      applyEqGains(EQ_FREQS.map(() => 0)); // aplana; la pista actual sigue sin cortes
      showToast(normalizeEnabledRef.current ? 'EQ desactivado (nivelado sigue activo).' : 'Ecualizador desactivado.');
    }
  };

  const toggleNormalize = () => {
    const on = !normalizeEnabledRef.current;
    normalizeEnabledRef.current = on;
    hifiModeRef.current = eqEnabledRef.current || on;
    setNormalizeEnabled(on);
    if (on) {
      ensureEqGraph();
      resumeAudioCtx();
      showToast('🔊 Nivelado de volumen activado (modo Hi-Fi).');
      applyHifiEngineChange();
      const t = currentRef.current;
      if (t && t.source !== 'spotify') applyNormalization(t.id);
    } else {
      if (normGainRef.current) { try { normGainRef.current.gain.value = 1; } catch { /* ignore */ } }
      showToast(eqEnabledRef.current ? 'Nivelado desactivado (EQ sigue activo).' : 'Nivelado de volumen desactivado.');
    }
  };

  // --- Comparador de calidad + A/B ---
  const openQuality = async () => {
    const t = currentRef.current;
    if (!t) { showToast('No hay nada reproduciéndose.', true); return; }
    setQualityCtx({ ytId: t.source === 'spotify' ? null : t.id, spotifyUri: null, title: t.title, artist: t.artist, source: t.source });
    setShowQuality(true);
    // Si es una pista de Spotify, resuelve su equivalente de YouTube para el panel.
    if (t.source === 'spotify') {
      const m = await resolveSpotifyToYt(t);
      setQualityCtx((prev) => (prev ? { ...prev, ytId: m?.id || null } : prev));
    }
  };

  // Busca la misma canción en Spotify (para el A/B cuando la pista viene de YouTube).
  const resolveYtToSpotify = async (track) => {
    if (!spotifyAuth.authenticated) return null;
    try {
      const [data] = await spotifyApiFetch('/search', { q: `${track.title} ${track.artist || ''}`.trim(), type: 'track', limit: 1 });
      return data?.tracks?.items?.[0]?.uri || null;
    } catch { return null; }
  };

  // Reproduce la MISMA canción desde la fuente elegida (sin alterar cola/historial).
  const playSameFrom = async (source) => {
    const t = currentRef.current;
    if (!t) return;
    if (source === 'youtube') {
      const ytId = t.source === 'spotify' ? (await resolveSpotifyToYt(t))?.id : t.id;
      if (!ytId) { showToast('No se pudo resolver esta canción en YouTube.', true); return; }
      const ytTrack = { ...t, id: ytId, source: 'youtube' };
      delete ytTrack.uri;
      doPlayTrack(ytTrack, bagRef.current, historyRef.current);
      showToast('▶ Reproduciendo desde YouTube');
    } else {
      let uri = t.source === 'spotify' ? t.uri
        : (typeof t.uri === 'string' && t.uri.startsWith('spotify:') ? t.uri : null);
      if (!uri) uri = await resolveYtToSpotify(t);
      if (!uri) { showToast('No se encontró esta canción en Spotify.', true); return; }
      // `_ytResolved: true` salta el smart-play → reproducción NATIVA de Spotify (Premium).
      doPlayTrack({ ...t, source: 'spotify', uri, _ytResolved: true }, bagRef.current, historyRef.current);
      showToast('▶ Reproduciendo desde Spotify (nativo)');
    }
    setShowQuality(false);
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
    if (allRef.current.length === 0) { showToast('No hay nada cargado para rebarajar.', true); return; }
    // Rebaraja SOLO lo que queda por sonar (excluye la actual y el historial), para
    // preservar el shuffle real: no repetir ninguna hasta agotar la bolsa. Si ya no
    // queda nada por sonar, arranca un ciclo nuevo rebarajando todo.
    const playedIds = new Set(historyRef.current.map((t) => t.id));
    if (currentRef.current) playedIds.add(currentRef.current.id);
    const remaining = allRef.current.filter((t) => !playedIds.has(t.id));
    let shuffled, msg;
    if (remaining.length > 1) {
      shuffled = fisherYates(remaining);
      msg = `🔀 ${remaining.length} por sonar rebarajadas`;
    } else {
      shuffled = fisherYates(allRef.current);
      msg = `🔄 Nuevo ciclo: ${shuffled.length} ${shuffled.length === 1 ? 'canción' : 'canciones'}`;
    }
    setShuffleBag(shuffled);
    bagRef.current = shuffled;
    // Feedback visual: gira el icono y resalta el contador de la bolsa.
    setReshuffling(true); setTimeout(() => setReshuffling(false), 650);
    setBagFlash(true); setTimeout(() => setBagFlash(false), 900);
    showToast(msg);
  };

  // Vacía por completo cola prioritaria + bolsa + historial + pista actual y detiene
  // la reproducción. Deja la app como recién abierta (sin lista cargada).
  const clearQueue = () => {
    if (allRef.current.length === 0 && priorityQueueRef.current.length === 0) {
      showToast('No hay nada cargado.', true);
      return;
    }
    if (!window.confirm('¿Vaciar la cola y la bolsa? Se detendrá la reproducción.')) return;
    // Detener cualquier motor (YouTube IFrame, audio directo y Spotify).
    stopYouTubePlayback();
    try { if (spotifyPlayerRef.current) spotifyPlayerRef.current.pause(); } catch {}
    try { if (audioRef.current) { audioRef.current.pause(); audioRef.current.removeAttribute('src'); } } catch {}
    setIsPlaying(false);
    stopProgressTimer();
    // Vaciar todo el estado de reproducción.
    setAllTracks([]); allRef.current = [];
    setShuffleBag([]); bagRef.current = [];
    setPriorityQueue([]); priorityQueueRef.current = [];
    setPlayedHistory([]); historyRef.current = [];
    setCurrentTrack(null); currentRef.current = null;
    setPlaylistTitle('Ninguna playlist seleccionada');
    setSelectedPlaylistId(null);
    localStorage.removeItem(SESSION_KEY);
    showToast('Cola y bolsa vaciadas');
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
          // Fade-out suave (3 s) y luego pausar; restaura el volumen para la próxima vez.
          fadeOutCurrent(3000).then(() => {
            if (playerModeRef.current === 'spotify' && spotifyPlayerRef.current) {
              try { spotifyPlayerRef.current.pause(); } catch {}
              try { spotifyPlayerRef.current.setVolume((mutedRef.current ? 0 : volumeRef.current) / 100); } catch {}
            } else if (usingFallbackRef.current && audioRef.current) {
              audioRef.current.pause();
              audioRef.current.volume = volumeRef.current / 100;
            } else if (ytPlayerRef.current && ytReadyRef.current) {
              try { ytPlayerRef.current.pauseVideo(); ytPlayerRef.current.setVolume(volumeRef.current); } catch {}
            }
            setIsPlaying(false);
            stopProgressTimer();
            showToast('Sleep timer: reproducción pausada');
          });
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
      if (track.duration_seconds) entry.duration_seconds = track.duration_seconds;
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

  // Reordena la cola prioritaria (drag & drop): mueve el elemento `from` a `to`.
  const dragPqIndex = useRef(null);
  const reorderPq = (from, to) => {
    if (from == null || to == null || from === to) return;
    setPriorityQueue(pq => {
      if (from >= pq.length || to >= pq.length) return pq;
      const next = [...pq];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      priorityQueueRef.current = next;
      return next;
    });
  };

  // --- API ---

  // Captura la cookie de YouTube desde Firefox sin intervención del usuario.
  // Silencioso: si no hay sesión válida en Firefox, devuelve false sin mostrar error.
  const tryFirefoxCapture = async () => {
    try {
      const res = await fetch('/api/auth/browser-capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ browser: 'firefox' }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  // Revalida la sesión de YouTube Music. Si está caída/caducada, intenta reconectar
  // automáticamente desde Firefox — con throttle para no spamear y respetando una
  // desconexión explícita del usuario. Se llama al iniciar sesión y, de forma
  // periódica, desde el watchdog (con { silent: true }).
  const CAPTURE_THROTTLE_MS = 60 * 1000;
  const checkAuthStatus = async ({ silent = false, attempt = 0 } = {}) => {
    try {
      const res = await fetch('/api/status');
      // Al arrancar, el backend puede no estar listo aún y el proxy devolver 5xx / una
      // página de error. Lo tratamos como fallo transitorio y reintentamos (abajo), para
      // que las playlists carguen solas sin tener que recargar la página a mano.
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();

      if (data.authenticated) {
        setAuthStatus(data);
        // Solo en la carga inicial: en los chequeos periódicos las playlists ya están.
        if (!silent) { fetchPlaylists(); fetchYouTubePlaylists(); }
        return;
      }

      // No autenticado → reconexión automática desde Firefox (throttled).
      const now = Date.now();
      const canTry =
        !ytAutoConnectDisabledRef.current &&
        now - lastCaptureAttemptRef.current > CAPTURE_THROTTLE_MS;
      if (canTry) {
        lastCaptureAttemptRef.current = now;
        if (await tryFirefoxCapture()) {
          const res2 = await fetch('/api/status');
          const data2 = await res2.json();
          if (data2.authenticated) {
            setAuthStatus(data2);
            showToast('Sesión de YouTube Music renovada automáticamente desde Firefox');
            fetchPlaylists();
            fetchYouTubePlaylists();
            return;
          }
        }
      }

      setAuthStatus(data);
      if (!silent && data.oauth_exists) {
        // oauth.json exists but session expired
        showToast(data.user_name || 'Sesión expirada. Reconfigura tu cuenta.', true);
      }
    } catch (e) {
      // Backend aún arrancando o red inestable → reintentar con backoff antes de rendirse.
      // Esto elimina el "hay que recargar para ver las listas": el frontend espera solo al
      // backend (~hasta 25 s) y carga las playlists en cuanto responde.
      if (attempt < 8) {
        await new Promise((r) => setTimeout(r, Math.min(5000, 300 * 2 ** attempt)));
        return checkAuthStatus({ silent, attempt: attempt + 1 });
      }
      if (!silent) console.error('Auth check failed tras reintentos:', e);
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

  const fetchYouTubePlaylists = async () => {
    try {
      const res = await fetch('/api/youtube-playlists');
      if (res.ok) {
        const d = await res.json();
        setYoutubePlaylists(d.playlists || []);
      } else {
        setYoutubePlaylists([]);
      }
    } catch (e) {
      console.error('fetchYouTubePlaylists:', e);
      setYoutubePlaylists([]);
    } finally {
      setYtPlaylistsLoaded(true);
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
    setYoutubePlaylists([]);
    setYtPlaylistsLoaded(false);
    // Desconexión explícita: no volver a auto-conectar (deshace la intención del usuario).
    ytAutoConnectDisabledRef.current = true;
    checkAuthStatus();
  };

  const loadLikedSongs = async (merge = false) => {
    if (!authStatus.authenticated) return;
    if (!merge) setSelectedPlaylistId('liked');
    if (!merge) { setPlaylistTitle('Cargando favoritos…'); setPlaylistLoading(true); }
    try {
      const res = await fetch('/api/liked-songs');
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
      const d = await res.json();
      if (!d.tracks.length) { showToast('No tienes canciones gustadas', true); return; }
      const tracks = d.tracks.map(t => ({ ...t, source: 'youtube' }));
      if (merge) addToShuffleBag(tracks, d.title);
      else { initShuffleBag(tracks, d.title); setUnavailableCount(d.unavailable || 0); }
    } catch (e) { showToast(e.message, true); if (!merge) setPlaylistTitle('Error'); }
    finally { if (!merge) setPlaylistLoading(false); }
  };

  const loadPlaylist = async (id, title, merge = false) => {
    if (!id || !id.trim()) { showToast('Introduce un ID de playlist', true); return; }
    if (!merge) setSelectedPlaylistId(id);
    if (!merge) { setPlaylistTitle(`Cargando '${title}'…`); setPlaylistLoading(true); }

    // Show cached version immediately (only when replacing, not merging)
    const cached = !merge ? await getCachedPlaylist(id) : null;
    if (cached?.tracks?.length) {
      const cachedWithSrc = cached.tracks.map(t => ({ ...t, source: 'youtube' }));
      initShuffleBag(cachedWithSrc, cached.title);
      setPlaylistTitle(cached.title + ' (cache)');
      setPlaylistLoading(false); // ya hay contenido visible; el refresco sigue en segundo plano
    }

    try {
      const res = await fetch(`/api/playlist/${id}`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
      const d = await res.json();
      if (!d.tracks.length) { showToast('Playlist vacía', true); return; }
      const tracks = d.tracks.map(t => ({ ...t, source: 'youtube' }));
      await cachePlaylist(id, d.title, d.tracks);
      if (merge) addToShuffleBag(tracks, d.title);
      else { initShuffleBag(tracks, d.title); setUnavailableCount(d.unavailable || 0); }
    } catch (e) {
      if (!cached && !merge) { showToast(e.message, true); setPlaylistTitle('Error'); }
      else if (!merge) showToast('Usando versión en caché (sin conexión o error)', false);
      else showToast(e.message, true);
    } finally {
      if (!merge) setPlaylistLoading(false);
    }
  };

  const loadYouTubePlaylist = async (id, title, merge = false) => {
    if (!id) return;
    // Prefijo en la clave de caché para no chocar con las playlists de YT Music.
    const cacheKey = `ytfull:${id}`;
    if (!merge) setSelectedPlaylistId(`youtube:${id}`);
    if (!merge) { setPlaylistTitle(`Cargando '${title}'…`); setPlaylistLoading(true); }

    const cached = !merge ? await getCachedPlaylist(cacheKey) : null;
    if (cached?.tracks?.length) {
      const cachedWithSrc = cached.tracks.map(t => ({ ...t, source: 'youtube' }));
      initShuffleBag(cachedWithSrc, cached.title);
      setPlaylistTitle(cached.title + ' (cache)');
      setPlaylistLoading(false); // ya hay contenido visible; el refresco sigue en segundo plano
    }

    try {
      const res = await fetch(`/api/youtube-playlist/${id}`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
      const d = await res.json();
      if (!d.tracks.length) { showToast('Playlist vacía', true); return; }
      const tracks = d.tracks.map(t => ({ ...t, source: 'youtube' }));
      await cachePlaylist(cacheKey, d.title, d.tracks);
      if (merge) addToShuffleBag(tracks, d.title);
      else initShuffleBag(tracks, d.title);
    } catch (e) {
      if (!cached && !merge) { showToast(e.message, true); setPlaylistTitle('Error'); }
      else if (!merge) showToast('Usando versión en caché (sin conexión o error)', false);
      else showToast(e.message, true);
    } finally {
      if (!merge) setPlaylistLoading(false);
    }
  };

  const handleGlobalSearch = async (e) => {
    e?.preventDefault();
    if (!globalSearchQuery.trim()) return;
    if (searchSource === 'spotify') return searchSpotify();
    setIsSearching(true);
    setPlaylistTitle(`Resultados para "${globalSearchQuery}"`);
    // Don't wipe the current queue before the fetch — initShuffleBag replaces it
    // on success, so a failed search leaves the existing playlist/bag intact.

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(globalSearchQuery)}`);
      if (!res.ok) throw new Error('Error al buscar');
      const data = await res.json();
      const tracks = (data.tracks || []).map(t => ({ ...t, source: 'youtube' }));
      setPlayerMode('youtube');
      playerModeRef.current = 'youtube';
      initShuffleBag(tracks, `Resultados de: ${globalSearchQuery}`);
    } catch (err) {
      console.error(err);
      showToast('Error en la búsqueda', true);
    } finally {
      setIsSearching(false);
    }
  };

  // Búsqueda en Spotify (la API de búsqueda sí funciona para esta app, a diferencia
  // de los tracks de playlist). Llena la bolsa con pistas Spotify reproducibles.
  const searchSpotify = async () => {
    if (!globalSearchQuery.trim()) return;
    if (!spotifyAuth.authenticated) {
      showToast('Conecta Spotify para buscar ahí (Ajustes → Configurar Spotify).', true);
      return;
    }
    setIsSearching(true);
    try {
      const [data] = await spotifyApiFetch('/search', { q: globalSearchQuery, type: 'track', limit: 50 });
      const tracks = (data?.tracks?.items || [])
        .filter(t => t && t.type === 'track' && t.uri)
        .map(fmtSpotifyTrack);
      if (!tracks.length) { showToast('Sin resultados en Spotify', true); return; }
      setPlayerMode('spotify');
      playerModeRef.current = 'spotify';
      initShuffleBag(tracks, `Spotify: ${globalSearchQuery}`);
    } catch (err) {
      console.error('searchSpotify:', err);
      showToast(err.message?.includes('401') ? 'Sesión de Spotify caducada. Reconecta tu cuenta.' : 'Error al buscar en Spotify', true);
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
  // Tiempo total que queda por sonar en la bolsa (suma de duraciones "m:ss"/"h:mm:ss").
  const bagRemainingSec = useMemo(
    () => shuffleBag.reduce((s, t) => s + durToSecs(t.duration), 0),
    [shuffleBag]
  );
  const upcoming = useMemo(() => [...shuffleBag].reverse(), [shuffleBag]);
  // Biblioteca de YouTube unificada: playlists de YT Music + playlists de YouTube en una sola lista.
  const combinedYtPlaylists = useMemo(() => [
    ...playlists.map(p => ({ ...p, _kind: 'ytmusic', _selId: p.id })),
    ...youtubePlaylists.map(p => ({ ...p, _kind: 'youtube', _selId: `youtube:${p.id}` })),
  ], [playlists, youtubePlaylists]);
  const historyList = useMemo(() => [...playedHistory].reverse(), [playedHistory]);
  // Cola "Siguientes" combinada (cola prioritaria + bolsa) para una sola lista virtual.
  const nextList = useMemo(() => [
    ...priorityQueue.map((t, i) => ({ t, pq: true, pqIndex: i })),
    ...upcoming.map((t) => ({ t, pq: false })),
  ], [priorityQueue, upcoming]);
  const engineLabel = engine === 'audio' ? 'Audio directo' : engine === 'spotify' ? 'Spotify' : null;

  // Progreso de carga: durante la paginación el título lleva "(cargadas/total)".
  const loadMatch = playlistTitle.match(/\((\d+)\/(\d+)\)/);
  const loadPct = loadMatch ? Math.min(100, Math.round((+loadMatch[1] / Math.max(1, +loadMatch[2])) * 100)) : null;

  const searchResults = searchQuery.trim()
    ? allTracks.filter(t =>
        t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.artist.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  const VolumeIcon = isMuted || volume === 0
    ? VolumeX
    : volume < 30 ? Volume : volume < 70 ? Volume1 : Volume2;

  // ─────────── Organización de la biblioteca por categoría (IA) ───────────
  // Clave única y estable por playlist para el mapa de categorías.
  const catId = { yt: (pl) => pl._selId, sp: (pl) => `spotify:${pl.id}` };

  // Color estable por categoría: hue derivado del nombre (misma categoría → mismo color).
  const catHue = (name) => {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return h;
  };

  const groupByCategory = (items, getId) => {
    const groups = new Map();
    for (const p of items) {
      const c = playlistCats[getId(p)];
      const name = c?.category?.trim() || 'Sin categoría';
      if (!groups.has(name)) groups.set(name, { name, emoji: c?.emoji || '', items: [] });
      const g = groups.get(name);
      if (!g.emoji && c?.emoji) g.emoji = c.emoji;
      g.items.push(p);
    }
    // Orden por afinidad (catOrder de la IA); las que no estén, alfabético; "Sin categoría" al final.
    const rank = (name) => {
      const i = catOrder.indexOf(name);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...groups.values()].sort((a, b) => {
      if (a.name === 'Sin categoría') return 1;
      if (b.name === 'Sin categoría') return -1;
      const ra = rank(a.name), rb = rank(b.name);
      return ra !== rb ? ra - rb : a.name.localeCompare(b.name);
    });
  };

  const toggleCat = (name) => setCollapsedCats((s) => ({ ...s, [name]: !s[name] }));

  // Filtro de texto de la biblioteca (por título).
  const filterPls = (list) => {
    const q = plFilter.trim().toLowerCase();
    return q ? list.filter((p) => (p.title || '').toLowerCase().includes(q)) : list;
  };

  // Soltar una playlist arrastrada sobre la cabecera de una categoría → reasignarla.
  const moveToCat = (name, emoji) => {
    const id = dragPlIdRef.current;
    dragPlIdRef.current = null;
    if (!id || name === 'Sin categoría') return;
    setPlaylistCats((prev) => ({
      ...prev,
      [id]: { category: name, emoji: prev[id]?.emoji || emoji || '' },
    }));
  };

  const changeCat = (id, e) => {
    e?.stopPropagation();
    const cur = playlistCats[id]?.category || '';
    const val = window.prompt('Categoría de esta playlist (deja vacío para quitarla):', cur);
    if (val === null) return;
    setPlaylistCats((prev) => {
      const next = { ...prev };
      if (!val.trim()) delete next[id];
      else next[id] = { category: val.trim(), emoji: prev[id]?.emoji || '' };
      return next;
    });
    if (val.trim()) setGroupByCat(true);
  };

  const organizeLibrary = async (items, getId) => {
    const list = (items || []).filter((p) => p && p.title);
    if (!list.length) { showToast('No hay playlists para organizar.', true); return; }
    setCatLoading(true);
    try {
      const st = await fetch('/api/assistant/status').then((r) => r.json()).catch(() => ({}));
      if (!st.configured) {
        showToast('Falta la API key de Gemini en backend-node/.env para organizar con IA.', true);
        return;
      }
      const payload = { playlists: list.map((p) => ({ id: getId(p), title: p.title, count: p.count })) };
      const res = await fetch('/api/assistant/categorize-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
      const cats = data.categories || [];
      if (!cats.length) { showToast('La IA no devolvió categorías.', true); return; }
      setPlaylistCats((prev) => {
        const next = { ...prev };
        for (const c of cats) next[c.id] = { category: c.category, emoji: c.emoji || '' };
        return next;
      });
      setCatOrder(Array.isArray(data.order) ? data.order : []);
      setGroupByCat(true);
      const nGroups = new Set(cats.map((c) => c.category)).size;
      showToast(`✨ ${cats.length} playlists organizadas en ${nGroups} categorías.`);
    } catch (e) {
      showToast(e.message || 'No se pudo organizar la biblioteca.', true);
    } finally {
      setCatLoading(false);
    }
  };

  const renderYtCard = (pl, i = 0) => {
    const cat = playlistCats[pl._selId];
    return (
    <motion.div key={pl._selId}
      className={`playlist-card ${selectedPlaylistId === pl._selId ? 'active' : ''} ${cat ? 'has-cat' : ''}`}
      style={cat ? { '--cat-hue': catHue(cat.category) } : undefined}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: 'easeOut', delay: Math.min(i * 0.025, 0.4) }}
      draggable
      onDragStart={(e) => { dragPlIdRef.current = pl._selId; e.dataTransfer.effectAllowed = 'move'; }}
      onClick={() => pl._kind === 'youtube' ? loadYouTubePlaylist(pl.id, pl.title, false) : loadPlaylist(pl.id, pl.title, false)}
    >
      {pl.thumbnail ? <img src={pl.thumbnail} alt="" /> : <div className="playlist-card-noimg"><ListMusic size={18} /></div>}
      <div className="playlist-meta">
        <h4>{pl.title}</h4>
        <span>{pl._kind === 'youtube' ? (pl.count > 0 ? `${pl.count} videos` : 'YouTube') : `${pl.count} canciones`}</span>
      </div>
      {groupByCat && (
        <button className="playlist-merge-btn cat-tag-btn" title="Cambiar categoría" onClick={e => changeCat(pl._selId, e)}>🏷</button>
      )}
      <span className={`track-source-badge ${pl._kind === 'youtube' ? 'youtube' : 'ytmusic'}`}>{pl._kind === 'youtube' ? 'YT' : 'Music'}</span>
      {pl._kind === 'ytmusic' && (
        <button className="playlist-merge-btn" title="Asistente IA" onClick={e => { e.stopPropagation(); setAssistantSource({ kind: 'playlist', id: pl.id, title: pl.title }); setShowAssistant(true); }}>✨</button>
      )}
      <button className="playlist-merge-btn" title="Mezclar con bolsa actual" onClick={e => { e.stopPropagation(); pl._kind === 'youtube' ? loadYouTubePlaylist(pl.id, pl.title, true) : loadPlaylist(pl.id, pl.title, true); }}>✚</button>
    </motion.div>
    );
  };

  const renderSpotifyCard = (pl, i = 0) => {
    const cat = playlistCats[`spotify:${pl.id}`];
    return (
    <motion.div key={pl.id}
      className={`playlist-card ${selectedPlaylistId === `spotify:${pl.id}` ? 'active' : ''} ${cat ? 'has-cat' : ''}`}
      style={cat ? { '--cat-hue': catHue(cat.category) } : undefined}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: 'easeOut', delay: Math.min(i * 0.025, 0.4) }}
      draggable
      onDragStart={(e) => { dragPlIdRef.current = `spotify:${pl.id}`; e.dataTransfer.effectAllowed = 'move'; }}
      onClick={() => loadSpotifyPlaylist(pl.id, pl.title, false)}
    >
      <img src={pl.thumbnail} alt="" />
      <div className="playlist-meta">
        <h4>{pl.title}</h4>
        <span>{pl.count > 0 ? `${pl.count} canciones` : 'Spotify'}</span>
      </div>
      {groupByCat && (
        <button className="playlist-merge-btn cat-tag-btn" title="Cambiar categoría" onClick={e => changeCat(`spotify:${pl.id}`, e)}>🏷</button>
      )}
      <button className="playlist-merge-btn" style={{ borderColor: 'rgba(30,215,96,0.3)', color: 'hsl(141,74%,42%)' }} title="Mezclar con bolsa actual" onClick={e => { e.stopPropagation(); loadSpotifyPlaylist(pl.id, pl.title, true); }}>✚</button>
    </motion.div>
    );
  };

  const renderGrouped = (items, getId, renderCard) =>
    groupByCategory(items, getId).map((g) => {
      const noCat = g.name === 'Sin categoría';
      return (
        <div key={g.name} className="cat-group">
          <button
            className={`cat-header ${noCat ? 'no-cat' : ''}`}
            style={noCat ? undefined : { '--cat-hue': catHue(g.name) }}
            onClick={() => toggleCat(g.name)}
            onDragOver={(e) => { if (!noCat) { e.preventDefault(); e.currentTarget.classList.add('drop-hover'); } }}
            onDragLeave={(e) => e.currentTarget.classList.remove('drop-hover')}
            onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('drop-hover'); moveToCat(g.name, g.emoji); }}
          >
            <ChevronRight size={14} className={`cat-chevron ${collapsedCats[g.name] ? '' : 'open'}`} />
            <span className="cat-emoji">{g.emoji || '📂'}</span>
            <span className="cat-name">{g.name}</span>
            <span className="cat-count">{g.items.length}</span>
          </button>
          {!collapsedCats[g.name] && <div className="cat-items">{g.items.map(renderCard)}</div>}
        </div>
      );
    });

  // Botones de cabecera "Organizar con IA" / alternar agrupación, reutilizados en ambas pestañas.
  const renderOrganizeControls = (items, getId) => (
    <div className="lib-organize">
      <button className="text-btn" onClick={() => organizeLibrary(items, getId)} disabled={catLoading || !items.length}
        title="Agrupa tus playlists por género/tipo usando IA (Gemini)">
        {catLoading ? <Loader2 size={12} className="spin-icon" /> : <Sparkles size={12} />} {catLoading ? 'Organizando…' : 'Organizar'}
      </button>
      {Object.keys(playlistCats).length > 0 && (
        <button className={`text-btn ${groupByCat ? 'on' : ''}`} onClick={() => setGroupByCat(v => !v)}
          title={groupByCat ? 'Ver lista plana' : 'Agrupar por categoría'}>
          {groupByCat ? <FolderOpen size={12} /> : <Folder size={12} />} {groupByCat ? 'Agrupado' : 'Plano'}
        </button>
      )}
    </div>
  );

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
      {/* Overlay de carga: las listas grandes tardan en paginar; da feedback claro. */}
      {playlistLoading && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 18, background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(4px)',
        }}>
          <Loader2 size={46} className="spin-icon" style={{ color: 'var(--accent)' }} />
          <div style={{ color: '#fff', fontSize: '1rem', textAlign: 'center', maxWidth: '82vw', padding: '0 16px' }}>
            {playlistTitle}
          </div>
          {loadPct != null && (
            <div style={{ width: 'min(420px, 82vw)' }}>
              <div style={{ height: 6, borderRadius: 4, background: 'rgba(255,255,255,0.18)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${loadPct}%`, background: 'var(--accent)', transition: 'width 0.25s ease' }} />
              </div>
              <div style={{ textAlign: 'center', fontSize: '0.78rem', color: 'rgba(255,255,255,0.7)', marginTop: 6 }}>
                {loadMatch[1]} / {loadMatch[2]} canciones
              </div>
            </div>
          )}
          <div style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.55)' }}>Cargando, por favor espera…</div>
        </div>
      )}

      {/* Hidden audio element for fallback playback */}
      <audio ref={audioRef}
        onEnded={handleAudioEnded}
        onError={() => {
          if (usingFallbackRef.current) {
            usingFallbackRef.current = false;
            failCurrentAndAdvance('Error de audio directo. Probando la siguiente…');
          }
        }}
        onWaiting={onAudioWaiting}
        onStalled={onAudioWaiting}
        onPlaying={onAudioPlaying}
        preload="none"
      />

      {/* Ambient Background */}
      <div className="ambient-bg" style={{
        backgroundImage: currentTrack
          ? `radial-gradient(circle at 10% 20%, hsla(${ambientColor.h},${ambientColor.s}%,24%,0.45) 0%, transparent 40%),
             radial-gradient(circle at 90% 80%, hsla(${ambientColor.h},${Math.max(0, ambientColor.s - 12)}%,14%,0.5) 0%, transparent 40%),
             radial-gradient(circle at 50% 50%, rgba(6,4,4,0.92) 0%, rgba(0,0,0,1) 100%),
             url('${hiResArt(currentTrack.thumbnail, 640)}')`
          : undefined
      }} />

      <div className={`app-container${isCompact ? ' compact' : ''} mtab-${mobileTab}`}>
        {/* ═══════ SIDEBAR ═══════ */}
        <aside className="sidebar glass-panel">
          <div className="sidebar-header">
            <div className="logo">
              <Logo size={34} />
              <h2>Noir</h2>
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
                <div className="nav-section" style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <button className="action-btn" style={{ flex: 1 }} onClick={() => loadLocalFavorites(false)}
                    title="Reproducir tus canciones favoritas (guardadas con ♥)">
                    <Heart size={16} fill="var(--accent)" /> Mis favoritas ({Object.keys(favorites).length})
                  </button>
                  <button className="playlist-merge-btn" title="Mezclar favoritas con la bolsa actual" onClick={() => loadLocalFavorites(true)}>✚</button>
                </div>
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
                  <div className="lib-head">
                    <h3>Mi biblioteca</h3>
                    {authStatus.authenticated && combinedYtPlaylists.length > 0 && renderOrganizeControls(combinedYtPlaylists, catId.yt)}
                  </div>
                  {authStatus.authenticated && combinedYtPlaylists.length > 0 && (
                    <div className="pl-filter">
                      <Search size={13} />
                      <input placeholder="Filtrar playlists…" value={plFilter} onChange={e => setPlFilter(e.target.value)} />
                      {plFilter && <button title="Limpiar" onClick={() => setPlFilter('')}><X size={12} /></button>}
                    </div>
                  )}
                  <div className="playlists-container scrollable">
                    {!authStatus.authenticated ? (
                      <div className="list-placeholder">
                        <Lock className="placeholder-icon" size={32} />
                        <p>Inicia sesión con tu <code>oauth.json</code> para ver tu biblioteca.</p>
                      </div>
                    ) : (playlists.length === 0 && !ytPlaylistsLoaded) ? (
                      <SkeletonRows count={6} />
                    ) : combinedYtPlaylists.length === 0 ? (
                      <div className="list-placeholder-small">No se encontraron playlists</div>
                    ) : filterPls(combinedYtPlaylists).length === 0 ? (
                      <div className="list-placeholder-small">Sin coincidencias con «{plFilter}»</div>
                    ) : groupByCat ? (
                      renderGrouped(filterPls(combinedYtPlaylists), catId.yt, renderYtCard)
                    ) : (
                      filterPls(combinedYtPlaylists).map(renderYtCard)
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
                      <div className="lib-head">
                        <h3>Mis Playlists de Spotify</h3>
                        {spotifyPlaylists.length > 0 && renderOrganizeControls(spotifyPlaylists, catId.sp)}
                      </div>
                      {spotifyPlaylists.length > 0 && (
                        <div className="pl-filter">
                          <Search size={13} />
                          <input placeholder="Filtrar playlists…" value={plFilter} onChange={e => setPlFilter(e.target.value)} />
                          {plFilter && <button title="Limpiar" onClick={() => setPlFilter('')}><X size={12} /></button>}
                        </div>
                      )}
                      <div className="playlists-container scrollable">
                        {spotifyPlaylists.length === 0
                          ? (spotifyRetryIn != null
                              ? <div style={{ padding: '14px 10px', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                                  <Loader2 size={14} className="spin-icon" style={{ verticalAlign: 'middle' }} /> Spotify limitado (429).
                                  <div style={{ marginTop: 6 }}>Reintento automático en <strong style={{ color: 'var(--accent)' }}>{spotifyRetryIn}s</strong>…</div>
                                </div>
                              : spotifyPlError && !spotifyPlLoading
                                ? <div style={{ padding: '14px 10px', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                                    {spotifyPlError}
                                    <div style={{ marginTop: 10 }}>
                                      <button className="action-btn" onClick={fetchSpotifyPlaylists}><RefreshCw size={13} /> Reintentar</button>
                                    </div>
                                  </div>
                                : <SkeletonRows count={5} />)
                          : filterPls(spotifyPlaylists).length === 0
                            ? <div className="list-placeholder-small">Sin coincidencias con «{plFilter}»</div>
                            : groupByCat
                              ? renderGrouped(filterPls(spotifyPlaylists), catId.sp, renderSpotifyCard)
                              : filterPls(spotifyPlaylists).map(renderSpotifyCard)
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
                  <label>Buscar Música en {searchSource === 'spotify' ? 'Spotify' : 'YouTube'}</label>
                  <div className="nav-section" style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <button
                      type="button"
                      className={`nav-btn ${searchSource === 'youtube' ? 'active' : ''}`}
                      onClick={() => setSearchSource('youtube')}
                    >
                      <Music size={16} /> YouTube
                    </button>
                    <button
                      type="button"
                      className={`nav-btn ${searchSource === 'spotify' ? 'active' : ''} spotify-nav-btn`}
                      onClick={() => setSearchSource('spotify')}
                      disabled={!spotifyAuth.authenticated}
                      title={spotifyAuth.authenticated ? 'Buscar en Spotify' : 'Conecta Spotify para buscar ahí'}
                    >
                      <SpotifyIcon /> Spotify
                    </button>
                  </div>
                  <form onSubmit={handleGlobalSearch} className="input-group">
                    <input placeholder="Ej. The Weeknd Blinding Lights" value={globalSearchQuery}
                      onChange={e => setGlobalSearchQuery(e.target.value)}
                    />
                    <button type="submit" className="icon-btn" disabled={isSearching}>
                      <Search size={16} />
                    </button>
                  </form>
                  {isSearching && <span className="input-help">Buscando...</span>}
                  <span className="input-help">
                    {searchSource === 'spotify'
                      ? 'Busca canciones en Spotify (requiere Spotify Premium para reproducir).'
                      : `Busca cualquier canción. ${authStatus.authenticated ? '' : 'No requiere sesión.'}`}
                  </span>
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
            <button
              className={`settings-btn settings-toggle ${showSettings ? 'open' : ''}`}
              onClick={() => setShowSettings(s => !s)}
              aria-expanded={showSettings}
            >
              <span className="settings-toggle-label"><Settings size={16} /> Ajustes</span>
              <ChevronRight size={16} className="settings-chevron" />
            </button>

            {showSettings && (
              <div className="settings-collapse">
                <button className="settings-btn" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>
                  {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                  {theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
                </button>
                <button className="settings-btn" style={{ borderColor: spotifyViaYoutube ? 'rgba(30,215,96,0.3)' : undefined, color: spotifyViaYoutube ? 'hsl(141,74%,42%)' : undefined }}
                  onClick={() => { setSpotifyViaYoutube(v => !v); showToast(spotifyViaYoutube ? 'Spotify se reproducirá nativo (requiere Premium)' : 'Spotify se reproducirá vía YouTube'); }}
                  title="Reproducir las pistas de Spotify usando el audio de YouTube (sin Premium, inmune a los límites de Spotify)">
                  <Zap size={16} /> Spotify vía YouTube: {spotifyViaYoutube ? 'ON' : 'OFF'}
                </button>
                <button className="settings-btn" onClick={() => setShowStatsModal(true)}>
                  <BarChart2 size={16} /> Estadísticas
                </button>
                <button className="settings-btn" style={{ borderColor: eqEnabled ? 'var(--accent-glow)' : undefined, color: eqEnabled ? 'var(--accent)' : undefined }} onClick={() => setShowEq(true)}>
                  <Sliders size={16} /> Ecualizador{eqEnabled ? ' · ON' : ''}
                </button>
                <button className="settings-btn" onClick={openQuality}>
                  <Headphones size={16} /> Calidad · A/B
                </button>
                <button className="settings-btn" onClick={() => setShowShortcuts(true)}>
                  <Keyboard size={16} /> Atajos de teclado
                </button>
                <button className="settings-btn" onClick={() => setShowFavManager(true)}>
                  <Heart size={16} /> Gestionar favoritas
                </button>
                <button className="settings-btn" onClick={openAuthWizard}>
                  <Settings size={16} /> Configurar YT Music
                </button>
                <button className="settings-btn" style={{ borderColor: spotifyAuth.authenticated ? 'rgba(30,215,96,0.3)' : undefined }} onClick={() => setShowSpotifyModal(true)}>
                  <SpotifyIcon /> {spotifyAuth.authenticated ? `Spotify: ${spotifyAuth.user_name}` : 'Configurar Spotify'}
                </button>
              </div>
            )}

            <div className="session-block">
              <div className="session-label">
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
            <button className="volume-btn" onClick={() => setShowSavedLists(true)} title="Mis listas guardadas" style={{ marginLeft: 8 }}>
              <ListPlus size={18} />
            </button>
            <button className="volume-btn" onClick={() => setIsCompact(c => !c)} title={isCompact ? 'Expandir' : 'Modo compacto'} style={{ marginLeft: 8 }}>
              {isCompact ? <Maximize2 size={18} /> : <Minimize2 size={18} />}
            </button>
          </header>

          <div className="player-widget">
            {currentTrack?.thumbnail && (
              <div
                className="player-backdrop"
                aria-hidden="true"
                style={{ backgroundImage: `url('${hiResArt(currentTrack.thumbnail, 640)}')` }}
              />
            )}
            <div className="player-card glass-panel">
              {/* Artwork */}
              <div className={`artwork-container ${isPlaying ? 'playing' : ''}`} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} onMouseMove={handleArtTilt} onMouseLeave={resetArtTilt}>
                <img key={currentTrack?.thumbnail} className="art-fade" src={hiResArt(currentTrack?.thumbnail, 640) || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=600&auto=format&fit=crop'} alt="" />
                {currentTrack && (
                  <button className="expand-np-btn" onClick={() => setShowNowPlaying(true)} title="Pantalla completa">
                    <Maximize2 size={16} />
                  </button>
                )}
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
                  <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {currentTrack?.title || 'Selecciona música para empezar'}
                    </span>
                    {currentTrack && isBuffering ? (
                      <span className="engine-chip"><Loader2 size={11} className="spin-icon" /> Cargando</span>
                    ) : currentTrack && engineLabel ? (
                      <span className={`engine-chip ${engine === 'spotify' ? 'spotify' : 'warn'}`}>{engineLabel}</span>
                    ) : null}
                  </h2>
                  <p style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {currentTrack?.source === 'spotify' && <SpotifyIcon size={13} style={{ color: 'hsl(141,74%,42%)', flexShrink: 0 }} />}
                    {currentTrack?.artist || 'Listo para reproducir'}
                  </p>
                </div>
                <button className={`fav-btn ${isFavorite ? 'active' : ''}`}
                  onClick={toggleFavorite} title="Guardar en favoritas">
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
                <span onClick={() => setShowRemaining(s => !s)} style={{ cursor: 'pointer' }} title="Mostrar tiempo restante / total">
                  {showRemaining ? `-${fmt(Math.max(0, duration - currentTime))}` : fmt(duration)}
                </span>
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
                <Visualizer active={isPlaying} bars={20} style={{ width: 72, height: 26, flexShrink: 0 }} />
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
                <button className="volume-btn" onClick={() => setRepeatOne(r => !r)} title={repeatOne ? 'Repetir una: activado' : 'Repetir una: desactivado'} style={{ color: repeatOne ? 'var(--accent)' : undefined }}>
                  <Repeat1 size={16} />
                </button>
                <button className="volume-btn" onClick={() => setCrossfade(c => !c)} title={crossfade ? 'Desactivar crossfade' : 'Activar crossfade'} style={{ color: crossfade ? 'var(--accent)' : undefined }}>
                  <Zap size={16} />
                </button>
                {engine !== 'spotify' && (
                  <button className="volume-btn" onClick={cycleRate} title="Velocidad de reproducción"
                    style={{ color: playbackRate !== 1 ? 'var(--accent)' : undefined, width: 'auto', minWidth: 34, padding: '0 6px', fontSize: '0.72rem', fontWeight: 700 }}>
                    {playbackRate}x
                  </button>
                )}
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
              <div className="queue-header-actions">
                <button
                  className={`text-btn radio-btn ${radioMode ? 'radio-on' : ''}`}
                  onClick={() => {
                    const on = !radioMode;
                    radioModeRef.current = on; // eager: maybeRefillRadio lee el ref, no el estado
                    setRadioMode(on);
                    if (on) {
                      showToast('📻 Radio infinita activada: la bolsa se extenderá sola con temas afines.');
                      // Si ya quedan pocas por sonar, siembra ahora mismo.
                      if (bagRef.current.length <= RADIO_LOW_WATER && currentRef.current) maybeRefillRadio(currentRef.current);
                    } else {
                      showToast('Radio infinita desactivada.');
                    }
                  }}
                  title="Radio infinita: cuando la bolsa se agota, añade automáticamente temas relacionados (automix de YouTube Music) para que la música no pare."
                >
                  <Radio size={12} className={radioLoading ? 'icon-pulse' : ''} /> Radio{radioMode ? ' ON' : ''}
                </button>
                <button className="text-btn" onClick={reshuffleBag} title="Rebaraja el orden de las canciones que quedan por sonar (mantiene el shuffle real: no repite hasta agotar la bolsa).">
                  <RefreshCw size={12} className={reshuffling ? 'icon-spin' : ''} /> Rebarajar
                </button>
                <button className="text-btn" onClick={() => { if (!allTracks.length) return showToast('Carga algo en la bolsa primero.', true); setShowCreatePl(true); }} title="Crea una playlist nueva con las canciones cargadas y súbela a tu YouTube Music o Spotify" disabled={!allTracks.length}>
                  <ListPlus size={12} /> Crear playlist
                </button>
                <button className="text-btn" onClick={clearQueue} title="Vacía la cola y la bolsa y detiene la reproducción">
                  <Trash2 size={12} /> Limpiar
                </button>
              </div>
            )}
          </div>

          {!searchQuery.trim() && (
            <div className="shuffle-stats">
              <div className={`bag-loaded ${allTracks.length ? 'has' : ''}`}>
                {allTracks.length > 0 ? (
                  <><span className="bag-loaded-dot" /> <strong>{playlistTitle}</strong> · {allTracks.length} {allTracks.length === 1 ? 'canción' : 'canciones'}</>
                ) : (
                  <><span className="bag-loaded-dot" /> Nada cargado en la bolsa</>
                )}
              </div>
              <div className="bag-meter">
                <div className="bag-meter-main">
                  <span className={`bag-meter-num ${bagFlash ? 'flash' : ''}`}>{shuffleBag.length}</span>
                  <span className="bag-meter-sub">por sonar de {allTracks.length}</span>
                </div>
                <span className="bag-meter-pct">{Math.round(bagProgress)}%</span>
              </div>
              <div className="bag-progress"><div className={`bag-progress-fill ${bagFlash ? 'flash' : ''}`} style={{ width: `${bagProgress}%` }} /></div>
              {bagRemainingSec > 0 && (
                <span className="bag-time"><Timer size={11} /> ≈ {fmtLong(bagRemainingSec)} por sonar</span>
              )}
              <span className="bag-desc">Shuffle REAL: no se repite ninguna canción hasta agotar la bolsa.</span>
              {radioMode && (
                <span className="bag-desc radio-hint">
                  <Radio size={11} className={radioLoading ? 'icon-pulse' : ''} /> Radio infinita activa: la bolsa se extiende sola con temas afines.
                </span>
              )}
              {unavailableCount > 0 && (
                <span className="bag-desc" style={{ color: 'var(--accent)' }}>
                  {allTracks.length} de {allTracks.length + unavailableCount} · {unavailableCount} no disponibles (borradas/región)
                </span>
              )}
            </div>
          )}

          <div className="queue-lists-container">
            {!searchQuery.trim() && (
              <div className="queue-nav">
                <button className={`queue-nav-btn ${queueTab === 'next' ? 'active' : ''}`} onClick={() => setQueueTab('next')}>
                  Siguientes <span className="qn-count">{nextList.length}</span>
                </button>
                <button className={`queue-nav-btn ${queueTab === 'history' ? 'active' : ''}`} onClick={() => setQueueTab('history')}>
                  Sonadas <span className="qn-count">{playedHistory.length}</span>
                </button>
              </div>
            )}

            {searchQuery.trim() ? (
              <VirtualList
                className="queue-content scrollable"
                items={searchResults}
                resetKey={searchQuery}
                itemHeight={60}
                getKey={(t) => t.id}
                emptyContent={<EmptyState icon={<Search size={28} />}>Sin resultados</EmptyState>}
                renderItem={(t) => (
                  <div className={`queue-track-card ${currentTrack?.id === t.id ? 'active' : ''}`}
                    onClick={() => { selectFromQueue(t); setSearchQuery(''); }}>
                    <span className="queue-thumb">
                      <img src={t.thumbnail} alt="" loading="lazy" />
                      {currentTrack?.id === t.id && <span className="eq-bars"><i /><i /><i /></span>}
                    </span>
                    <div className="queue-track-meta"><h4>{t.title}</h4><span>{t.artist}</span></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {t.source && <span className={`track-source-badge ${t.source}`}>{t.source === 'spotify' ? 'SP' : 'YT'}</span>}
                      <div className="queue-track-duration">{t.duration}</div>
                      <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 6px', borderRadius: 6, fontSize: '0.7rem' }} title="Reproducir siguiente" onClick={e => addToNext(t, e)}>+next</button>
                    </div>
                  </div>
                )}
              />
            ) : queueTab === 'next' ? (
              <VirtualList
                className="queue-content scrollable"
                items={nextList}
                resetKey={selectedPlaylistId}
                itemHeight={60}
                getKey={(it, i) => (it.pq ? `pq-${it.t.id}-${i}` : it.t.id)}
                emptyContent={<EmptyState icon={<ListMusic size={28} />}>Bolsa vacía</EmptyState>}
                renderItem={(it) => {
                  const t = it.t;
                  if (it.pq) {
                    const i = it.pqIndex;
                    return (
                      <div className="queue-track-card pq"
                        draggable
                        onDragStart={(e) => { dragPqIndex.current = i; e.dataTransfer.effectAllowed = 'move'; }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => { e.preventDefault(); reorderPq(dragPqIndex.current, i); dragPqIndex.current = null; }}
                        onDragEnd={() => { dragPqIndex.current = null; }}
                        onClick={() => { const pq = priorityQueue.filter((_, idx) => idx !== i); setPriorityQueue(pq); priorityQueueRef.current = pq; selectFromQueue(t); }}>
                        <span title="Arrastra para reordenar" style={{ cursor: 'grab', color: 'var(--text-muted)', flexShrink: 0, fontSize: '0.9rem', lineHeight: 1 }} onClick={(e) => e.stopPropagation()}>⠿</span>
                        <span className="queue-thumb"><img src={t.thumbnail} alt="" loading="lazy" /></span>
                        <div className="queue-track-meta"><h4 style={{ color: 'var(--accent)' }}>{t.title}</h4><span>{t.artist}</span></div>
                        {t.source && <span className={`track-source-badge ${t.source}`}>{t.source === 'spotify' ? 'SP' : 'YT'}</span>}
                        <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }} onClick={e => { e.stopPropagation(); const pq = priorityQueue.filter((_, idx) => idx !== i); setPriorityQueue(pq); priorityQueueRef.current = pq; }}>✕</button>
                      </div>
                    );
                  }
                  return (
                    <div className={`queue-track-card ${currentTrack?.id === t.id ? 'active' : ''}`}
                      onClick={() => selectFromQueue(t)}>
                      <span className="queue-thumb">
                        <img src={t.thumbnail} alt="" loading="lazy" />
                        {currentTrack?.id === t.id && <span className="eq-bars"><i /><i /><i /></span>}
                      </span>
                      <div className="queue-track-meta"><h4>{t.title}</h4><span>{t.artist}</span></div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {t.radio && <span className="radio-track-badge" title="Añadida por la radio infinita"><Radio size={10} /></span>}
                        {t.source && <span className={`track-source-badge ${t.source}`}>{t.source === 'spotify' ? 'SP' : 'YT'}</span>}
                        <div className="queue-track-duration">{t.duration}</div>
                        <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 6px', borderRadius: 6, fontSize: '0.7rem' }} title="Reproducir siguiente" onClick={e => addToNext(t, e)}>+next</button>
                      </div>
                    </div>
                  );
                }}
              />
            ) : (
              <VirtualList
                className="queue-content scrollable"
                items={historyList}
                resetKey={selectedPlaylistId}
                itemHeight={60}
                getKey={(t) => t.id}
                emptyContent={<EmptyState icon={<ListMusic size={28} />}>Ninguna canción reproducida aún</EmptyState>}
                renderItem={(t) => (
                  <div className={`queue-track-card ${currentTrack?.id === t.id ? 'active' : ''}`}
                    onClick={() => rollbackTo(t)}>
                    <span className="queue-thumb">
                      <img src={t.thumbnail} alt="" loading="lazy" />
                      {currentTrack?.id === t.id && <span className="eq-bars"><i /><i /><i /></span>}
                    </span>
                    <div className="queue-track-meta"><h4>{t.title}</h4><span>{t.artist}</span></div>
                    {t.source && <span className={`track-source-badge ${t.source}`}>{t.source === 'spotify' ? 'SP' : 'YT'}</span>}
                    <div className="queue-track-duration">{t.duration}</div>
                  </div>
                )}
              />
            )}
          </div>
        </section>
      </div>

      {/* Barra de navegación inferior — solo visible en móvil (CSS). Una vista a la vez. */}
      <nav className="mobile-tabbar">
        <button className={mobileTab === 'player' ? 'active' : ''} onClick={() => setMobileTab('player')}>
          <Music size={20} /> Reproductor
        </button>
        <button className={mobileTab === 'library' ? 'active' : ''} onClick={() => setMobileTab('library')}>
          <ListMusic size={20} /> Biblioteca
        </button>
        <button className={mobileTab === 'queue' ? 'active' : ''} onClick={() => setMobileTab('queue')}>
          <ListPlus size={20} /> Cola
        </button>
      </nav>

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

      <SleepTimerModal
        show={showSleepModal}
        sleepTimer={sleepTimer}
        onActivate={activateSleepTimer}
        onClose={() => setShowSleepModal(false)}
      />

      <StatsModal show={showStatsModal} onClose={() => setShowStatsModal(false)} />

      <EqualizerModal
        show={showEq}
        onClose={() => setShowEq(false)}
        enabled={eqEnabled}
        onToggle={toggleEq}
        bands={eqBands}
        onBandsChange={setEqBands}
        engine={engine}
        playerMode={playerMode}
        normalizeEnabled={normalizeEnabled}
        onToggleNormalize={toggleNormalize}
      />

      <QualityModal
        show={showQuality}
        onClose={() => setShowQuality(false)}
        ctx={qualityCtx}
        onPlayVia={playSameFrom}
        spotifyAuthed={spotifyAuth.authenticated}
      />

      <ShortcutsModal show={showShortcuts} onClose={() => setShowShortcuts(false)} />

      <FavoritesModal
        show={showFavManager}
        favorites={favorites}
        onClose={() => setShowFavManager(false)}
        onRemove={removeFavorite}
        onClear={clearFavorites}
        onExport={exportFavorites}
        onImport={importFavorites}
        onPlay={(t) => {
          const cur = currentRef.current;
          const hist = cur ? [...historyRef.current, cur] : [...historyRef.current];
          doPlayTrack(t, bagRef.current, hist);
          setShowFavManager(false);
        }}
      />

      <AssistantModal
        show={showAssistant}
        source={assistantSource}
        onClose={() => setShowAssistant(false)}
        onPlayTracks={(tracks, label) => { initShuffleBag(tracks, label); setShowAssistant(false); }}
        onAddToBag={(tracks, label) => addToShuffleBag(tracks, label)}
        onAddNext={(t) => addToNext(t, { stopPropagation() {} })}
        showToast={showToast}
      />

      <SavedListsModal
        show={showSavedLists}
        onClose={() => setShowSavedLists(false)}
        currentTracks={allTracks}
        currentTitle={playlistTitle}
        onPlayTracks={(tracks, label) => { initShuffleBag(tracks, label); setShowSavedLists(false); }}
        onMixTracks={(tracks, label) => { addToShuffleBag(tracks, label); setShowSavedLists(false); }}
        showToast={showToast}
      />

      <CreatePlaylistModal
        show={showCreatePl}
        onClose={() => setShowCreatePl(false)}
        tracks={allTracks}
        defaultName={playlistTitle && playlistTitle !== 'Sin título' ? playlistTitle : 'Mi mezcla'}
        ytAuthed={authStatus.authenticated}
        spotifyAuthed={spotifyAuth.authenticated}
        spotifyCanModify={!!spotifyAuth.can_modify_playlists}
        onReconnectSpotify={() => { setShowCreatePl(false); setShowSpotifyModal(true); }}
        showToast={showToast}
      />

      <NowPlaying
        show={showNowPlaying}
        track={currentTrack}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        progress={progress}
        fmt={fmt}
        engineLabel={engineLabel}
        isBuffering={isBuffering}
        isFavorite={isFavorite}
        nextUp={upcoming.length ? upcoming[upcoming.length - 1] : null}
        volume={volume}
        isMuted={isMuted}
        VolumeIcon={VolumeIcon}
        onClose={() => setShowNowPlaying(false)}
        onTogglePlay={togglePlayPause}
        onNext={doNextTrack}
        onPrev={doPrevTrack}
        onToggleFav={toggleFavorite}
        onToggleMute={toggleMute}
        onSeekPointerDown={handleProgressPointerDown}
        onSeekPointerMove={handleProgressPointerMove}
        onVolPointerDown={handleVolumePointerDown}
        onVolPointerMove={handleVolumePointerMove}
      />

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
