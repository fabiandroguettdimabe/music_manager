import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { motion } from 'motion/react';
import {
  Play, Pause, SkipForward, SkipBack, Heart,
  Settings, Search, Music, Link2, ListMusic, X,
  RefreshCw, Volume2, Volume1, Volume, VolumeX, Tv, Lock, ChevronRight,
  Sun, Moon, Timer, BarChart2, Minimize2, Maximize2, Zap, Loader2, Repeat1, Keyboard, ListPlus, Trash2, Radio, Sliders, Headphones,
  Sparkles, Folder, FolderOpen, Disc3, CheckCircle2, AlertCircle, Shuffle, Eye, EyeOff, Download
} from 'lucide-react';
import './index.css';
import { cachePlaylist, getCachedPlaylist } from './utils/playlistCache.js';
import { hiResArt } from './utils/art.js';
import { durToSecs, fmtLong, fisherYates } from './utils/playback.js';
import { saveOffline, getOfflineBlob, listOffline, clearOffline, storageInfo, requestPersist } from './utils/offlineStore.js';
import Toast from './components/ui/Toast.jsx';
import AuthWizard from './components/auth/AuthWizard';
import SpotifyAuthWizard from './components/auth/SpotifyAuthWizard';
import LoginScreen from './auth/LoginScreen';
import { apiMe, apiLogout } from './auth/apiClient';
import VirtualList from './components/ui/VirtualList';
import Logo from './components/ui/Logo';
import { SkeletonRows, EmptyState } from './components/ui/Skeleton';
import NowPlaying from './components/player/NowPlaying';
import Visualizer from './components/player/Visualizer';

const SleepTimerModal = lazy(() => import('./components/modals/SleepTimerModal'));
const StatsModal = lazy(() => import('./components/modals/StatsModal'));
const ShortcutsModal = lazy(() => import('./components/modals/ShortcutsModal'));
const FavoritesModal = lazy(() => import('./components/modals/FavoritesModal'));
const AssistantModal = lazy(() => import('./components/modals/AssistantModal'));
const SavedListsModal = lazy(() => import('./components/modals/SavedListsModal'));
const CreatePlaylistModal = lazy(() => import('./components/modals/CreatePlaylistModal'));
const EqualizerModal = lazy(() => import('./components/modals/EqualizerModal'));
const QualityModal = lazy(() => import('./components/modals/QualityModal'));

function Deferred({ open, children }) {
  const [mount, setMount] = useState(open);
  useEffect(() => { if (open) setMount(true); }, [open]);
  if (!mount) return null;
  return <Suspense fallback={null}>{children}</Suspense>;
}

const SESSION_KEY = 'rsp_session_v1';
const EQ_FREQS = [60, 230, 910, 3600, 14000];

function SpotifyIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
    </svg>
  );
}

