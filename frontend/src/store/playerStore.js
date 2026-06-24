import { create } from 'zustand';

export const usePlayerStore = create((set, get) => ({
  // Playback state
  currentTrack: null,
  isPlaying: false,
  isMuted: false,
  volume: 80,
  currentTime: 0,
  duration: 0,
  isVideoVisible: false,
  
  // Queue state
  allTracks: [],
  shuffleBag: [],
  playedHistory: [],
  
  // UI state
  activeTab: 'library', // 'library', 'search', 'queue'
  queueTab: 'next',
  searchQuery: '',
  searchResults: [],
  isSearching: false,
  
  // Auth state
  authStatus: { authenticated: false, oauth_exists: false },
  playlists: [],
  selectedPlaylistId: null,
  playlistTitle: 'Ninguna playlist seleccionada',
  isLoadingPlaylists: false,

  // Toast
  toast: null,
  
  // Actions
  setToast: (toast) => set({ toast }),
  setAuthStatus: (status) => set({ authStatus: status }),
  setPlaylists: (playlists) => set({ playlists }),
  setSelectedPlaylistId: (id) => set({ selectedPlaylistId: id }),
  setPlaylistTitle: (title) => set({ playlistTitle: title }),
  setIsLoadingPlaylists: (isLoading) => set({ isLoadingPlaylists: isLoading }),
  
  setActiveTab: (tab) => set({ activeTab: tab }),
  setQueueTab: (tab) => set({ queueTab: tab }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchResults: (results) => set({ searchResults: results }),
  setIsSearching: (isSearching) => set({ isSearching }),
  
  setCurrentTrack: (track) => set({ currentTrack: track }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setIsMuted: (isMuted) => set({ isMuted }),
  setVolume: (volume) => set({ volume }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  setIsVideoVisible: (visible) => set({ isVideoVisible: visible }),
  
  setAllTracks: (tracks) => set({ allTracks: tracks }),
  setShuffleBag: (bag) => set({ shuffleBag: bag }),
  setPlayedHistory: (history) => set({ playedHistory: history }),
  
  // Complex Actions
  playTrack: (track, forceReset = true) => {
    if (!track) return;
    set(state => {
      // Add current to history if it exists and we're forcing a new track
      const newHistory = [...state.playedHistory];
      if (state.currentTrack && forceReset && state.currentTrack.id !== track.id) {
        newHistory.push(state.currentTrack);
      }
      return {
        currentTrack: track,
        isPlaying: true,
        playedHistory: newHistory
      };
    });
  },
  
  nextTrack: () => {
    const state = get();
    if (state.shuffleBag.length > 0) {
      const bag = [...state.shuffleBag];
      const next = bag.pop();
      set({ shuffleBag: bag });
      get().playTrack(next, true);
    } else if (state.allTracks.length > 0) {
      // Refill bag
      const newBag = [...state.allTracks].sort(() => Math.random() - 0.5);
      const next = newBag.pop();
      set({ shuffleBag: newBag });
      get().playTrack(next, true);
    } else {
      set({ currentTrack: null, isPlaying: false });
    }
  },
  
  prevTrack: () => {
    const state = get();
    if (state.playedHistory.length > 0) {
      const history = [...state.playedHistory];
      const prev = history.pop();
      // Put current track back into shuffle bag so it plays next
      const newBag = [...state.shuffleBag];
      if (state.currentTrack) {
        newBag.push(state.currentTrack);
      }
      set({ playedHistory: history, shuffleBag: newBag });
      get().playTrack(prev, false);
    } else {
      // Rewind to 0 if no history
      set({ currentTime: 0 });
    }
  },
  
  searchSongs: async (query) => {
    if (!query.trim()) {
      set({ searchResults: [] });
      return;
    }
    set({ isSearching: true, activeTab: 'search' });
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error('Error al buscar');
      const data = await res.json();
      set({ searchResults: data.tracks || [] });
    } catch (e) {
      set({ toast: { type: 'error', message: 'Error en la búsqueda' } });
    } finally {
      set({ isSearching: false });
    }
  }
}));