export default function App() {
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
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchSource, setSearchSource] = useState('youtube');
  const [searchType, setSearchType] = useState('songs');
  const [playlistResults, setPlaylistResults] = useState([]);
  const [isFavorite, setIsFavorite] = useState(false);
  const [repeatOne, setRepeatOne] = useState(false);
  const repeatOneRef = useRef(false);
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('rsp_favorites') || '{}'); } catch { return {}; }
  });
  const favoritesRef = useRef(favorites);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showFavManager, setShowFavManager] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const playbackRateRef = useRef(1);
  const [showRemaining, setShowRemaining] = useState(false);
  const [playlistTitle, setPlaylistTitle] = useState('Ninguna playlist seleccionada');

  const [authStatus, setAuthStatus] = useState({ authenticated: false, oauth_exists: false });
  const [playlists, setPlaylists] = useState([]);
  const [youtubePlaylists, setYoutubePlaylists] = useState([]);
  const [ytPlaylistsLoaded, setYtPlaylistsLoaded] = useState(false);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(null);
  const [mergingIds, setMergingIds] = useState(() => new Set());
  const startMerge = (sid) => setMergingIds((p) => new Set(p).add(sid));
  const endMerge = (sid) => setMergingIds((p) => { const n = new Set(p); n.delete(sid); return n; });
  const [playlistCats, setPlaylistCats] = useState(() => {
    try { return JSON.parse(localStorage.getItem('playlistCats') || '{}'); } catch { return {}; }
  });
  const [collapsedCats, setCollapsedCats] = useState(() => {
    try { return JSON.parse(localStorage.getItem('collapsedCats') || '{}'); } catch { return {}; }
  });
  const [catOrder, setCatOrder] = useState(() => {
    try { return JSON.parse(localStorage.getItem('catOrder') || '[]'); } catch { return []; }
  });
  const [groupByCat, setGroupByCat] = useState(() => localStorage.getItem('groupByCat') === '1');
  const [catLoading, setCatLoading] = useState(false);
  const [plFilter, setPlFilter] = useState('');
  const dragPlIdRef = useRef(null);
  const [showCreatePl, setShowCreatePl] = useState(false);
  const [externalId, setExternalId] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);

  const [playerMode, setPlayerMode] = useState('youtube');
  const [spotifyAuth, setSpotifyAuth] = useState({ authenticated: false, token_exists: false });
  const [spotifyPlaylists, setSpotifyPlaylists] = useState([]);
  const [spotifyPlLoading, setSpotifyPlLoading] = useState(false);
  const [spotifyPlError, setSpotifyPlError] = useState(null);
  const [spotifyRetryIn, setSpotifyRetryIn] = useState(null);
  const spotifyRetryTimer = useRef(null);
  const retryRemainingRef = useRef(0);
  const [showSpotifyModal, setShowSpotifyModal] = useState(false);

  const [appUser, setAppUser] = useState(undefined);

  const [toasts, setToasts] = useState([]);
  const showToast = useCallback((message, isError = false) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, isError }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  const [theme, setTheme] = useState(() => localStorage.getItem('rsp_theme') || 'dark');
  const [mobileTab, setMobileTab] = useState('player');
  const [spotifyViaYoutube, setSpotifyViaYoutube] = useState(() => localStorage.getItem('rsp_sp_via_yt') !== '0');
  const spotifyViaYoutubeRef = useRef(true);
  const ytMatchCacheRef = useRef(new Map());

  const [sleepTimer, setSleepTimer] = useState(null);
  const [showSleepModal, setShowSleepModal] = useState(false);
  const sleepTimerRef = useRef(null);

  const [showStatsModal, setShowStatsModal] = useState(false);
  const [isCompact, setIsCompact] = useState(false);

  const [showAssistant, setShowAssistant] = useState(false);
  const [assistantSource, setAssistantSource] = useState(null);

  const [showSavedLists, setShowSavedLists] = useState(false);

  const [showNowPlaying, setShowNowPlaying] = useState(false);

  // Descargas offline (IndexedDB): claves descargadas, lista de metadatos, uso de disco.
  const [offlineKeys, setOfflineKeys] = useState(() => new Set());
  const [offlineList, setOfflineList] = useState([]);
  const [offlineStorageInfo, setOfflineStorageInfo] = useState(null);
  const [downloadingKeys, setDownloadingKeys] = useState(() => new Set());
  const offlineMapRef = useRef(new Map()); // origKey/ytId → ytId (reproducir offline sin red)
  const downloadingRef = useRef(new Set());
  const lastBlobUrlRef = useRef(null);

  const [engine, setEngine] = useState('youtube');
  const [isBuffering, setIsBuffering] = useState(false);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [unavailableCount, setUnavailableCount] = useState(0);

  const [crossfade, setCrossfade] = useState(true);
  const crossfadeRef = useRef(true);
  const fadeIntervalRef = useRef(null);

  const [priorityQueue, setPriorityQueue] = useState([]);
  const priorityQueueRef = useRef([]);

  const [radioMode, setRadioMode] = useState(() => localStorage.getItem('rsp_radio') === '1');
  const radioModeRef = useRef(radioMode);
  const radioFetchingRef = useRef(false);
  const [radioLoading, setRadioLoading] = useState(false);

  const [reshuffling, setReshuffling] = useState(false);
  const [bagFlash, setBagFlash] = useState(false);
  const [autoReshuffle, setAutoReshuffle] = useState(() => localStorage.getItem('rsp_autoshuffle') === '1');
  const autoReshuffleRef = useRef(autoReshuffle);
  const [reordenAvoid, setReordenAvoid] = useState(() => {
    const v = parseInt(localStorage.getItem('rsp_reorden_avoid') || '', 10);
    return Number.isFinite(v) ? v : 8;
  });
  const reordenAvoidRef = useRef(reordenAvoid);
  const [peekEnabled, setPeekEnabled] = useState(() => localStorage.getItem('rsp_reorden_peek') === '1');
  const peekEnabledRef = useRef(peekEnabled);
  const reordenPeekRef = useRef(null);
  const [reordenPeekView, setReordenPeekView] = useState(null);

  const [discoverMode, setDiscoverMode] = useState(() => localStorage.getItem('rsp_discover') === '1');
  const discoverModeRef = useRef(discoverMode);
  const discoverFetchingRef = useRef(false);
  const discoverTickRef = useRef(0);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [mixLoadingId, setMixLoadingId] = useState(null);
  const [moodOpen, setMoodOpen] = useState(false);
  const [moodLoading, setMoodLoading] = useState(null);

  const [eqEnabled, setEqEnabled] = useState(() => localStorage.getItem('rsp_eq_on') === '1');
  const eqEnabledRef = useRef(eqEnabled);
  const hifiModeRef = useRef(eqEnabled);
  const [eqBands, setEqBands] = useState(() => {
    try {
      const b = JSON.parse(localStorage.getItem('rsp_eq') || 'null');
      return Array.isArray(b) && b.length === EQ_FREQS.length ? b : EQ_FREQS.map(() => 0);
    } catch { return EQ_FREQS.map(() => 0); }
  });
  const audioCtxRef = useRef(null);
  const eqNodesRef = useRef(null);
  const normGainRef = useRef(null);
  const [showEq, setShowEq] = useState(false);
  const [normalizeEnabled, setNormalizeEnabled] = useState(() => localStorage.getItem('rsp_norm') === '1');
  const normalizeEnabledRef = useRef(normalizeEnabled);

  const [preferDirect, setPreferDirect] = useState(() => localStorage.getItem('rsp_direct') !== '0');
  const preferDirectRef = useRef(preferDirect);
  const [djFilter, setDjFilter] = useState(0);
  const [djEcho, setDjEcho] = useState(false);
  const djFilterRef = useRef(0);
  const djEchoRef = useRef(false);
  const analyserRef = useRef(null);
  const isVideoVisibleRef = useRef(false);
  const directCodecRef = useRef('hq');
  const directOnFailRef = useRef('skip');
  const directSettlingRef = useRef(false);

  const [showQuality, setShowQuality] = useState(false);
  const [qualityCtx, setQualityCtx] = useState(null);

  const ytPlayerRef = useRef(null);
  const audioRef = useRef(null);
  const usingFallbackRef = useRef(false);
  const progressTimerRef = useRef(null);
  const ytReadyRef = useRef(false);
  const skipDebounceRef = useRef(false);
  const mediaAnchorRef = useRef(null);
  const ytAutoConnectDisabledRef = useRef(false);
  const lastCaptureAttemptRef = useRef(0);
  const lastVisibilityRevalidateRef = useRef(0);
  const lastPrefetchedRef = useRef(null);
  const stallTimerRef = useRef(null);
  const stallCountRef = useRef(0);
  const consecutiveFailuresRef = useRef(0);
  const ytWatchdogRef = useRef(null);
  const ytConfirmedRef = useRef(false);
  const breakerTrippedRef = useRef(false);
  const deadTracksRef = useRef(new Set());
  const pendingResumeRef = useRef(null);
  const startedRef = useRef(false);
  const lastTimeRef = useRef(0);

  const spotifyPlayerRef = useRef(null);
  const spotifyDeviceIdRef = useRef(null);
  const spotifyReadyRef = useRef(false);
  const spotifyPrevPosRef = useRef(0);
  const playerModeRef = useRef('youtube');

  const bagRef = useRef([]);
  const historyRef = useRef([]);
  const currentRef = useRef(null);
  const allRef = useRef([]);
  const volumeRef = useRef(80);
  const mutedRef = useRef(false);
  const isPlayingRef = useRef(false);

  useEffect(() => { bagRef.current = shuffleBag; }, [shuffleBag]);
  useEffect(() => { historyRef.current = playedHistory; }, [playedHistory]);
  useEffect(() => { currentRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { allRef.current = allTracks; }, [allTracks]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { mutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { playerModeRef.current = playerMode; }, [playerMode]);
  useEffect(() => { crossfadeRef.current = crossfade; }, [crossfade]);
  useEffect(() => { priorityQueueRef.current = priorityQueue; }, [priorityQueue]);
  useEffect(() => { repeatOneRef.current = repeatOne; }, [repeatOne]);
  useEffect(() => {
    radioModeRef.current = radioMode;
    try { localStorage.setItem('rsp_radio', radioMode ? '1' : '0'); } catch { }
  }, [radioMode]);
  useEffect(() => {
    autoReshuffleRef.current = autoReshuffle;
    try { localStorage.setItem('rsp_autoshuffle', autoReshuffle ? '1' : '0'); } catch { }
  }, [autoReshuffle]);
  useEffect(() => {
    eqEnabledRef.current = eqEnabled;
    try { localStorage.setItem('rsp_eq_on', eqEnabled ? '1' : '0'); } catch { }
  }, [eqEnabled]);
  useEffect(() => {
    normalizeEnabledRef.current = normalizeEnabled;
    try { localStorage.setItem('rsp_norm', normalizeEnabled ? '1' : '0'); } catch { }
  }, [normalizeEnabled]);
  useEffect(() => { hifiModeRef.current = eqEnabled || normalizeEnabled; }, [eqEnabled, normalizeEnabled]);
  useEffect(() => {
    preferDirectRef.current = preferDirect;
    try { localStorage.setItem('rsp_direct', preferDirect ? '1' : '0'); } catch { }
  }, [preferDirect]);
  useEffect(() => { djFilterRef.current = djFilter; applyDjFilter(djFilter); }, [djFilter]);
  useEffect(() => { djEchoRef.current = djEcho; applyDjEcho(djEcho); }, [djEcho]);
  useEffect(() => { isVideoVisibleRef.current = isVideoVisible; }, [isVideoVisible]);
  useEffect(() => {
    try { localStorage.setItem('rsp_eq', JSON.stringify(eqBands)); } catch { }
    applyEqGains(eqBands);
  }, [eqBands]);
  useEffect(() => { playbackRateRef.current = playbackRate; }, [playbackRate]);
  useEffect(() => {
    favoritesRef.current = favorites;
    try { localStorage.setItem('rsp_favorites', JSON.stringify(favorites)); } catch { }
  }, [favorites]);
  useEffect(() => {
    try { localStorage.setItem('playlistCats', JSON.stringify(playlistCats)); } catch { }
  }, [playlistCats]);
  useEffect(() => {
    try { localStorage.setItem('collapsedCats', JSON.stringify(collapsedCats)); } catch { }
  }, [collapsedCats]);
  useEffect(() => {
    try { localStorage.setItem('catOrder', JSON.stringify(catOrder)); } catch { }
  }, [catOrder]);
  useEffect(() => {
    try { localStorage.setItem('groupByCat', groupByCat ? '1' : '0'); } catch { }
  }, [groupByCat]);

  const touchStartRef = useRef(null);

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
      const djHPF = ctx.createBiquadFilter();
      djHPF.type = 'highpass'; djHPF.frequency.value = 20; djHPF.Q.value = 0.7;
      const djLPF = ctx.createBiquadFilter();
      djLPF.type = 'lowpass'; djLPF.frequency.value = 22050; djLPF.Q.value = 0.7;
      const normGain = ctx.createGain();
      normGain.gain.value = 1;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.8;
      const echoDelay = ctx.createDelay(2.0);
      echoDelay.delayTime.value = 0.3;
      const echoFeedback = ctx.createGain(); echoFeedback.gain.value = 0;
      const echoWet = ctx.createGain(); echoWet.gain.value = 0;

      let node = source;
      for (const f of filters) { node.connect(f); node = f; }
      node.connect(djHPF); djHPF.connect(djLPF); djLPF.connect(normGain);
      normGain.connect(analyser);
      analyser.connect(ctx.destination);
      normGain.connect(echoDelay);
      echoDelay.connect(echoFeedback); echoFeedback.connect(echoDelay);
      echoDelay.connect(echoWet); echoWet.connect(analyser);

      audioCtxRef.current = ctx;
      normGainRef.current = normGain;
      analyserRef.current = analyser;
      eqNodesRef.current = { ctx, source, filters, normGain, djHPF, djLPF, analyser, echoDelay, echoFeedback, echoWet };
      applyDjFilter(djFilterRef.current);
      applyDjEcho(djEchoRef.current);
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

  const applyDjFilter = (val) => {
    const g = eqNodesRef.current;
    if (!g || !g.djLPF || !g.djHPF) return;
    const ctx = g.ctx; const t = ctx ? ctx.currentTime : 0;
    let lpf = 22050, hpf = 20;
    if (val < 0) { const x = Math.min(1, -val / 100); lpf = 22050 * Math.pow(180 / 22050, x); }
    else if (val > 0) { const x = Math.min(1, val / 100); hpf = 20 * Math.pow(7000 / 20, x); }
    try { g.djLPF.frequency.setTargetAtTime(lpf, t, 0.04); g.djHPF.frequency.setTargetAtTime(hpf, t, 0.04); }
    catch { g.djLPF.frequency.value = lpf; g.djHPF.frequency.value = hpf; }
  };

  const applyDjEcho = (on) => {
    const g = eqNodesRef.current;
    if (!g || !g.echoWet || !g.echoFeedback) return;
    const ctx = g.ctx; const t = ctx ? ctx.currentTime : 0;
    const wet = on ? 0.32 : 0; const fb = on ? 0.4 : 0;
    try { g.echoWet.gain.setTargetAtTime(wet, t, 0.08); g.echoFeedback.gain.setTargetAtTime(fb, t, 0.08); }
    catch { g.echoWet.gain.value = wet; g.echoFeedback.gain.value = fb; }
  };

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
    } catch { }
  };

  const resumeAudioCtx = () => {
    const ctx = eqNodesRef.current?.ctx;
    if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch { } }
  };

  const getCurrentPlaybackTime = () => {
    try {
      if (usingFallbackRef.current && audioRef.current) return audioRef.current.currentTime || 0;
      if (ytPlayerRef.current && ytReadyRef.current) return ytPlayerRef.current.getCurrentTime() || 0;
    } catch { }
    return 0;
  };

  const getEngineDuration = () => {
    try {
      if (usingFallbackRef.current && audioRef.current && isFinite(audioRef.current.duration)) return audioRef.current.duration || 0;
      if (ytPlayerRef.current && ytReadyRef.current) return ytPlayerRef.current.getDuration?.() || 0;
    } catch { }
    return 0;
  };

  const seekToSeconds = (t) => {
    const dur = getEngineDuration();
    const clamped = dur > 0 ? Math.max(0, Math.min(t, dur)) : Math.max(0, t);
    if (playerModeRef.current === 'spotify' && spotifyPlayerRef.current) spotifyPlayerRef.current.seek(Math.round(clamped * 1000));
    else if (usingFallbackRef.current && audioRef.current) audioRef.current.currentTime = clamped;
    else if (ytPlayerRef.current && ytReadyRef.current) ytPlayerRef.current.seekTo(clamped, true);
    setCurrentTime(clamped); lastTimeRef.current = clamped;
    updateMediaPositionState(clamped, dur);
  };

  const updateMediaPositionState = (position, dur) => {
    if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;
    if (!dur || !isFinite(dur) || dur <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: dur,
        position: Math.max(0, Math.min(position, dur)),
        playbackRate: playbackRateRef.current || 1,
      });
    } catch { }
  };

  const ensureMediaAnchor = () => {
    if (!mediaAnchorRef.current) {
      const el = new Audio('/silence.wav');
      el.loop = true;
      el.preload = 'auto';
      mediaAnchorRef.current = el;
    }
    return mediaAnchorRef.current;
  };

  const loadSpotifySDK = () => {
    if (window.Spotify?.Player) { initSpotifyPlayer(); return; }
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    document.body.appendChild(s);
    window.onSpotifyWebPlaybackSDKReady = initSpotifyPlayer;
  };

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
        spotifyDeviceIdRef.current = null;
        spotifyReadyRef.current = false;
        setTimeout(() => { if (spotifyPlayerRef.current) spotifyPlayerRef.current.connect(); }, 3000);
      });
      player.addListener('initialization_error', ({ message }) => { showToast('Error al inicializar Spotify: ' + message, true); });
      player.addListener('authentication_error', ({ message }) => { showToast('Spotify no pudo iniciar el reproductor.', true); });
      player.addListener('account_error', ({ message }) => { showToast('Spotify Premium requerido.', true); });
      player.addListener('playback_error', ({ message }) => { if (playerModeRef.current === 'spotify' && allRef.current.length > 0) failCurrentAndAdvance('Error de Spotify, pasando...'); });
      player.addListener('player_state_changed', (state) => {
        if (!state || playerModeRef.current !== 'spotify') return;
        const cur = state.track_window?.current_track;
        if (!cur) return;
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
        const reachedEnd = (pos >= dur - 1.5 && pos > 0) || (pos === 0 && prevPos > 0 && prevPos >= dur - 3);
        if (allRef.current.length > 0 && dur > 0 && state.paused && reachedEnd) { onTrackEnded(); return; }
        if (state.paused) { setIsPlaying(false); stopProgressTimer(); }
        else { setIsPlaying(true); startProgressTimer('spotify'); setEngine('spotify'); markPlaybackStarted(); }
      });
      await player.connect();
      spotifyPlayerRef.current = player;
    } catch (e) { console.error('Spotify SDK init failed:', e); }
  };

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
        spotifyPlayerRef.current.connect();
        if (await waitForSpotifyReady()) return spotifyPlayUri(uri, true);
      }
      showToast('Spotify no está listo.', true);
      return;
    }
    try {
      const res = await fetch('/api/spotify/token');
      if (!res.ok) throw new Error('No token');
      const { access_token } = await res.json();
      const resp = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${spotifyDeviceIdRef.current}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: [uri] }),
      });
      if (resp.ok || resp.status === 204) {
        try { spotifyPlayerRef.current.setVolume(mutedRef.current ? 0 : volumeRef.current / 100); } catch {}
        setIsPlaying(true);
        startProgressTimer('spotify');
      }
    } catch (e) { showToast('Error al reproducir en Spotify', true); }
  };

  const checkSpotifyStatus = async ({ attempt = 0 } = {}) => {
    try {
      const res = await fetch('/api/spotify/status');
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      setSpotifyAuth(data);
      if (data.authenticated) {
        fetchSpotifyPlaylists();
        loadSpotifySDK();
      }
    } catch (e) {
      if (attempt < 8) {
        await new Promise((r) => setTimeout(r, Math.min(5000, 300 * 2 ** attempt)));
        return checkSpotifyStatus({ attempt: attempt + 1 });
      }
    }
  };

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
    const s = Math.floor((t.duration_ms || 0) / 1000);
    return {
      id: t.uri || '',
      title: t.name || 'Desconocido',
      artist: artists || 'Artista Desconocido',
      thumbnail: t.album?.images?.[0]?.url || '',
      duration: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`,
      duration_seconds: s,
      uri: t.uri || '',
      source: 'spotify',
    };
  };

  const applyRateLimit = (secs) => {
    clearInterval(spotifyRetryTimer.current);
    if (!secs || secs <= 0) { setSpotifyRetryIn(null); return; }
    if (secs > 600) { setSpotifyRetryIn(null); return; }
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
    try {
      const j = await (await fetch('/api/spotify/ratelimit')).json();
      if (j?.limited && j.retryAfter > 0) { applyRateLimit(j.retryAfter); return; }
    } catch { }
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
          count: (p.items ?? p.tracks)?.total || 0,
          thumbnail: p.images?.[0]?.url || '',
        })));
        if (items.length < 50 || !data.next) break;
        offset += 50;
      }
      setSpotifyPlaylists(all);
    } catch (e) {
      if (/429/.test(e.message)) {
        let secs = 0;
        try { const j = await (await fetch('/api/spotify/ratelimit?measure=1')).json(); secs = Number(j?.retryAfter) || 0; } catch { }
        if (secs > 0) applyRateLimit(secs);
        else setSpotifyPlError('Spotify limitado.');
      }
    } finally {
      setSpotifyPlLoading(false);
    }
  };

  const playSpotifyContext = async (contextUri, displayTitle, _retry = false) => {
    if (!spotifyDeviceIdRef.current || !spotifyReadyRef.current) {
      if (!_retry && spotifyPlayerRef.current) {
        spotifyPlayerRef.current.connect();
        if (await waitForSpotifyReady()) return playSpotifyContext(contextUri, displayTitle, true);
      }
      showToast('Spotify no listo', true);
      return;
    }
    try {
      const res = await fetch('/api/spotify/token');
      const { access_token } = await res.json();
      await fetch(`https://api.spotify.com/v1/me/player/shuffle?state=true&device_id=${spotifyDeviceIdRef.current}`, { method: 'PUT', headers: { Authorization: `Bearer ${access_token}` } });
      const resp = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${spotifyDeviceIdRef.current}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ context_uri: contextUri }),
      });
      if (resp.ok || resp.status === 204) {
        stopYouTubePlayback();
        setAllTracks([]); allRef.current = [];
        setShuffleBag([]); bagRef.current = [];
        setPlayedHistory([]); historyRef.current = [];
        setPlayerMode('spotify');
        playerModeRef.current = 'spotify';
        setPlaylistTitle(displayTitle);
        setIsPlaying(true);
        startProgressTimer('spotify');
      }
    } catch (e) { showToast('Error al reproducir Spotify', true); }
  };

  const loadSpotifyPlaylist = async (id, title, merge = false) => {
    if (!merge) setSelectedPlaylistId(`spotify:${id}`);
    if (!merge) { setPlaylistTitle(`Cargando '${title}'…`); setPlaylistLoading(true); }
    try {
      let token = null;
      const [pl, tok] = await spotifyApiFetch(`/playlists/${id}`, { market: 'from_token' }, null);
      token = tok;
      const playlistName = pl.name || title;
      const contents = pl.items ?? pl.tracks;
      const total = contents?.total || 0;
      const tracks = [];
      const pushItems = (items) => {
        for (const item of items || []) {
          const t = item?.item ?? item?.track;
          if (t && t.type === 'track' && t.uri) tracks.push(fmtSpotifyTrack(t));
        }
      };
      pushItems(contents?.items);
      let offset = contents?.items?.length || 0;
      let hasMore = !!contents?.next;
      while (hasMore && tracks.length < total) {
        const [data, t2] = await spotifyApiFetch(`/playlists/${id}/items`, { limit: 100, offset, market: 'from_token' }, token);
        token = t2;
        const items = data.items || [];
        pushItems(items);
        hasMore = items.length === 100 && !!data.next;
        offset += 100;
      }
      if (merge) addToShuffleBag(tracks, playlistName);
      else { setPlayerMode('spotify'); playerModeRef.current = 'spotify'; initShuffleBag(tracks, playlistName); }
    } catch (e) {
      showToast(e.message, true);
    } finally {
      if (!merge) setPlaylistLoading(false);
    }
  };

  const loadSpotifyLiked = async (merge = false) => {
    if (!merge) setSelectedPlaylistId('spotify:liked');
    if (!merge) { setPlaylistTitle('Cargando favoritos…'); setPlaylistLoading(true); }
    try {
      let token = null;
      const tracks = [];
      let offset = 0;
      while (true) {
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
      if (merge) addToShuffleBag(tracks, 'Favoritos Spotify');
      else { setPlayerMode('spotify'); playerModeRef.current = 'spotify'; initShuffleBag(tracks, 'Canciones que te gustan'); }
    } catch (e) { showToast(e.message, true); }
    finally { if (!merge) setPlaylistLoading(false); }
  };

  const logoutSpotify = async () => {
    if (!confirm('¿Desconectar Spotify?')) return;
    try { spotifyPlayerRef.current?.disconnect(); } catch {}
    spotifyPlayerRef.current = null;
    await fetch('/api/spotify/logout', { method: 'POST' });
    setSpotifyAuth({ authenticated: false, token_exists: false });
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
      // Reanudar donde lo dejaste: casa la posición guardada con la pista restaurada.
      try {
        const r = JSON.parse(localStorage.getItem('rsp_resume') || 'null');
        if (r && current && r.id === current.id && r.t > 5) pendingResumeRef.current = r;
      } catch {}
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
    } catch { localStorage.removeItem(SESSION_KEY); }
  };

  useEffect(() => {
    restoreSession();
    apiMe().then((u) => setAppUser(u || null));
    loadYouTubeAPI();
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (code && state) {
      window.history.replaceState({}, '', window.location.pathname);
      const pending = sessionStorage.getItem('spotify_pending');
      if (pending) {
        sessionStorage.removeItem('spotify_pending');
        const { client_id, client_secret, redirect_uri } = JSON.parse(pending);
        fetch('/api/spotify/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, state, client_id, client_secret, redirect_uri }) })
          .then(r => r.ok && checkSpotifyStatus());
      }
    }
  }, []);

  useEffect(() => {
    if (!appUser) return;
    checkAuthStatus();
    checkSpotifyStatus();
    // Revalida la cookie de YouTube Music cada 5 min (silencioso) y al volver el foco
    // a la pestaña (throttle de 60 s), p.ej. tras suspender el equipo horas.
    const iv = setInterval(() => checkAuthStatus({ silent: true }), 5 * 60 * 1000);
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
        case 'Space': e.preventDefault(); h.togglePlayPause(); break;
        case 'ArrowRight': if (!e.shiftKey) { e.preventDefault(); h.doNextTrack(); } break;
        case 'ArrowLeft': if (!e.shiftKey) { e.preventDefault(); h.doPrevTrack(); } break;
        case 'KeyM': h.toggleMute(); break;
        case 'KeyR': h.toggleRepeat(); break;
        case 'Slash': if (e.shiftKey) { e.preventDefault(); h.toggleShortcuts(); } break;
        case 'ArrowUp': e.preventDefault(); h.applyVolume(Math.min(100, volumeRef.current + 5)); break;
        case 'ArrowDown': e.preventDefault(); h.applyVolume(Math.max(0, volumeRef.current - 5)); break;
        default: break;
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); localStorage.setItem('rsp_theme', theme); }, [theme]);

  // Smart-play persistencia: reproducir Spotify vía YouTube (sin Premium).
  useEffect(() => {
    spotifyViaYoutubeRef.current = spotifyViaYoutube;
    try { localStorage.setItem('rsp_sp_via_yt', spotifyViaYoutube ? '1' : '0'); } catch {}
  }, [spotifyViaYoutube]);

  // Acento dinámico — tiñe la UI (--accent) con el color dominante de la carátula.
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
        const H = Math.round(hue);
        const S = Math.round(Math.max(55, Math.min(85, sat)));
        const L = Math.round(Math.max(45, Math.min(60, lum)));
        root.style.setProperty('--accent', `hsl(${H}, ${S}%, ${L}%)`);
        root.style.setProperty('--accent-glow', `hsla(${H}, ${S}%, ${L}%, 0.5)`);
      } catch {
        /* carátula sin CORS → canvas "tainted"; se mantiene el acento del tema */
      }
    };
    img.onerror = () => {};
    img.src = url;
    return () => { cancelled = true; };
  }, [currentTrack?.thumbnail]);

  // Persistencia de sesión (la cola sobrevive a recargas).
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

  // Guarda la posición de reproducción para "reanudar donde lo dejaste".
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

  // Media Session API — registra los handlers una vez (lockscreen / auriculares).
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play', () => { if (!isPlayingRef.current) keyHandlerRef.current.togglePlayPause(); });
    navigator.mediaSession.setActionHandler('pause', () => { if (isPlayingRef.current) keyHandlerRef.current.togglePlayPause(); });
    navigator.mediaSession.setActionHandler('previoustrack', () => keyHandlerRef.current.doPrevTrack());
    navigator.mediaSession.setActionHandler('nexttrack', () => keyHandlerRef.current.doNextTrack());
    const setSeek = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* no soportado */ } };
    setSeek('seekto', (d) => { if (d && d.seekTime != null) seekToSeconds(d.seekTime); });
    setSeek('seekforward', (d) => seekToSeconds(getCurrentPlaybackTime() + ((d && d.seekOffset) || 10)));
    setSeek('seekbackward', (d) => seekToSeconds(getCurrentPlaybackTime() - ((d && d.seekOffset) || 10)));
    setSeek('stop', () => { if (isPlayingRef.current) keyHandlerRef.current.togglePlayPause(); });
    // Desbloquea el ancla de MediaSession en el primer gesto (política de autoplay).
    const unlockAnchor = () => {
      ensureMediaAnchor().play()
        .then(() => { if (!isPlayingRef.current) { try { mediaAnchorRef.current.pause(); } catch { /* ignore */ } } })
        .catch(() => { /* se reintenta en el siguiente gesto */ });
    };
    window.addEventListener('pointerdown', unlockAnchor, { once: true });
    return () => window.removeEventListener('pointerdown', unlockAnchor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Media Session API — metadata en cada cambio de pista (título/artista/carátula lockscreen).
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (currentTrack) {
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
    updateMediaPositionState(getCurrentPlaybackTime(), getEngineDuration());
  }, [currentTrack, isPlaying, playlistTitle]);

  // Sincroniza el ancla de MediaSession con la reproducción. Solo necesaria con el
  // IFrame de YouTube (cross-origin roba la sesión); con audio directo/Spotify la
  // sesión ya es de nuestra página.
  useEffect(() => {
    const needsAnchor = isPlaying && engine === 'youtube';
    if (needsAnchor) {
      ensureMediaAnchor().play().catch(() => { /* aún sin desbloquear; se retomará */ });
    } else if (mediaAnchorRef.current) {
      try { mediaAnchorRef.current.pause(); } catch { /* ignore */ }
    }
  }, [isPlaying, engine]);

  const toggleFavoriteWithToast = () => {
    const t = currentRef.current;
    if (!t) return;
    setFavorites((prev) => {
      const next = { ...prev };
      let nowFav;
      if (next[t.id]) { delete next[t.id]; nowFav = false; }
      else { next[t.id] = t; nowFav = true; }
      setIsFavorite(nowFav);
      favoritesRef.current = next;
      showToast(nowFav ? 'Añadido a favoritas' : 'Quitado de favoritas');
      // Si es una pista de Spotify, refleja el ♥ también en tu biblioteca de Spotify.
      if (t.source === 'spotify' && typeof t.uri === 'string' && t.uri.startsWith('spotify:track:')) {
        syncSpotifyLiked(t.uri.split(':').pop(), nowFav);
      }
      return next;
    });
  };

  const addToNextWithToast = (track, e) => {
    e.stopPropagation();
    setPriorityQueue(pq => {
      const next = [...pq, track];
      priorityQueueRef.current = next;
      return next;
    });
    showToast('Añadido a "Siguiente"');
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

    // Crossfade: restaurar volumen tras arrancar la pista.
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

    const src = track.source || playerModeRef.current;

    if (src === 'spotify') {
      stopYouTubePlayback();
      setPlayerMode('spotify');
      playerModeRef.current = 'spotify';
      spotifyPlayUri(track.uri || track.id);
    } else {
      if (spotifyPlayerRef.current) {
        try { spotifyPlayerRef.current.pause(); } catch {}
      }
      setPlayerMode('youtube');
      playerModeRef.current = 'youtube';
      // Motor directo PRIMARIO (máxima calidad + EQ/efectos/visualizador), salvo que el
      // usuario esté viendo el vídeo (eso requiere el IFrame de YouTube).
      const wantDirect = (preferDirectRef.current || hifiModeRef.current) && !isVideoVisibleRef.current;
      if (wantDirect) {
        loadDirectAudio(track.id, resumeAt, { onFail: ytPlayerRef.current && ytReadyRef.current ? 'iframe' : 'skip' });
      } else if (ytPlayerRef.current && ytReadyRef.current) {
        ytPlayerRef.current.setVolume(volumeRef.current);
        if (mutedRef.current) ytPlayerRef.current.mute();
        else ytPlayerRef.current.unMute();
        ytPlayerRef.current.loadVideoById(resumeAt > 1 ? { videoId: track.id, startSeconds: resumeAt } : track.id);
        setIsPlaying(true);
        armYtWatchdog(track.id);
      } else {
        loadDirectAudio(track.id, resumeAt, { onFail: 'skip' });
      }
    }

    // Adelanta la resolución de la URL de audio de la siguiente pista.
    prefetchNext();
  };

  // Radio: cuántas pistas quedan en la bolsa para disparar la recarga anticipada.
  const RADIO_LOW_WATER = 5;
  // Descubrir similares: cuánta bolsa "propia" queda antes de sembrar nuevos afines.
  const DISCOVER_LOW_WATER = 6;

  // Inserta pistas externas (radio o descubrimiento) (dedup) intercalándolas en posiciones
  // aleatorias de lo que queda por sonar. `kind` marca el origen ('radio' | 'discover').
  const appendExternalTracks = (incoming, kind = 'radio') => {
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
      .map((t) => ({ ...t, source: t.source || 'youtube', [kind]: true }));
    if (!fresh.length) return 0;

    const merged = [...allRef.current, ...fresh];
    setAllTracks(merged); allRef.current = merged;

    const bag = [...bagRef.current];
    for (const t of fisherYates(fresh)) {
      const pos = Math.floor(Math.random() * (bag.length + 1));
      bag.splice(pos, 0, t);
    }
    setShuffleBag(bag); bagRef.current = bag;
    return fresh.length;
  };
  const appendRadioTracks = (incoming) => appendExternalTracks(incoming, 'radio');

  // Pide la cola automix de la semilla y extiende la bolsa (radio infinita).
  const maybeRefillRadio = useCallback(async (seedTrack) => {
    if (!radioModeRef.current || radioFetchingRef.current) return;
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

  // Semillas para pedir similares: la actual + unas recientes (variedad sin dispersar).
  const buildDiscoverSeeds = (seedTrack) => {
    const seeds = [];
    const seen = new Set();
    const add = (t) => {
      if (!t || !t.title) return;
      const k = t.uri || t.id || t.title;
      if (seen.has(k)) return;
      seen.add(k);
      seeds.push({ id: t.id, title: t.title, artist: t.artist, source: t.source, uri: t.uri });
    };
    add(seedTrack || currentRef.current);
    for (const t of [...historyRef.current].reverse().slice(0, 3)) add(t);
    return seeds.slice(0, 5);
  };
  // Pide a /api/similar temas afines (automix + IA) del proveedor activo y los intercala.
  const maybeDiscover = useCallback(async (seedTrack, manual = false) => {
    if ((!discoverModeRef.current && !manual) || discoverFetchingRef.current) return;
    const seeds = buildDiscoverSeeds(seedTrack);
    if (!seeds.length) { if (manual) showToast('Reproduce algo primero para descubrir afines.', true); return; }
    const provider = playerModeRef.current === 'spotify' ? 'spotify' : 'youtube';
    discoverFetchingRef.current = true;
    setDiscoverLoading(true);
    try {
      const exclude = allRef.current.map((t) => t.uri || t.id);
      const res = await fetch('/api/similar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seeds, provider, limit: 20, exclude }),
      });
      if (!res.ok) { if (manual) showToast('No se pudieron descubrir similares.', true); return; }
      const data = await res.json();
      const added = appendExternalTracks(data.tracks || [], 'discover');
      if (added) {
        setBagFlash(true); setTimeout(() => setBagFlash(false), 900);
        showToast(`✨ Descubrir: +${added} temas afines`);
      } else if (manual) {
        showToast('No hay nuevos afines por ahora.', true);
      }
    } catch {
      if (manual) showToast('Error al descubrir similares.', true);
    } finally {
      discoverFetchingRef.current = false;
      setDiscoverLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Colas por ánimo con IA: pide una cola para el ánimo (sesgada por una muestra de la
  // bolsa) y la carga como playlist nueva. Requiere GEMINI_API_KEY en el backend.
  const loadMoodQueue = useCallback(async (mood) => {
    setMoodLoading(mood);
    showToast(`🎯 Generando cola "${mood}"…`);
    try {
      const provider = playerModeRef.current === 'spotify' ? 'spotify' : 'youtube';
      const sample = fisherYates(allRef.current).slice(0, 12).map((t) => ({ title: t.title, artist: t.artist }));
      const res = await fetch('/api/mood-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mood, seeds: sample, provider, limit: 25 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(data.detail || 'No se pudo generar la cola.', true); return; }
      const tracks = data.tracks || [];
      if (!tracks.length) { showToast('La IA no devolvió canciones para ese ánimo.', true); return; }
      setSelectedPlaylistId(null);
      initShuffleBag(tracks, `🎯 ${mood}`);
      setMoodOpen(false);
      showToast(`🎯 Cola "${mood}": ${tracks.length} canciones`);
    } catch {
      showToast('Error al generar la cola.', true);
    } finally {
      setMoodLoading(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Reorden continuo: selección de la próxima "sorpresa" ──
  // IDs a evitar: las últimas N sonadas + la actual (ventana anti-repetición).
  const reordenAvoidIds = () => {
    const n = reordenAvoidRef.current;
    const ids = n > 0 ? historyRef.current.slice(-n).map((t) => t.id) : [];
    if (currentRef.current) ids.push(currentRef.current.id);
    return ids;
  };
  // Baraja el pool completo y toma la primera pista que NO esté en `avoidIds`.
  const pickReordenNext = (avoidIds) => {
    const all = allRef.current;
    if (!all.length) return { next: null, bag: [] };
    const dead = deadTracksRef.current;
    const playableExists = all.some((t) => !dead.has(t.id));
    const pool = fisherYates(all).filter((t) => !playableExists || !dead.has(t.id));
    if (!pool.length) return { next: null, bag: [] };
    const avoid = new Set(avoidIds);
    let idx = pool.findIndex((t) => !avoid.has(t.id));
    if (idx < 0) {
      const curId = currentRef.current?.id;
      idx = pool.findIndex((t) => t.id !== curId);
      if (idx < 0) idx = 0;
    }
    const next = pool[idx];
    const bag = pool.filter((_, i) => i !== idx);
    return { next, bag };
  };
  // "Otra sorpresa": re-baraja la próxima revelada SIN cortar la actual (solo con espiar).
  const rerollPeek = () => {
    if (!autoReshuffleRef.current || !currentRef.current) return;
    const avoid = reordenAvoidIds();
    if (reordenPeekRef.current?.next) avoid.push(reordenPeekRef.current.next.id);
    const r = pickReordenNext(avoid);
    reordenPeekRef.current = r;
    setReordenPeekView(r.next);
    setReshuffling(true); setTimeout(() => setReshuffling(false), 650);
  };

  const doNextTrack = useCallback(() => {
    // Spotify en "reproducción directa" (contexto nativo, sin bolsa): delega en su SDK.
    if (playerModeRef.current === 'spotify' && allRef.current.length === 0 && spotifyReadyRef.current && spotifyPlayerRef.current) {
      spotifyPlayerRef.current.nextTrack();
      return;
    }
    // La cola prioritaria manda.
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

    const dead = deadTracksRef.current;
    const playableExists = all.some((t) => !dead.has(t.id));
    let next = null;
    let refilled = false;

    if (autoReshuffleRef.current) {
      // Reorden continuo: baraja el pool COMPLETO cada vez (las ya sonadas vuelven a entrar,
      // respetando la ventana anti-repetición). Si "espiar" comprometió la próxima, suena ESA.
      const committed = reordenPeekRef.current;
      reordenPeekRef.current = null;
      if (
        committed?.next &&
        all.some((t) => t.id === committed.next.id) &&
        (!playableExists || !dead.has(committed.next.id)) &&
        committed.next.id !== currentRef.current?.id
      ) {
        next = committed.next;
        bag = fisherYates(all).filter((t) => (!playableExists || !dead.has(t.id)) && t.id !== next.id);
      } else {
        const r = pickReordenNext(reordenAvoidIds());
        next = r.next; bag = r.bag;
      }
    } else {
      for (let i = 0; i <= all.length; i++) {
        if (bag.length === 0) { bag = fisherYates(all); refilled = true; }
        const cand = bag.pop();
        if (!cand) break;
        if (!playableExists || !dead.has(cand.id)) { next = cand; break; }
      }
    }
    if (!next) return;
    if (refilled && playableExists) showToast('¡Bolsa rebarajada!');
    // Radio infinita: si quedan pocas por sonar, precarga afines del tema que va a sonar.
    if (radioModeRef.current && bag.length <= RADIO_LOW_WATER) maybeRefillRadio(next);
    // Descubrir similares: siembra afines nuevos cuando la bolsa baja o, en modo Reorden
    // (donde la bolsa nunca baja), cada ~8 canciones. Tope de pool ~600.
    if (discoverModeRef.current && allRef.current.length < 600) {
      const periodic = autoReshuffleRef.current && (++discoverTickRef.current >= 8);
      if (bag.length <= DISCOVER_LOW_WATER || periodic) {
        if (periodic) discoverTickRef.current = 0;
        maybeDiscover(next);
      }
    }
    const cur = currentRef.current;
    const newHistory = cur ? [...historyRef.current, cur] : [...historyRef.current];
    if (crossfadeRef.current && isPlayingRef.current) {
      fadeOutCurrent(1200).then(() => doPlayTrack(next, bag, newHistory));
      return;
    }
    doPlayTrack(next, bag, newHistory);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Espiar la siguiente: al cambiar la pista (o activar espiar / cambiar la ventana),
  // compromete y revela la próxima sorpresa del reorden, de modo que el panel muestre
  // EXACTAMENTE lo que sonará. Si espiar/reorden se apagan, la limpia.
  useEffect(() => {
    if (!peekEnabled || !autoReshuffle || !currentTrack) {
      reordenPeekRef.current = null;
      setReordenPeekView(null);
      return;
    }
    const r = pickReordenNext(reordenAvoidIds());
    reordenPeekRef.current = r;
    setReordenPeekView(r.next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, peekEnabled, autoReshuffle, reordenAvoid]);

  const doPrevTrack = () => {
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
    // Tras restaurar sesión, la pista está seleccionada pero aún no cargada → el primer
    // "play" la arranca y reanuda donde la dejaste.
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
      else { resumeAudioCtx(); audio.play(); setIsPlaying(true); startProgressTimer('audio'); }
      return;
    }
    if (ytPlayerRef.current && ytReadyRef.current) {
      if (isPlayingRef.current) ytPlayerRef.current.pauseVideo();
      else ytPlayerRef.current.playVideo();
    }
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
      if (newMuted) ytPlayerRef.current.mute(); else ytPlayerRef.current.unMute();
    }
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
  const fmt = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
  };

  const trackKey = (t) => String(t?.id || t?.uri || t?.videoId || '');
  const currentKey = trackKey(currentTrack);
  const progress = duration > 0 ? Math.max(0, Math.min(100, (currentTime / duration) * 100)) : 0;
  const bagProgress = allTracks.length > 0 ? Math.round(((allTracks.length - shuffleBag.length) / allTracks.length) * 100) : 0;
  const bagRemainingSec = shuffleBag.reduce((acc, t) => acc + (t.duration_seconds || durToSecs(t.duration)), 0);
  // Biblioteca YT unificada: playlists de YT Music + playlists de YouTube (regulares).
  const combinedYtPlaylists = useMemo(() => [
    ...playlists.map(p => ({ ...p, _kind: 'ytmusic', _selId: p.id })),
    ...youtubePlaylists.map(p => ({ ...p, _kind: 'youtube', _selId: `youtube:${p.id}` })),
  ], [playlists, youtubePlaylists]);
  const catId = { yt: (pl) => pl._selId, sp: (pl) => `spotify:${pl.id}` };
  const historyList = useMemo(() => [...playedHistory].reverse(), [playedHistory]);
  const nextList = useMemo(() => [
    ...priorityQueue.map((t, pqIndex) => ({ t, pq: true, pqIndex })),
    ...shuffleBag.map((t) => ({ t, pq: false })),
  ], [priorityQueue, shuffleBag]);
  const upcoming = useMemo(() => nextList.map((it) => it.t).filter(Boolean), [nextList]);
  const reordenCovers = useMemo(() => upcoming.slice(0, 5).map((t) => t.thumbnail).filter(Boolean), [upcoming]);
  const engineLabel = engine === 'audio' ? 'Directo' : engine === 'spotify' ? 'Spotify' : 'YouTube';
  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 35 ? Volume : volume < 70 ? Volume1 : Volume2;
  const currentArt = hiResArt(currentTrack?.thumbnail, 640) || '/icon.svg';

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

  // La reproducción arrancó de verdad: reinicia contador de fallos y vigías.
  const markPlaybackStarted = () => {
    consecutiveFailuresRef.current = 0;
    breakerTrippedRef.current = false;
    ytConfirmedRef.current = true;
    clearYtWatchdog();
    setIsBuffering(false);
    if (playbackRateRef.current !== 1) applyRate(playbackRateRef.current);
  };

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

  // Debounced next para evitar saltos en ráfaga.
  const safNextTrack = () => {
    if (skipDebounceRef.current) return;
    skipDebounceRef.current = true;
    setTimeout(() => { skipDebounceRef.current = false; }, 2000);
    doNextTrack();
  };

  // --- Motor de audio directo (AAC 128k solo-audio → AAC progresivo → IFrame) ---
  //   'hq'  = AAC 128 kbps solo audio (itag 140, vía IOS) — máxima calidad robusta.
  //   'aac' = AAC progresivo itag 18 (~96 kbps, respaldo con URL directa siempre).
  const directSrc = (videoId, codec, bust) => {
    const q = [];
    if (codec === 'hq') q.push('fmt=hq');
    if (bust) q.push('r=' + Date.now());
    return `/api/stream-audio/${videoId}${q.length ? '?' + q.join('&') : ''}`;
  };

  // Reproduce el audio del backend por proxy same-origin a través del grafo Web Audio
  // (EQ, nivelado, efectos DJ, visualizador). opts.codec: 'hq' o 'aac'. opts.onFail:
  // 'iframe' (motor primario: degrada al IFrame) o 'skip' (respaldo: salta de pista).
  const loadDirectAudio = async (videoId, startAt = 0, opts = {}) => {
    if (!videoId) return;
    const codec = opts.codec || 'hq';
    const onFail = opts.onFail || 'skip';
    clearYtWatchdog();
    clearStallWatch();
    usingFallbackRef.current = true;
    stallCountRef.current = 0;
    stopProgressTimer();
    directCodecRef.current = codec;
    directOnFailRef.current = onFail;

    // Grafo Web Audio SIEMPRE: deja listos EQ, nivelado, efectos DJ y visualizador.
    ensureEqGraph();
    resumeAudioCtx();
    if (eqEnabledRef.current) applyEqGains(eqBands);
    else applyEqGains(EQ_FREQS.map(() => 0));
    if (normalizeEnabledRef.current) applyNormalization(videoId);
    else if (normGainRef.current) { try { normGainRef.current.gain.value = 1; } catch {} }

    if (ytPlayerRef.current && ytReadyRef.current) {
      try { ytPlayerRef.current.stopVideo(); } catch {}
    }

    const audio = audioRef.current;
    if (!audio) return;
    directSettlingRef.current = true;
    // Descarga offline: si la pista está guardada, suena desde el blob local (sin red,
    // instantáneo, y sigue pasando por el grafo Web Audio → EQ/efectos).
    if (lastBlobUrlRef.current) { try { URL.revokeObjectURL(lastBlobUrlRef.current); } catch { /* ignore */ } lastBlobUrlRef.current = null; }
    const offBlob = await getOfflineBlob(videoId);
    if (offBlob) {
      const bu = URL.createObjectURL(offBlob);
      lastBlobUrlRef.current = bu;
      audio.src = bu;
    } else {
      audio.src = directSrc(videoId, codec, false);
    }
    audio.volume = volumeRef.current / 100;
    audio.muted = mutedRef.current;
    if (startAt > 1) {
      const seekOnce = () => {
        audio.removeEventListener('loadedmetadata', seekOnce);
        try { if (isFinite(audio.duration)) audio.currentTime = startAt; } catch {}
      };
      audio.addEventListener('loadedmetadata', seekOnce);
    }

    try {
      await audio.play();
      directSettlingRef.current = false;
      setIsPlaying(true);
      startProgressTimer('audio');
      setEngine('audio');
      markPlaybackStarted();
    } catch (err) {
      directSettlingRef.current = false;
      console.error('Audio directo play() falló:', err);
      if (err?.name === 'NotAllowedError') {
        usingFallbackRef.current = false;
        setIsPlaying(false);
        showToast('Pulsa play para iniciar la reproducción (el navegador bloqueó el autoplay).', true);
        return;
      }
      stepDownDirect(videoId, startAt);
    }
  };

  const loadFallbackAudio = (videoId, startAt = 0) => loadDirectAudio(videoId, startAt, { onFail: 'skip' });

  // Escalona el motor directo cuando el intento inicial falla: HQ → AAC → (IFrame|saltar).
  const stepDownDirect = (videoId, startAt = 0) => {
    if (directCodecRef.current === 'hq') {
      console.warn('Audio directo HQ (128k) falló; probando AAC progresivo.');
      loadDirectAudio(videoId, startAt, { codec: 'aac', onFail: directOnFailRef.current });
      return;
    }
    usingFallbackRef.current = false;
    if (directOnFailRef.current === 'iframe' && ytPlayerRef.current && ytReadyRef.current && currentRef.current?.id === videoId) {
      showToast('Audio directo no disponible. Usando el reproductor de YouTube…');
      try {
        ytPlayerRef.current.setVolume(volumeRef.current);
        if (mutedRef.current) ytPlayerRef.current.mute(); else ytPlayerRef.current.unMute();
        ytPlayerRef.current.loadVideoById(startAt > 1 ? { videoId, startSeconds: startAt } : videoId);
        setIsPlaying(true);
        armYtWatchdog(videoId);
      } catch {
        failCurrentAndAdvance('No se pudo reproducir la pista. Probando la siguiente…');
      }
    } else {
      failCurrentAndAdvance('No se pudo cargar el audio directo. Probando la siguiente…');
    }
  };

  // --- Recuperación de stalls del audio de respaldo ---
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
    audio.src = directSrc(id, directCodecRef.current, true); // fuerza re-descarga (re-resuelve si caducó)
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

  const handleAudioEnded = () => {
    const a = audioRef.current;
    if (usingFallbackRef.current && a && isFinite(a.duration) && a.duration - (a.currentTime || 0) > 3) {
      recoverFallbackStall();
      return;
    }
    onTrackEnded();
  };

  // --- Prefetch de la siguiente pista (calienta la caché de URL de audio del backend) ---
  const prefetchNext = () => {
    try {
      const fmtQ = (preferDirectRef.current || hifiModeRef.current) ? '?fmt=hq' : '';
      const pq = priorityQueueRef.current;
      const bag = bagRef.current;
      const next = pq.length ? pq[0] : (bag.length ? bag[bag.length - 1] : null);
      if (!next) return;
      if (spotifyViaYoutubeRef.current && next.source === 'spotify') {
        resolveSpotifyToYt(next).then((yt) => { if (yt?.id) fetch(`/api/prefetch-audio/${yt.id}${fmtQ}`).catch(() => {}); });
        return;
      }
      if (next.source === 'spotify' || next.uri || !next.id) return;
      if (lastPrefetchedRef.current === next.id) return;
      lastPrefetchedRef.current = next.id;
      fetch(`/api/prefetch-audio/${next.id}${fmtQ}`).catch(() => {});
    } catch {}
  };

  // Crossfade — baja el volumen de la pista actual antes del cambio.
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

  // Smart-play: resuelve una pista de Spotify a su equivalente de YouTube (cacheado).
  const resolveSpotifyToYt = async (track) => {
    const key = track.uri || track.id || `${track.artist} ${track.title}`;
    // Offline: si está descargada, usa su videoId guardado sin tocar la red.
    const offId = offlineMapRef.current.get(track.uri) || offlineMapRef.current.get(track.id);
    if (offId) return { ...track, id: offId, source: 'youtube', _ytResolved: true };
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

  // Velocidad de reproducción (no soportado por el SDK de Spotify).
  const applyRate = (r) => {
    if (playerModeRef.current === 'spotify') return;
    if (usingFallbackRef.current && audioRef.current) { try { audioRef.current.playbackRate = r; } catch {} }
    else if (ytPlayerRef.current && ytReadyRef.current) { try { ytPlayerRef.current.setPlaybackRate(r); } catch {} }
  };

  // Estadísticas de reproducción (para StatsModal).
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

  // ───────────── Descargas offline ─────────────
  const refreshOffline = useCallback(async () => {
    const list = await listOffline();
    const keys = new Set(); const map = new Map();
    for (const r of list) { keys.add(r.id); keys.add(r.key); map.set(r.key, r.id); map.set(r.id, r.id); }
    offlineMapRef.current = map;
    setOfflineList(list); setOfflineKeys(keys);
    setOfflineStorageInfo(await storageInfo());
  }, []);
  useEffect(() => { refreshOffline(); requestPersist(); }, [refreshOffline]);

  const markDownloading = (key, on) => {
    if (on) downloadingRef.current.add(key); else downloadingRef.current.delete(key);
    setDownloadingKeys(new Set(downloadingRef.current));
  };

  // Resuelve una pista a su videoId de YouTube para descargar. `exclude` pide un candidato
  // alternativo cuando el primero no transmite (aprovecha el fix del matcher).
  const matchToYt = async (track, exclude) => {
    if (track.source !== 'spotify' && track.id && !track.uri) return track;
    const p = new URLSearchParams({ title: track.title || '', artist: track.artist || '' });
    if (track.uri) p.set('uri', track.uri);
    if (track.duration_seconds) p.set('duration', String(Math.round(track.duration_seconds * 1000)));
    if (exclude) p.set('exclude', exclude);
    const r = await fetch(`/api/library/match?${p.toString()}`);
    if (!r.ok) return null;
    const d = await r.json();
    return d.track?.id ? { ...d.track, source: 'youtube' } : null;
  };

  // Descarga el archivo de audio COMPLETO por chunks (rangos). Importante: se usa el stream
  // AAC progresivo (SIN fmt=hq) porque el HQ itag 140 está throttled a ~1 MB sin PoToken;
  // el progresivo itag 18 sí se deja bajar entero. Rangos pequeños, que googlevideo no bloquea.
  const downloadAudioBlob = async (videoId) => {
    const url = `/api/stream-audio/${videoId}`;
    let total = 0; let ctype = 'audio/mp4';
    try {
      const head = await fetch(url, { headers: { Range: 'bytes=0-1' } });
      if (head.status !== 206) return null;
      const cr = head.headers.get('content-range');
      total = cr ? Number(cr.split('/')[1]) : 0;
      ctype = head.headers.get('content-type') || ctype;
      await head.arrayBuffer();
    } catch { return null; }
    if (!total || total < 10000) return null;
    const CH = 1024 * 1024;
    const parts = [];
    for (let s = 0; s < total; s += CH) {
      const e = Math.min(s + CH - 1, total - 1);
      let r = await fetch(url, { headers: { Range: `bytes=${s}-${e}` } });
      if (r.status !== 206) { await new Promise((t) => setTimeout(t, 400)); r = await fetch(url, { headers: { Range: `bytes=${s}-${e}` } }); }
      if (r.status !== 206) return null; // trozo bloqueado (p.ej. video sin progresivo) → incompleto
      parts.push(await r.blob());
      await new Promise((t) => setTimeout(t, 120)); // ritmo suave
    }
    const type = /mp4|audio/.test(ctype) ? ctype : 'audio/mp4';
    const blob = new Blob(parts, { type });
    return blob.size >= total ? blob : null;
  };

  const downloadTrack = async (track) => {
    if (!track) return false;
    const key = trackKey(track);
    if (!key || offlineKeys.has(key) || downloadingRef.current.has(key)) return offlineKeys.has(key);
    markDownloading(key, true);
    try {
      let yt = (track.source !== 'spotify' && track.id && !track.uri) ? track : await matchToYt(track);
      if (!yt?.id) throw new Error('sin equivalente en YouTube');
      let blob = null;
      for (let i = 0; i < 3 && !blob; i++) {
        blob = await downloadAudioBlob(yt.id);
        if (blob) break;
        const alt = await matchToYt(track, yt.id); // no descargable → candidato alternativo
        if (alt?.id && alt.id !== yt.id) { yt = alt; continue; }
        break;
      }
      if (!blob) throw new Error('no se pudo descargar el audio completo');
      await saveOffline({
        id: yt.id, key, title: track.title, artist: track.artist, thumbnail: track.thumbnail,
        duration: track.duration, duration_seconds: track.duration_seconds || durToSecs(track.duration), source: track.source,
      }, blob);
      offlineMapRef.current.set(key, yt.id); offlineMapRef.current.set(yt.id, yt.id);
      setOfflineKeys((prev) => new Set(prev).add(key).add(yt.id));
      // Registra la descarga en el manifiesto del backend (lo comparte con la app Android).
      fetch('/api/offline', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: yt.id, key, title: track.title, artist: track.artist, thumbnail: track.thumbnail, durationMs: Math.round((track.duration_seconds || durToSecs(track.duration)) * 1000), source: track.source }),
      }).catch(() => {});
      return true;
    } catch (e) {
      showToast(`No se pudo descargar "${track.title}": ${e.message}`, true);
      return false;
    } finally {
      markDownloading(key, false);
    }
  };

  const downloadCurrent = async () => {
    const t = currentRef.current;
    if (!t) return;
    if (offlineKeys.has(trackKey(t))) { showToast('Ya está descargada.'); return; }
    showToast(`⬇️ Descargando "${t.title}"…`);
    if (await downloadTrack(t)) { showToast(`✓ Descargada: ${t.title}`); refreshOffline(); }
  };

  const downloadBag = async () => {
    const list = allRef.current.filter((t) => !offlineKeys.has(trackKey(t)));
    if (!list.length) { showToast('Todo lo cargado ya está descargado.'); return; }
    showToast(`⬇️ Descargando ${list.length} temas… (puede tardar)`);
    let ok = 0, fail = 0;
    for (const t of list) { if (await downloadTrack(t)) ok++; else fail++; }
    showToast(`Descarga: ${ok} ✓${fail ? `, ${fail} fallaron` : ''}`);
    refreshOffline();
  };

  const deleteAllOffline = async () => {
    if (!confirm('¿Borrar todas las descargas offline?')) return;
    await clearOffline();
    fetch('/api/offline', { method: 'DELETE' }).catch(() => {}); // limpia también el manifiesto compartido
    offlineMapRef.current = new Map();
    setOfflineKeys(new Set());
    await refreshOffline();
    showToast('Descargas borradas');
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

  // Una pista no se pudo reproducir → avanza. Si fallan demasiadas seguidas (fallo
  // sistémico: red caída, sesión caducada, backend abajo) corta el bucle y avisa con
  // un mensaje accionable en vez de saltar en silencio para siempre.
  const failCurrentAndAdvance = (reason) => {
    clearYtWatchdog();
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

  const loadYouTubeAPI = () => {
    if (window.YT && window.YT.Player) {
      createYTPlayer();
      return;
    }
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') prev();
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
      // Fin PREMATURO del IFrame: a veces YouTube emite ENDED a mitad (hipo de stream /
      // restricción) lejos del final real → en vez de saltar, pasa al audio directo desde
      // la misma posición.
      let cur = 0, dur = 0;
      try { cur = ytPlayerRef.current?.getCurrentTime?.() || 0; dur = ytPlayerRef.current?.getDuration?.() || 0; } catch {}
      if (dur > 0 && dur - cur > 5 && currentRef.current?.id) {
        showToast('Reproducción interrumpida. Pasando a audio directo…');
        loadFallbackAudio(currentRef.current.id, cur);
        return;
      }
      onTrackEnded();
    } else if (e.data === YT.PlayerState.BUFFERING) {
      setIsBuffering(true);
    }
  };

  const onYTError = (e) => {
    console.warn('YT IFrame error code:', e.data);
    // 101/150 = incrustación deshabilitada, 100 = no disponible/privado, 5 = error HTML5,
    // 2 = parámetro inválido. En todos (salvo sin id) intentamos el audio directo del
    // backend (cliente IOS anónimo) antes de descartar la pista.
    const videoId = currentRef.current?.id;
    if (!videoId) { failCurrentAndAdvance('No se pudo reproducir la pista. Pasando a la siguiente…'); return; }
    if (e.data === 101 || e.data === 150) {
      showToast('No disponible en YouTube Music. Reproduciendo audio directo…');
    } else {
      showToast('Restricción de reproducción. Intentando audio directo…');
    }
    loadFallbackAudio(videoId);
  };

  const fetchPlaylists = async () => {
    try {
      const res = await fetch('/api/playlists');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'No se pudieron cargar las playlists');
      setPlaylists(data.playlists || []);
    } catch (e) {
      showToast(e.message || 'Error cargando playlists', true);
    }
  };

  const checkAuthStatus = async ({ silent = false } = {}) => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'No se pudo comprobar YouTube Music');
      setAuthStatus(data);
      if (data.authenticated) { fetchPlaylists(); fetchYouTubePlaylists(); }
    } catch (e) {
      if (!silent) showToast(e.message || 'Servidor no disponible', true);
    }
  };

  const logout = async () => {
    await fetch('/api/logout', { method: 'POST' }).catch(() => null);
    setAuthStatus({ authenticated: false, oauth_exists: false });
    setPlaylists([]);
    setYoutubePlaylists([]);
    setYtPlaylistsLoaded(false);
    showToast('YouTube Music desconectado');
  };

  const loadLikedSongs = async (merge = false) => {
    if (!authStatus.authenticated) {
      setShowAuthModal(true);
      return;
    }
    if (!merge) {
      setSelectedPlaylistId('liked');
      setPlaylistTitle('Cargando favoritos...');
      setPlaylistLoading(true);
    }
    try {
      const res = await fetch('/api/liked-songs');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'No se pudieron cargar favoritos');
      const tracks = (data.tracks || []).map((t) => ({ ...t, source: 'youtube' }));
      if (!tracks.length) throw new Error('No hay canciones favoritas');
      if (merge) addToShuffleBag(tracks, data.title);
      else {
        setPlayerMode('youtube');
        playerModeRef.current = 'youtube';
        initShuffleBag(tracks, data.title || 'Me gusta');
        setUnavailableCount(data.unavailable || 0);
      }
    } catch (e) {
      showToast(e.message, true);
    } finally {
      if (!merge) setPlaylistLoading(false);
    }
  };

  const loadPlaylist = async (id, title, merge = false) => {
    if (!id) return;
    if (!merge) {
      setSelectedPlaylistId(id);
      setPlaylistTitle(`Cargando '${title || 'playlist'}'...`);
      setPlaylistLoading(true);
    }
    const cached = !merge ? await getCachedPlaylist(id) : null;
    if (cached?.tracks?.length && !merge) {
      initShuffleBag(cached.tracks.map((t) => ({ ...t, source: 'youtube' })), cached.title);
      setPlaylistTitle(`${cached.title} (cache)`);
      setPlaylistLoading(false);
    }
    try {
      const res = await fetch(`/api/playlist/${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'No se pudo cargar la playlist');
      const tracks = (data.tracks || []).map((t) => ({ ...t, source: 'youtube' }));
      if (!tracks.length) throw new Error('Playlist vacia');
      await cachePlaylist(id, data.title || title || 'Playlist', data.tracks || tracks);
      if (merge) addToShuffleBag(tracks, data.title || title);
      else {
        setPlayerMode('youtube');
        playerModeRef.current = 'youtube';
        initShuffleBag(tracks, data.title || title || 'Playlist');
        setUnavailableCount(data.unavailable || 0);
      }
    } catch (e) {
      if (!cached || merge) showToast(e.message, true);
      else showToast('Usando cache local', false);
    } finally {
      if (!merge) setPlaylistLoading(false);
    }
  };

  const handleGlobalSearch = async (e) => {
    e?.preventDefault();
    const q = globalSearchQuery.trim();
    if (!q) return;
    setIsSearching(true);
    setPlaylistResults([]);
    try {
      if (searchType === 'playlists') {
        if (searchSource === 'spotify') {
          if (!spotifyAuth.authenticated) throw new Error('Conecta Spotify para buscar playlists');
          const [data] = await spotifyApiFetch('/search', { q, type: 'playlist', limit: 24 });
          setPlaylistResults((data?.playlists?.items || []).filter(Boolean).map((p) => ({
            id: p.id,
            title: p.name || 'Sin titulo',
            author: p.owner?.display_name || '',
            thumbnail: p.images?.[0]?.url || '',
            url: p.external_urls?.spotify || '',
            source: 'spotify',
          })));
        } else {
          const res = await fetch(`/api/search/playlists?q=${encodeURIComponent(q)}`);
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.detail || 'No se pudo buscar playlists');
          setPlaylistResults((data.playlists || []).map((p) => ({ ...p, source: 'youtube' })));
        }
        return;
      }

      if (searchSource === 'spotify') {
        if (!spotifyAuth.authenticated) throw new Error('Conecta Spotify para buscar canciones');
        const [data] = await spotifyApiFetch('/search', { q, type: 'track', limit: 50 });
        const tracks = (data?.tracks?.items || []).filter((t) => t?.uri).map(fmtSpotifyTrack);
        if (!tracks.length) throw new Error('Sin resultados');
        setPlayerMode('spotify');
        playerModeRef.current = 'spotify';
        initShuffleBag(tracks, `Spotify: ${q}`);
      } else {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'No se pudo buscar');
        const tracks = (data.tracks || []).map((t) => ({ ...t, source: 'youtube' }));
        if (!tracks.length) throw new Error('Sin resultados');
        setPlayerMode('youtube');
        playerModeRef.current = 'youtube';
        initShuffleBag(tracks, `Busqueda: ${q}`);
      }
    } catch (err) {
      showToast(err.message || 'Error en la busqueda', true);
    } finally {
      setIsSearching(false);
    }
  };

  const clearQueue = () => {
    stopYouTubePlayback();
    setAllTracks([]);
    setShuffleBag([]);
    setPlayedHistory([]);
    setPriorityQueue([]);
    setCurrentTrack(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    allRef.current = [];
    bagRef.current = [];
    historyRef.current = [];
    priorityQueueRef.current = [];
    currentRef.current = null;
  };

  const reshuffleBag = () => {
    const next = fisherYates(bagRef.current);
    setShuffleBag(next);
    bagRef.current = next;
    setBagFlash(true);
    setTimeout(() => setBagFlash(false), 450);
    showToast('Bolsa rebarajada');
  };

  // --- Modo Hi-Fi: EQ + normalización ---
  // Si Hi-Fi acaba de activarse y suena una pista de YouTube por el IFrame, la reengancha
  // al audio directo desde la misma posición para que el efecto actúe ya.
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
      ensureEqGraph();
      resumeAudioCtx();
      applyEqGains(eqBands);
      showToast('🎚️ Ecualizador activado (modo Hi-Fi).');
      applyHifiEngineChange();
    } else {
      applyEqGains(EQ_FREQS.map(() => 0));
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

  // Motor directo (alta calidad + EQ/efectos) ↔ IFrame de YouTube (compatibilidad).
  const togglePreferDirect = () => {
    const on = !preferDirectRef.current;
    preferDirectRef.current = on;
    setPreferDirect(on);
    const t = currentRef.current;
    if (!t || t.source === 'spotify') {
      showToast(on ? '⚡ Motor directo (alta calidad) activado.' : 'Motor de YouTube (compatibilidad) activado.');
      return;
    }
    const at = getCurrentPlaybackTime();
    if (on) {
      if (!usingFallbackRef.current && !isVideoVisibleRef.current) {
        ensureEqGraph(); resumeAudioCtx();
        loadDirectAudio(t.id, at, { onFail: ytPlayerRef.current && ytReadyRef.current ? 'iframe' : 'skip' });
      }
      showToast('⚡ Motor directo: alta calidad (128k solo audio) + efectos DJ.');
    } else {
      if (usingFallbackRef.current && !hifiModeRef.current && ytPlayerRef.current && ytReadyRef.current) {
        usingFallbackRef.current = false;
        clearStallWatch();
        if (audioRef.current) { try { audioRef.current.pause(); } catch {} }
        ytPlayerRef.current.setVolume(volumeRef.current);
        if (mutedRef.current) ytPlayerRef.current.mute(); else ytPlayerRef.current.unMute();
        ytPlayerRef.current.loadVideoById(at > 1 ? { videoId: t.id, startSeconds: at } : t.id);
        setIsPlaying(true);
        armYtWatchdog(t.id);
      }
      showToast(hifiModeRef.current
        ? 'YouTube preferido, pero el Hi-Fi sigue forzando el audio directo.'
        : 'Motor de YouTube (compatibilidad) activado.');
    }
  };

  // --- Ver vídeo: reengancha la pista actual al IFrame; al ocultarlo vuelve al directo. ---
  const toggleVideo = () => {
    const next = !isVideoVisible;
    setIsVideoVisible(next);
    isVideoVisibleRef.current = next;
    const t = currentRef.current;
    if (!t || t.source === 'spotify') return;
    const at = getCurrentPlaybackTime();
    if (next) {
      if (ytPlayerRef.current && ytReadyRef.current) {
        clearStallWatch();
        usingFallbackRef.current = false;
        if (audioRef.current) { try { audioRef.current.pause(); } catch {} }
        ytPlayerRef.current.setVolume(volumeRef.current);
        if (mutedRef.current) ytPlayerRef.current.mute(); else ytPlayerRef.current.unMute();
        ytPlayerRef.current.loadVideoById(at > 1 ? { videoId: t.id, startSeconds: at } : t.id);
        setIsPlaying(true);
        armYtWatchdog(t.id);
      }
    } else if ((preferDirectRef.current || hifiModeRef.current) && !usingFallbackRef.current) {
      loadDirectAudio(t.id, at, { onFail: ytPlayerRef.current && ytReadyRef.current ? 'iframe' : 'skip' });
    }
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

  // Velocidad de reproducción (ciclo).
  const RATES = [1, 1.25, 1.5, 2, 0.75];
  const cycleRate = () => {
    const i = RATES.indexOf(playbackRateRef.current);
    const r = RATES[(i + 1) % RATES.length];
    setPlaybackRate(r); playbackRateRef.current = r;
    applyRate(r);
  };

  // --- Comparador de calidad + A/B (Spotify vs YouTube) ---
  const openQuality = async () => {
    const t = currentRef.current;
    if (!t) { showToast('No hay nada reproduciéndose.', true); return; }
    setQualityCtx({ ytId: t.source === 'spotify' ? null : t.id, spotifyUri: null, title: t.title, artist: t.artist, source: t.source });
    setShowQuality(true);
    if (t.source === 'spotify') {
      const m = await resolveSpotifyToYt(t);
      setQualityCtx((prev) => (prev ? { ...prev, ytId: m?.id || null } : prev));
    }
  };

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
      doPlayTrack({ ...t, source: 'spotify', uri, _ytResolved: true }, bagRef.current, historyRef.current);
      showToast('▶ Reproduciendo desde Spotify (nativo)');
    }
    setShowQuality(false);
  };

  // Tilt 3D de la carátula siguiendo el cursor (manipula CSS vars, sin re-render).
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

  // Gestos táctiles: deslizar la carátula → cambiar de pista.
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

  const pausePlaybackEngines = () => {
    setIsPlaying(false);
    try { ytPlayerRef.current?.pauseVideo?.(); } catch {}
    try { spotifyPlayerRef.current?.pause?.(); } catch {}
    try { audioRef.current?.pause?.(); } catch {}
    stopProgressTimer();
  };

  const activateSleepTimer = (minutes) => {
    if (sleepTimerRef.current) {
      clearInterval(sleepTimerRef.current);
      sleepTimerRef.current = null;
    }
    const mins = Number(minutes) || 0;
    if (mins <= 0) {
      setSleepTimer(null);
      showToast('Sleep timer cancelado');
      return;
    }
    let remaining = Math.round(mins * 60);
    setSleepTimer({ remaining });
    setShowSleepModal(false);
    showToast(`Sleep timer: ${mins} min`);
    sleepTimerRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(sleepTimerRef.current);
        sleepTimerRef.current = null;
        setSleepTimer(null);
        pausePlaybackEngines();
        showToast('Sleep timer finalizado');
        return;
      }
      setSleepTimer({ remaining });
    }, 1000);
  };

  const removeFavorite = (id) => {
    setFavorites((prev) => {
      const next = { ...prev };
      delete next[id];
      favoritesRef.current = next;
      if (currentRef.current && trackKey(currentRef.current) === id) setIsFavorite(false);
      return next;
    });
    showToast('Favorita eliminada');
  };

  const clearFavorites = () => {
    if (!confirm('¿Vaciar todas las favoritas?')) return;
    setFavorites({});
    favoritesRef.current = {};
    setIsFavorite(false);
    showToast('Favoritas vaciadas');
  };

  const exportFavorites = () => {
    const list = Object.values(favoritesRef.current || {});
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `noir-favoritas-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importFavorites = async (file) => {
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
      const valid = list.filter((t) => t && (t.id || t.uri || t.videoId) && t.title);
      if (!valid.length) throw new Error('El archivo no contiene favoritas validas');
      setFavorites((prev) => {
        const next = { ...prev };
        valid.forEach((t) => { next[trackKey(t)] = t; });
        favoritesRef.current = next;
        return next;
      });
      showToast(`Importadas ${valid.length} favoritas`);
    } catch (e) {
      showToast(e.message || 'No se pudo importar favoritas', true);
    }
  };

  const handleProgressPointerDown = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seekToSeconds(((e.clientX - rect.left) / rect.width) * (duration || 0));
  };
  const handleProgressPointerMove = (e) => {
    if (e.buttons !== 1) return;
    handleProgressPointerDown(e);
  };
  const handleVolumePointerDown = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const next = Math.round(((e.clientX - rect.left) / rect.width) * 100);
    applyVolume(Math.max(0, Math.min(100, next)));
  };
  const handleVolumePointerMove = (e) => {
    if (e.buttons !== 1) return;
    handleVolumePointerDown(e);
  };

  const selectQueuedTrack = (track) => {
    const nextBag = bagRef.current.filter((t) => trackKey(t) !== trackKey(track));
    const nextHistory = currentRef.current ? [...historyRef.current, currentRef.current] : historyRef.current;
    doPlayTrack(track, nextBag, nextHistory);
  };

  const removePriority = (index) => {
    const next = priorityQueueRef.current.filter((_, i) => i !== index);
    setPriorityQueue(next);
    priorityQueueRef.current = next;
  };

  const toggleFavorite = toggleFavoriteWithToast;
  const addToNext = addToNextWithToast;
  // Iniciar mix desde una canción: siembra afines (/api/similar) y arma una cola nueva
  // [semilla, ...afines], reproduce la semilla y baraja el resto. Como "ir a la radio de…".
  const startMixFrom = useCallback(async (track, e) => {
    if (e) e.stopPropagation();
    if (!track?.title) return;
    const provider = track.source === 'spotify' ? 'spotify' : 'youtube';
    setMixLoadingId(track.uri || track.id);
    showToast(`🎧 Creando mix desde "${track.title}"…`);
    try {
      const res = await fetch('/api/similar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seeds: [{ id: track.id, title: track.title, artist: track.artist, source: track.source, uri: track.uri }],
          provider, limit: 40, exclude: [],
        }),
      });
      if (!res.ok) { showToast('No se pudo crear el mix.', true); return; }
      const data = await res.json();
      const seen = new Set([track.uri || track.id]);
      const affine = (data.tracks || []).filter((t) => {
        const k = t.uri || t.id;
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (!affine.length) { showToast('No encontré temas afines para el mix.', true); return; }
      const pool = [track, ...affine];
      const bag = fisherYates(affine);
      consecutiveFailuresRef.current = 0;
      breakerTrippedRef.current = false;
      deadTracksRef.current = new Set();
      setUnavailableCount(0);
      setSelectedPlaylistId(null);
      setAllTracks(pool); allRef.current = pool;
      setShuffleBag(bag); bagRef.current = bag;
      setPlayedHistory([]); historyRef.current = [];
      setPlaylistTitle(`🎧 Mix: ${track.title}`);
      doPlayTrack(track, bag, []);
      showToast(`🎧 Mix de ${pool.length} temas afines a "${track.title}"`);
    } catch {
      showToast('Error al crear el mix.', true);
    } finally {
      setMixLoadingId(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const openAuthWizard = () => setShowAuthModal(true);

  const loadYouTubePlaylist = async (id, title, merge = false) => {
    if (!id) return;
    const cacheKey = `ytfull:${id}`; // no chocar con la caché de YT Music
    if (!merge) setSelectedPlaylistId(`youtube:${id}`);
    if (!merge) { setPlaylistTitle(`Cargando '${title}'…`); setPlaylistLoading(true); }
    const cached = !merge ? await getCachedPlaylist(cacheKey) : null;
    if (cached?.tracks?.length) {
      const cachedWithSrc = cached.tracks.map(t => ({ ...t, source: 'youtube' }));
      initShuffleBag(cachedWithSrc, cached.title);
      setPlaylistTitle(cached.title + ' (cache)');
      setPlaylistLoading(false);
    }
    try {
      const res = await fetch(`/api/youtube-playlist/${id}`);
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || 'No se pudo cargar'); }
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

  // ── Categorización de la biblioteca (agrupar playlists por género/tipo) ──
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
  const filterPls = (list) => {
    const q = plFilter.trim().toLowerCase();
    return q ? list.filter((p) => (p.title || '').toLowerCase().includes(q)) : list;
  };
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
      {pl.thumbnail ? <img src={hiResArt(pl.thumbnail, 120)} alt="" loading="lazy" /> : <div className="playlist-card-noimg"><ListMusic size={18} /></div>}
      <div className="playlist-meta">
        <h4>{pl.title}</h4>
        <span>{pl._kind === 'youtube' ? (pl.count > 0 ? `${pl.count} videos` : 'YouTube') : `${pl.count || 0} canciones`}</span>
      </div>
      {groupByCat && (
        <button className="playlist-merge-btn cat-tag-btn" title="Cambiar categoría" onClick={e => changeCat(pl._selId, e)}>🏷</button>
      )}
      <span className={`track-source-badge ${pl._kind === 'youtube' ? 'youtube' : 'ytmusic'}`}>{pl._kind === 'youtube' ? 'YT' : 'Music'}</span>
      {pl._kind === 'ytmusic' && (
        <button className="playlist-merge-btn" title="Asistente IA" onClick={e => { e.stopPropagation(); setAssistantSource({ kind: 'playlist', id: pl.id, title: pl.title }); setShowAssistant(true); }}>✨</button>
      )}
      <button
        className={`playlist-merge-btn merge-primary ${mergingIds.has(pl._selId) ? 'is-loading' : ''}`}
        title="Mezclar con la bolsa (unificar)" aria-label="Mezclar con la bolsa"
        disabled={mergingIds.has(pl._selId)}
        onClick={async e => {
          e.stopPropagation();
          const sid = pl._selId;
          startMerge(sid);
          try { await (pl._kind === 'youtube' ? loadYouTubePlaylist(pl.id, pl.title, true) : loadPlaylist(pl.id, pl.title, true)); }
          finally { endMerge(sid); }
        }}
      >{mergingIds.has(pl._selId) ? <span className="merge-spinner" /> : '✚'}</button>
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
      {pl.thumbnail ? <img src={hiResArt(pl.thumbnail, 120)} alt="" loading="lazy" /> : <div className="playlist-card-noimg"><ListMusic size={18} /></div>}
      <div className="playlist-meta">
        <h4>{pl.title}</h4>
        <span>{pl.count > 0 ? `${pl.count} canciones` : 'Spotify'}</span>
      </div>
      {groupByCat && (
        <button className="playlist-merge-btn cat-tag-btn" title="Cambiar categoría" onClick={e => changeCat(`spotify:${pl.id}`, e)}>🏷</button>
      )}
      <button
        className={`playlist-merge-btn merge-primary merge-spotify ${mergingIds.has(`spotify:${pl.id}`) ? 'is-loading' : ''}`}
        title="Mezclar con la bolsa (unificar)" aria-label="Mezclar con la bolsa"
        disabled={mergingIds.has(`spotify:${pl.id}`)}
        onClick={async e => {
          e.stopPropagation();
          const sid = `spotify:${pl.id}`;
          startMerge(sid);
          try { await loadSpotifyPlaylist(pl.id, pl.title, true); }
          finally { endMerge(sid); }
        }}
      >{mergingIds.has(`spotify:${pl.id}`) ? <span className="merge-spinner" /> : '✚'}</button>
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

  if (appUser === undefined) {
    return (
      <div className="login-screen">
        <div className="glass-panel login-card" style={{ textAlign: 'center' }}>
          <div className="login-logo"><Logo size={56} /></div>
          <h1 className="login-title">Noir</h1>
          <p className="login-sub"><Loader2 size={16} className="spin-icon" /> Restaurando sesion...</p>
        </div>
      </div>
    );
  }

  if (appUser === null) {
    return <LoginScreen onAuthed={setAppUser} />;
  }

  return (
    <>
      <div className="toast-container">
        {toasts.map(t => (
          <Toast key={t.id} message={t.message} onClose={() => setToasts(prev => prev.filter(x => x.id !== t.id))} />
        ))}
      </div>
      
      <div className={`app-container ${isCompact ? 'compact' : ''} mtab-${mobileTab}`}>
        <aside className="sidebar glass-panel">
          <div className="sidebar-header">
            <div className="logo"><Logo size={34} /><h2>Noir</h2></div>
            <div className={`auth-badge ${authStatus.authenticated ? 'authenticated' : 'guest'}`}>
              <span className="status-dot" />
              {authStatus.authenticated ? 'YouTube conectado' : 'YouTube pendiente'}
            </div>
          </div>

          <div className="sidebar-nav">
            <button className={`nav-btn ${activeTab === 'library' ? 'active' : ''}`} onClick={() => setActiveTab('library')}><Music size={16} /> Biblioteca</button>
            <button className={`nav-btn ${activeTab === 'spotify' ? 'active' : ''}`} onClick={() => setActiveTab('spotify')}><SpotifyIcon /> Spotify</button>
            <button className={`nav-btn ${activeTab === 'external' ? 'active' : ''}`} onClick={() => setActiveTab('external')}><Link2 size={16} /> Externa</button>
          </div>

          <div className="sidebar-content">
            {activeTab !== 'external' && (
              <div className="nav-section noir-actions">
                {activeTab === 'library' ? (
                  <>
                    <button className="action-btn" onClick={() => authStatus.authenticated ? loadLikedSongs(false) : openAuthWizard()}>
                      <Heart size={16} /> Me gusta
                    </button>
                    <button className="action-btn fav-quick" onClick={openAuthWizard}>
                      <Link2 size={15} /> {authStatus.authenticated ? 'Gestionar YouTube' : 'Conectar YouTube'}
                    </button>
                  </>
                ) : (
                  <>
                    <button className="action-btn" onClick={() => spotifyAuth.authenticated ? loadSpotifyLiked(false) : setShowSpotifyModal(true)}>
                      <SpotifyIcon /> Favoritos Spotify
                    </button>
                    <button className="action-btn fav-quick" onClick={() => setShowSpotifyModal(true)}>
                      <Link2 size={15} /> {spotifyAuth.authenticated ? 'Gestionar Spotify' : 'Conectar Spotify'}
                    </button>
                  </>
                )}
                <button className="action-btn fav-quick" onClick={() => setShowSavedLists(true)}>
                  <FolderOpen size={15} /> Mis listas
                </button>
              </div>
            )}

            {activeTab === 'external' ? (
              <div className="playlist-section">
                <div className="external-form">
                  <label>Playlist de YouTube por ID</label>
                  <div className="input-group">
                    <input placeholder="PLxxxxxxxxxxxx" value={externalId}
                      onChange={e => setExternalId(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && externalId.trim() && loadPlaylist(externalId.trim(), 'Playlist Externa')} />
                    <button className="icon-btn" onClick={() => externalId.trim() && loadPlaylist(externalId.trim(), 'Playlist Externa')}>
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <span className="input-help">Pega el parámetro «list» de la URL de una playlist de YouTube para reproducirla o mezclarla.</span>
                </div>
              </div>
            ) : (
              <div className="playlist-section">
                <div className="lib-head">
                  <h3>{activeTab === 'spotify' ? 'Spotify' : 'Biblioteca'}</h3>
                  <button className="text-btn" onClick={activeTab === 'spotify' ? fetchSpotifyPlaylists : () => { fetchPlaylists(); fetchYouTubePlaylists(); }}>
                    <RefreshCw size={12} /> Actualizar
                  </button>
                </div>
                {(activeTab === 'spotify' ? spotifyPlaylists.length > 0 : (authStatus.authenticated && combinedYtPlaylists.length > 0)) &&
                  renderOrganizeControls(
                    activeTab === 'spotify' ? spotifyPlaylists : combinedYtPlaylists,
                    activeTab === 'spotify' ? catId.sp : catId.yt,
                  )}
                <label className="pl-filter">
                  <Search size={14} />
                  <input value={plFilter} onChange={(e) => setPlFilter(e.target.value)} placeholder="Filtrar listas" />
                  {plFilter && <button onClick={() => setPlFilter('')}><X size={12} /></button>}
                </label>
                <div className="playlists-container scrollable">
                  {activeTab === 'spotify' ? (
                    spotifyPlLoading ? <SkeletonRows rows={6} />
                    : !spotifyAuth.authenticated ? <EmptyState icon={<Lock size={28} />}>Conecta Spotify</EmptyState>
                    : filterPls(spotifyPlaylists).length === 0 ? <EmptyState icon={<ListMusic size={28} />}>{plFilter ? 'Sin coincidencias' : 'Sin playlists Spotify'}</EmptyState>
                    : groupByCat ? renderGrouped(filterPls(spotifyPlaylists), catId.sp, renderSpotifyCard)
                    : filterPls(spotifyPlaylists).map(renderSpotifyCard)
                  ) : (
                    !authStatus.authenticated ? <EmptyState icon={<Lock size={28} />}>Conecta YouTube para ver tu biblioteca</EmptyState>
                    : (combinedYtPlaylists.length === 0 && !ytPlaylistsLoaded) ? <SkeletonRows rows={6} />
                    : filterPls(combinedYtPlaylists).length === 0 ? <EmptyState icon={<ListMusic size={28} />}>{plFilter ? 'Sin coincidencias' : 'Sin playlists'}</EmptyState>
                    : groupByCat ? renderGrouped(filterPls(combinedYtPlaylists), catId.yt, renderYtCard)
                    : filterPls(combinedYtPlaylists).map(renderYtCard)
                  )}
                  {spotifyPlError && <p className="sidebar-note error">{spotifyPlError}</p>}
                  {spotifyRetryIn && <p className="sidebar-note">Spotify limita nuevas cargas por {spotifyRetryIn}s.</p>}
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
                <button className="settings-btn" style={{ color: crossfade ? 'var(--accent)' : undefined }}
                  onClick={() => { setCrossfade(v => !v); showToast(crossfade ? 'Crossfade desactivado' : '🎚️ Crossfade activado (fundido entre pistas)'); }}
                  title="Fundido de volumen al cambiar de canción">
                  <Disc3 size={16} /> Crossfade: {crossfade ? 'ON' : 'OFF'}
                </button>
                <button className="settings-btn" onClick={deleteAllOffline} disabled={!offlineList.length}
                  title={offlineStorageInfo?.quota ? `Usado ${(offlineStorageInfo.usage / 1048576).toFixed(0)} MB de ${(offlineStorageInfo.quota / 1073741824).toFixed(1)} GB disponibles. Clic para borrar las descargas.` : 'Canciones descargadas para escuchar sin conexión (clic para borrarlas todas)'}>
                  <Download size={16} /> Descargas: {offlineList.length}{offlineList.length ? ` · ${(offlineList.reduce((a, r) => a + (r.size || 0), 0) / 1048576).toFixed(0)} MB` : ''}
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
                  <SpotifyIcon /> {spotifyAuth.authenticated ? (spotifyAuth.user_name ? `Spotify: ${spotifyAuth.user_name}` : 'Spotify conectado') : 'Configurar Spotify'}
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

        <main className="main-player">
          <header className="player-header">
            <div className="current-playlist-info">
              <span className="subtitle">{playerMode === 'spotify' ? 'Spotify' : 'Noir player'}</span>
              <h1>{playlistTitle}</h1>
            </div>
            <form className="global-search" onSubmit={handleGlobalSearch}>
              <div className="search-input-wrapper">
                {isSearching ? <Loader2 className="spin-icon" /> : <Search />}
                <input value={globalSearchQuery} onChange={(e) => setGlobalSearchQuery(e.target.value)} placeholder="Buscar canciones o playlists" />
                <button type="submit" title="Buscar"><ChevronRight size={15} /></button>
              </div>
              <div className="search-switches">
                <button type="button" className={searchSource === 'youtube' ? 'active' : ''} onClick={() => setSearchSource('youtube')}>YT</button>
                <button type="button" className={searchSource === 'spotify' ? 'active' : ''} onClick={() => setSearchSource('spotify')}>SP</button>
                <button type="button" className={searchType === 'songs' ? 'active' : ''} onClick={() => setSearchType('songs')}>Canciones</button>
                <button type="button" className={searchType === 'playlists' ? 'active' : ''} onClick={() => setSearchType('playlists')}>Listas</button>
              </div>
            </form>
          </header>

          {playlistResults.length > 0 && (
            <div className="pl-results search-results-strip scrollable">
              {playlistResults.map((pl) => (
                <button
                  key={`${pl.source}-${pl.id}`}
                  className={`pl-result ${pl.source}`}
                  onClick={() => pl.source === 'spotify' && pl.url ? window.open(pl.url, '_blank', 'noopener,noreferrer') : loadPlaylist(pl.id, pl.title)}
                >
                  <span className="pl-result-thumb">{pl.thumbnail ? <img src={pl.thumbnail} alt="" /> : <ListMusic size={20} />}</span>
                  <span className="pl-result-meta"><strong>{pl.title}</strong><span>{pl.author || pl.source}</span></span>
                </button>
              ))}
            </div>
          )}

          <div className="player-widget">
            {currentTrack?.thumbnail && <div className="player-backdrop" aria-hidden="true" style={{ backgroundImage: `url('${currentArt}')` }} />}
            <div className="player-card glass-panel">
              <div className={`artwork-container ${isPlaying ? 'playing' : ''}`}
                onMouseMove={handleArtTilt} onMouseLeave={resetArtTilt}
                onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
                <img key={currentArt} className="art-fade" src={currentArt} alt="" />
                <div className={`yt-player-wrapper ${isVideoVisible ? '' : 'hidden'}`}>
                  <div id="yt-player-el" />
                </div>
                {currentTrack && (
                  <button className="expand-np-btn" onClick={() => setShowNowPlaying(true)} title="Pantalla completa">
                    <Maximize2 size={16} />
                  </button>
                )}
                <button className={`video-toggle ${isVideoVisible ? 'active' : ''}`} onClick={toggleVideo} title="Ver video">
                  <Tv size={18} />
                </button>
              </div>

              <div className="track-details">
                <div className="meta">
                  <h2>
                    <span>{currentTrack?.title || 'Selecciona musica para empezar'}</span>
                    {isBuffering ? <span className="engine-chip"><Loader2 size={11} className="spin-icon" /> Cargando</span> : currentTrack && <span className={`engine-chip ${engine}`}>{engineLabel}</span>}
                  </h2>
                  <p>{currentTrack?.artist || 'Carga una playlist o busca una cancion'}</p>
                </div>
                <button className={`fav-btn ${isFavorite ? 'active' : ''}`} onClick={toggleFavoriteWithToast} title="Favorito" disabled={!currentTrack}>
                  <Heart size={20} fill={isFavorite ? 'var(--accent)' : 'none'} />
                </button>
              </div>

              <div className="progress-section">
                <span>{fmt(currentTime)}</span>
                <div className="progress-bar-container" onPointerDown={handleProgressPointerDown} onPointerMove={handleProgressPointerMove} style={{ touchAction: 'none' }}>
                  <div className="progress-bar-bg" />
                  <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
                  <div className="progress-knob" style={{ left: `${progress}%` }} />
                </div>
                <span onClick={() => setShowRemaining((s) => !s)} style={{ cursor: 'pointer' }} title="Alternar tiempo restante / total">{showRemaining ? `-${fmt(Math.max(0, duration - currentTime))}` : fmt(duration)}</span>
              </div>

              <div className="controls-section">
                <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }} className="control-btn secondary" onClick={doPrevTrack}><SkipBack size={26} /></motion.button>
                <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className={`control-btn play-btn ${isPlaying ? 'playing' : ''}`} onClick={togglePlayPause}>
                  {isPlaying ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" />}
                </motion.button>
                <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }} className="control-btn secondary" onClick={doNextTrack}><SkipForward size={26} /></motion.button>
              </div>

              <div className="footer-controls">
                <div className="volume-control">
                  <button className="volume-btn" onClick={toggleMute}><VolumeIcon size={18} /></button>
                  <div className="volume-slider-container" onPointerDown={handleVolumePointerDown} onPointerMove={handleVolumePointerMove} style={{ touchAction: 'none' }}>
                    <div className="volume-slider-bg" />
                    <div className="volume-slider-fill" style={{ width: `${isMuted ? 0 : volume}%` }} />
                    <div className="volume-knob" style={{ left: `${isMuted ? 0 : volume}%` }} />
                  </div>
                </div>
                <Visualizer active={isPlaying} bars={20} style={{ width: 72, height: 26, flexShrink: 0 }} analyserRef={analyserRef} real={engine === 'audio'} />
                <button className="volume-btn" onClick={() => setShowEq(true)} title="Audio y EQ"><Sliders size={17} /></button>
                <button className="volume-btn" onClick={() => setShowSleepModal(true)} title="Sleep timer"><Timer size={17} /></button>
                <button className="volume-btn" onClick={() => setRepeatOne((r) => !r)} title="Repetir una" style={{ color: repeatOne ? 'var(--accent)' : undefined }}><Repeat1 size={16} /></button>
                <button className="volume-btn" onClick={cycleRate} title="Velocidad de reproducción" style={{ fontSize: '0.72rem', fontWeight: 700, color: playbackRate !== 1 ? 'var(--accent)' : undefined }}>{playbackRate}×</button>
                <button className="volume-btn" onClick={downloadCurrent} disabled={!currentTrack}
                  title={currentTrack && offlineKeys.has(currentKey) ? 'Descargada (disponible sin conexión)' : 'Descargar para escuchar sin conexión'}
                  style={{ color: currentTrack && offlineKeys.has(currentKey) ? 'var(--accent)' : undefined }}>
                  {currentTrack && downloadingKeys.has(currentKey) ? <Loader2 size={16} className="spin-icon" />
                    : currentTrack && offlineKeys.has(currentKey) ? <CheckCircle2 size={16} />
                    : <Download size={16} />}
                </button>
                <button className="volume-btn" onClick={() => setIsCompact((c) => !c)} title={isCompact ? 'Expandir' : 'Modo compacto'}>
                  {isCompact ? <Maximize2 size={17} /> : <Minimize2 size={17} />}
                </button>
              </div>
            </div>
            <audio ref={audioRef}
              onEnded={handleAudioEnded}
              onError={() => {
                // Durante la carga inicial el fallo lo maneja la promesa de play()
                // (escalona HQ→AAC→IFrame). Aquí solo errores ya EN reproducción.
                if (!usingFallbackRef.current || directSettlingRef.current) return;
                usingFallbackRef.current = false;
                failCurrentAndAdvance('Error de audio directo. Probando la siguiente…');
              }}
              onWaiting={onAudioWaiting}
              onStalled={onAudioWaiting}
              onPlaying={onAudioPlaying}
              preload="none"
            />
          </div>
        </main>

        <section className="queue-panel glass-panel">
          <div className="queue-header">
            <div className="title-with-icon">
              <ListMusic size={20} />
              <h2>Cola</h2>
            </div>
            <div className="queue-header-actions">
              <button
                className={`text-btn radio-btn ${radioMode ? 'radio-on' : ''}`}
                onClick={() => {
                  const on = !radioMode;
                  radioModeRef.current = on; // eager: maybeRefillRadio lee el ref, no el estado
                  setRadioMode(on);
                  if (on) {
                    showToast('📻 Radio infinita activada: la bolsa se extenderá sola con temas afines.');
                    if (bagRef.current.length <= RADIO_LOW_WATER && currentRef.current) maybeRefillRadio(currentRef.current);
                  } else {
                    showToast('Radio infinita desactivada.');
                  }
                }}
                title="Radio infinita: cuando la bolsa se agota, añade automáticamente temas relacionados (automix de YouTube Music) para que la música no pare."
              >
                <Radio size={12} className={radioLoading ? 'icon-pulse' : ''} /> Radio{radioMode ? ' ON' : ''}
              </button>
              <button
                className={`text-btn radio-btn discover-btn ${discoverMode ? 'radio-on' : ''}`}
                onClick={() => {
                  const on = !discoverMode;
                  discoverModeRef.current = on; // eager: maybeDiscover lee el ref
                  setDiscoverMode(on);
                  try { localStorage.setItem('rsp_discover', on ? '1' : '0'); } catch {}
                  if (on) {
                    showToast('✨ Descubrir similares: mezcla temas NUEVOS afines a lo que suena (YT Music + Spotify).');
                    if (currentRef.current) maybeDiscover(currentRef.current, true);
                  } else {
                    showToast('Descubrir similares desactivado.');
                  }
                }}
                title="Descubrir similares (tipo Smart Shuffle de Spotify): busca canciones NUEVAS parecidas a lo que suena y las intercala en la bolsa (automix + IA)."
              >
                <Sparkles size={12} className={discoverLoading ? 'icon-pulse' : ''} /> Descubrir{discoverMode ? ' ON' : ''}
              </button>
              <button
                className={`text-btn radio-btn ${autoReshuffle ? 'radio-on' : ''}`}
                onClick={() => {
                  const on = !autoReshuffle;
                  setAutoReshuffle(on);
                  autoReshuffleRef.current = on;
                  showToast(on ? '🔀 Reorden continuo: rebaraja TODA la lista tras cada canción (las ya sonadas también entran).' : 'Reorden continuo desactivado.');
                }}
                title="Reorden continuo: cada vez que termina una canción rebaraja la lista COMPLETA (puede repetir); solo evita repetir de inmediato la que acaba de sonar."
              >
                <Shuffle size={12} /> Reorden{autoReshuffle ? ' ON' : ''}
              </button>
              <button className="text-btn" onClick={reshuffleBag} disabled={!shuffleBag.length} title="Rebarajar el orden de lo que queda por sonar (shuffle real: no repite hasta agotar la bolsa).">
                <RefreshCw size={12} className={reshuffling ? 'icon-spin' : ''} /> Rebarajar
              </button>
              <span className="mood-wrap">
                <button
                  className={`text-btn ${moodOpen ? 'radio-on' : ''}`}
                  onClick={() => setMoodOpen((o) => !o)}
                  title="Cola por ánimo con IA: genera al vuelo una cola para Entrenar, Estudiar, Fiesta, Relax… adaptada a tu gusto."
                >
                  {moodLoading ? <Loader2 size={12} className="spin-icon" /> : <Sparkles size={12} />} Ánimo IA
                </button>
                {moodOpen && (
                  <>
                    <div className="mood-backdrop" onClick={() => setMoodOpen(false)} />
                    <div className="mood-dropdown" role="menu">
                      <div className="mood-dropdown-title"><Sparkles size={12} /> Cola por ánimo (IA)</div>
                      <div className="mood-chips">
                        {[['Entrenar', '🏋️'], ['Estudiar', '📚'], ['Fiesta', '🎉'], ['Relax', '🌙'], ['Concentración', '🧠'], ['Viaje', '🚗']].map(([m, emo]) => (
                          <button key={m} className="mood-chip" disabled={!!moodLoading} onClick={() => loadMoodQueue(m)}>
                            {moodLoading === m ? <Loader2 size={12} className="spin-icon" /> : <span className="mood-chip-emo">{emo}</span>} {m}
                          </button>
                        ))}
                      </div>
                      <div className="mood-dropdown-note">Reemplaza la bolsa por una cola nueva del ánimo elegido.</div>
                    </div>
                  </>
                )}
              </span>
              <button className="text-btn" onClick={() => { if (!allTracks.length) return showToast('Carga algo en la bolsa primero.', true); setShowCreatePl(true); }} title="Crea una playlist con las canciones cargadas y súbela a tu YouTube Music o Spotify" disabled={!allTracks.length}>
                <ListPlus size={12} /> Crear playlist
              </button>
              <button className="text-btn" onClick={downloadBag} disabled={!allTracks.length} title="Descargar todas las canciones cargadas para escuchar sin conexión">
                <Download size={12} /> Descargar bolsa
              </button>
              <button className="text-btn" onClick={clearQueue} disabled={!allTracks.length && !priorityQueue.length} title="Limpiar cola">
                <Trash2 size={12} /> Limpiar
              </button>
            </div>
          </div>

          <div className="shuffle-stats queue-summary">
            <div className={`bag-loaded ${allTracks.length ? 'has' : ''}`}>
              <span className="bag-loaded-dot" />
              <strong>{playlistTitle}</strong>
            </div>
            <div className="bag-meter">
              <div className="bag-meter-main">
                <span className={`bag-meter-num ${bagFlash ? 'flash' : ''}`}>{shuffleBag.length}</span>
                <span className="bag-meter-sub">pendientes de {allTracks.length}</span>
              </div>
              <span className="bag-meter-pct">{bagProgress}%</span>
            </div>
            <div className="bag-progress">
              <div className={`bag-progress-fill ${bagFlash ? 'flash' : ''}`} style={{ width: `${bagProgress}%` }} />
            </div>
            {bagRemainingSec > 0 && (
              <span className="bag-time"><Timer size={11} /> {fmtLong(bagRemainingSec)} restantes</span>
            )}
            {unavailableCount > 0 && (
              <span className="bag-time"><AlertCircle size={11} /> {unavailableCount} no disponibles (omitidas)</span>
            )}
          </div>

          <div className="queue-lists-container">
            <div className="queue-nav">
              <button className={`queue-nav-btn ${queueTab === 'next' ? 'active' : ''}`} onClick={() => setQueueTab('next')}>
                Siguientes <span className="qn-count">{nextList.length}</span>
              </button>
              <button className={`queue-nav-btn ${queueTab === 'history' ? 'active' : ''}`} onClick={() => setQueueTab('history')}>
                Historial <span className="qn-count">{historyList.length}</span>
              </button>
            </div>

            {queueTab === 'next' && autoReshuffle ? (
              // Reorden continuo: no mostramos "la siguiente" concreta (cambia tras cada
              // canción). En su lugar, un panel con otro estilo. La cola prioritaria sí se respeta.
              <div className="queue-content scrollable reorden-wrap">
                {priorityQueue.length > 0 && (
                  <div className="reorden-pq-note">
                    <ListPlus size={13} /> Cola prioritaria (se respeta): {priorityQueue.length}
                  </div>
                )}
                <div className="reorden-panel">
                  {peekEnabled && reordenPeekView ? (
                    <div className="reorden-reveal">
                      <span className="reorden-reveal-badge"><Eye size={12} /> A continuación</span>
                      <div className="reorden-reveal-card">
                        {reordenPeekView.thumbnail && <img src={reordenPeekView.thumbnail} alt="" loading="lazy" />}
                        <div className="reorden-reveal-meta">
                          <strong>{reordenPeekView.title}</strong>
                          <span>{reordenPeekView.artist}</span>
                        </div>
                      </div>
                      <button className="reorden-reroll" onClick={rerollPeek} title="Re-baraja la próxima sorpresa sin cortar la canción actual">
                        <RefreshCw size={13} className={reshuffling ? 'icon-spin' : ''} /> Otra sorpresa
                      </button>
                    </div>
                  ) : (
                    <>
                      {reordenCovers.length ? (
                        <div className="reorden-deck" style={{ '--n': reordenCovers.length }} aria-hidden="true">
                          {reordenCovers.map((src, i) => (
                            <span className="rd-card" style={{ '--i': i }} key={i}>
                              <img src={src} alt="" loading="lazy" />
                            </span>
                          ))}
                          <span className="reorden-deck-badge"><Shuffle size={16} /></span>
                        </div>
                      ) : (
                        <span className="reorden-panel-ico"><Shuffle size={30} /></span>
                      )}
                      <strong>Reorden continuo</strong>
                      <p>El orden se rebaraja tras cada canción.<br />La próxima es sorpresa 🎲</p>
                    </>
                  )}
                  <div className="reorden-stats">
                    <span className="reorden-stat"><b>{shuffleBag.length}</b> por sonar</span>
                    <span className="reorden-stat-sep" />
                    <span className="reorden-stat"><b>{playedHistory.length}</b> ya sonaron</span>
                  </div>
                  <span className="reorden-panel-count">{allTracks.length} canciones en juego</span>

                  {/* Controles: espiar la siguiente + ventana anti-repetición */}
                  <div className="reorden-controls">
                    <button
                      className={`reorden-ctrl-btn ${peekEnabled ? 'on' : ''}`}
                      onClick={() => {
                        const on = !peekEnabled;
                        setPeekEnabled(on); peekEnabledRef.current = on;
                        try { localStorage.setItem('rsp_reorden_peek', on ? '1' : '0'); } catch {}
                      }}
                      title="Espiar la siguiente: revela (y fija) la próxima canción que sonará, en vez de dejarla en sorpresa."
                    >
                      {peekEnabled ? <EyeOff size={13} /> : <Eye size={13} />} {peekEnabled ? 'Ocultar' : 'Espiar'}
                    </button>
                    <div className="reorden-avoid" title="Cuántas de las últimas canciones evita repetir el reorden antes de permitirlas de nuevo.">
                      <span className="reorden-avoid-label">Sin repetir</span>
                      <div className="reorden-seg">
                        {[['Libre', 0], ['Suave', 8], ['Estricto', 25]].map(([label, n]) => (
                          <button
                            key={n}
                            className={reordenAvoid === n ? 'on' : ''}
                            onClick={() => {
                              setReordenAvoid(n); reordenAvoidRef.current = n;
                              try { localStorage.setItem('rsp_reorden_avoid', String(n)); } catch {}
                            }}
                          >{label}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : queueTab === 'next' ? (
              <VirtualList
                className="queue-content scrollable"
                items={nextList}
                resetKey={`${selectedPlaylistId || 'queue'}-${priorityQueue.length}-${shuffleBag.length}`}
                itemHeight={64}
                getKey={(it, i) => `${it.pq ? 'pq' : 'bag'}-${trackKey(it.t)}-${i}`}
                emptyContent={<EmptyState icon={<ListMusic size={28} />}>Bolsa vacia</EmptyState>}
                renderItem={(it) => {
                  const t = it.t;
                  return (
                    <div className={`queue-track-card ${it.pq ? 'pq' : ''} ${currentKey === trackKey(t) ? 'active' : ''}`} onClick={() => selectQueuedTrack(t)}>
                      <span className="queue-thumb">
                        {t.thumbnail ? <img src={hiResArt(t.thumbnail, 160)} alt="" loading="lazy" /> : <Music size={18} />}
                        {currentKey === trackKey(t) && <span className="eq-bars"><i /><i /><i /></span>}
                      </span>
                      <div className="queue-track-meta">
                        <h4>{t.title}</h4>
                        <span>{t.artist || 'Artista desconocido'}</span>
                      </div>
                      <div className="queue-row-actions">
                        {offlineKeys.has(trackKey(t)) && <CheckCircle2 size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} title="Descargada (offline)" />}
                        {it.pq && <span className="track-source-badge priority">NEXT</span>}
                        {t.source && <span className={`track-source-badge ${t.source}`}>{t.source === 'spotify' ? 'SP' : 'YT'}</span>}
                        {t.duration && <div className="queue-track-duration">{t.duration}</div>}
                        {it.pq ? (
                          <button className="queue-mix-btn" title="Quitar de siguientes" onClick={(e) => { e.stopPropagation(); removePriority(it.pqIndex); }}>
                            <X size={13} />
                          </button>
                        ) : (
                          <button className="queue-mix-btn" title="Reproducir siguiente" onClick={(e) => addToNext(t, e)}>
                            <ListPlus size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                }}
              />
            ) : (
              <VirtualList
                className="queue-content scrollable"
                items={historyList}
                resetKey={selectedPlaylistId || 'history'}
                itemHeight={64}
                getKey={(t, i) => `${trackKey(t)}-${i}`}
                emptyContent={<EmptyState icon={<ListMusic size={28} />}>Sin historial</EmptyState>}
                renderItem={(t) => (
                  <div className={`queue-track-card ${currentKey === trackKey(t) ? 'active' : ''}`} onClick={() => selectQueuedTrack(t)}>
                    <span className="queue-thumb">
                      {t.thumbnail ? <img src={hiResArt(t.thumbnail, 160)} alt="" loading="lazy" /> : <Music size={18} />}
                    </span>
                    <div className="queue-track-meta"><h4>{t.title}</h4><span>{t.artist || 'Artista desconocido'}</span></div>
                    {t.source && <span className={`track-source-badge ${t.source}`}>{t.source === 'spotify' ? 'SP' : 'YT'}</span>}
                    {t.duration && <div className="queue-track-duration">{t.duration}</div>}
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

      <Deferred open={showSleepModal}>
      <SleepTimerModal
        show={showSleepModal}
        sleepTimer={sleepTimer}
        onActivate={activateSleepTimer}
        onClose={() => setShowSleepModal(false)}
      />
      </Deferred>

      <Deferred open={showStatsModal}>
      <StatsModal show={showStatsModal} onClose={() => setShowStatsModal(false)} />
      </Deferred>

      <Deferred open={showEq}>
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
        preferDirect={preferDirect}
        onTogglePreferDirect={togglePreferDirect}
        djFilter={djFilter}
        onDjFilterChange={setDjFilter}
        djEcho={djEcho}
        onToggleDjEcho={() => setDjEcho((v) => !v)}
      />
      </Deferred>

      <Deferred open={showQuality}>
      <QualityModal
        show={showQuality}
        onClose={() => setShowQuality(false)}
        ctx={qualityCtx}
        onPlayVia={playSameFrom}
        spotifyAuthed={spotifyAuth.authenticated}
      />
      </Deferred>

      <Deferred open={showShortcuts}>
      <ShortcutsModal show={showShortcuts} onClose={() => setShowShortcuts(false)} />
      </Deferred>

      <Deferred open={showFavManager}>
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
      </Deferred>

      <Deferred open={showAssistant}>
      <AssistantModal
        show={showAssistant}
        source={assistantSource}
        onClose={() => setShowAssistant(false)}
        onPlayTracks={(tracks, label) => { initShuffleBag(tracks, label); setShowAssistant(false); }}
        onAddToBag={(tracks, label) => addToShuffleBag(tracks, label)}
        onAddNext={(t) => addToNext(t, { stopPropagation() {} })}
        showToast={showToast}
      />
      </Deferred>

      <Deferred open={showSavedLists}>
      <SavedListsModal
        show={showSavedLists}
        onClose={() => setShowSavedLists(false)}
        currentTracks={allTracks}
        currentTitle={playlistTitle}
        onPlayTracks={(tracks, label) => { initShuffleBag(tracks, label); setShowSavedLists(false); }}
        onMixTracks={(tracks, label) => { addToShuffleBag(tracks, label); setShowSavedLists(false); }}
        showToast={showToast}
      />
      </Deferred>

      <Deferred open={showCreatePl}>
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
      </Deferred>

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
        analyserRef={analyserRef}
        engine={engine}
        autoReshuffle={autoReshuffle}
        reordenCovers={reordenCovers}
        peekNext={peekEnabled ? reordenPeekView : null}
        nextUp={upcoming.length ? upcoming[upcoming.length - 1] : null}
        volume={volume}
        isMuted={isMuted}
        VolumeIcon={VolumeIcon}
        onClose={() => setShowNowPlaying(false)}
        onTogglePlay={togglePlayPause}
        onNext={doNextTrack}
        onPrev={doPrevTrack}
        onToggleFav={toggleFavorite}
        onStartMix={() => currentTrack && startMixFrom(currentTrack)}
        mixBusy={!!mixLoadingId}
        onToggleMute={toggleMute}
        onSeekPointerDown={handleProgressPointerDown}
        onSeekPointerMove={handleProgressPointerMove}
        onVolPointerDown={handleVolumePointerDown}
        onVolPointerMove={handleVolumePointerMove}
      />

    </>
  );
}
