// --- State Management ---
let allTracks = [];      // Full list of tracks in active playlist
let shuffleBag = [];     // Shuffled bag (empties as tracks play)
let playedHistory = [];  // Played tracks history
let currentTrack = null;
let isPlaying = false;
let isMuted = false;
let currentVolume = 80;
let activeTab = 'library';
let activeQueueTab = 'next';
let isVideoVisible = false;
let filterQuery = '';

// Plyr Player Instance
let player = null;
let isPlayingFallback = false;
let ytErrorTimeout = null;

// --- Initialize Setup ---
document.addEventListener('DOMContentLoaded', () => {
    // Initial icons render
    lucide.createIcons();
    
    // Check server auth status
    checkAuthStatus();
    
    // Setup Seeker & Volume Drag Listeners
    initProgressDrag();
    initVolumeDrag();
    
    // Initialize Plyr
    initPlyrPlayer();
});

// --- Plyr Player Initialization ---
function initPlyrPlayer() {
    player = new Plyr('#player', {
        controls: [], // Hide default controls so we can use our custom UI
        youtube: { 
            noCookie: true, 
            rel: 0, 
            showinfo: 0, 
            iv_load_policy: 3, 
            modestbranding: 1,
            autoplay: 1
        }
    });

    // --- Plyr Event Listeners ---
    player.on('ready', () => {
        player.volume = currentVolume / 100;
        player.muted = isMuted;
    });

    player.on('play', () => {
        isPlaying = true;
        updatePlayPauseButton();
        document.getElementById('eq-visualizer').classList.add('active');
        clearTimeout(ytErrorTimeout); // Cancel error timeout once playing starts
    });

    player.on('pause', () => {
        isPlaying = false;
        updatePlayPauseButton();
        document.getElementById('eq-visualizer').classList.remove('active');
    });

    player.on('ended', () => {
        isPlaying = false;
        document.getElementById('eq-visualizer').classList.remove('active');
        nextTrack(); // Auto skip to next
    });

    player.on('timeupdate', () => {
        const currentTime = player.currentTime;
        const duration = player.duration;
        if (duration) {
            const percent = (currentTime / duration) * 100;
            document.getElementById('progress-fill').style.width = `${percent}%`;
            document.getElementById('progress-knob').style.left = `${percent}%`;
            
            document.getElementById('time-current').textContent = formatTime(currentTime);
            document.getElementById('time-total').textContent = formatTime(duration);
        }
    });

    // Handle Youtube embedding blocks / other errors
    player.on('error', (event) => {
        console.warn("Plyr error details:", event);
        handlePlayerFailure();
    });
}

// Fallback handling when YouTube restricts embedding or playback fails
function handlePlayerFailure() {
    clearTimeout(ytErrorTimeout);
    if (!isPlayingFallback && currentTrack) {
        showToast("Restricción de inserción detectada. Cargando audio directo...", false);
        loadDirectAudioFallback(currentTrack.id);
    } else {
        showToast("Error de reproducción. Saltando...", true);
        setTimeout(nextTrack, 2000);
    }
}

// --- Tab Switching (Sidebar) ---
function switchTab(tabName) {
    activeTab = tabName;
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
    
    if (tabName === 'library') {
        document.querySelector('button[onclick="switchTab(\'library\')"]').classList.add('active');
        document.getElementById('tab-library').classList.add('active');
    } else {
        document.querySelector('button[onclick="switchTab(\'external\')"]').classList.add('active');
        document.getElementById('tab-external').classList.add('active');
    }
}

// --- Queue Tab Switching (Right Panel) ---
function switchQueueTab(tabName) {
    activeQueueTab = tabName;
    document.getElementById('queue-tab-next').classList.toggle('active', tabName === 'next');
    document.getElementById('queue-tab-history').classList.toggle('active', tabName === 'history');
    
    document.getElementById('queue-next-pane').classList.toggle('active', tabName === 'next');
    document.getElementById('queue-history-pane').classList.toggle('active', tabName === 'history');
    
    renderQueue();
}

// --- Seeker Progress Drag & Click Operations ---
function initProgressDrag() {
    const progressContainer = document.getElementById('progress-container');
    const progressFill = document.getElementById('progress-fill');
    const progressKnob = document.getElementById('progress-knob');
    
    let isDragging = false;
    
    function seekToPosition(e) {
        if (!currentTrack || !player) return;
        
        const rect = progressContainer.getBoundingClientRect();
        let posX = (e.clientX - rect.left) / rect.width;
        posX = Math.max(0, Math.min(1, posX));
        
        progressFill.style.width = `${posX * 100}%`;
        progressKnob.style.left = `${posX * 100}%`;
        
        const duration = player.duration;
        if (duration) {
            const targetTime = posX * duration;
            document.getElementById('time-current').textContent = formatTime(targetTime);
            if (!isDragging) {
                player.currentTime = targetTime;
            }
        }
    }
    
    progressContainer.addEventListener('mousedown', (e) => {
        isDragging = true;
        seekToPosition(e);
        
        const onMouseMove = (moveEvent) => {
            if (isDragging) seekToPosition(moveEvent);
        };
        
        const onMouseUp = (upEvent) => {
            if (isDragging) {
                isDragging = false;
                const rect = progressContainer.getBoundingClientRect();
                let posX = (upEvent.clientX - rect.left) / rect.width;
                posX = Math.max(0, Math.min(1, posX));
                
                const duration = player.duration;
                if (duration) {
                    player.currentTime = posX * duration;
                }
                
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            }
        };
        
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

// --- Volume Drag Operations ---
function initVolumeDrag() {
    const volumeContainer = document.getElementById('volume-container');
    const volumeFill = document.getElementById('volume-fill');
    const volumeKnob = document.getElementById('volume-knob');
    
    function changeVolume(e) {
        if (!player) return;
        
        const rect = volumeContainer.getBoundingClientRect();
        let posX = (e.clientX - rect.left) / rect.width;
        posX = Math.max(0, Math.min(1, posX));
        
        currentVolume = Math.round(posX * 100);
        volumeFill.style.width = `${currentVolume}%`;
        volumeKnob.style.left = `${currentVolume}%`;
        
        player.volume = currentVolume / 100;
        if (player.muted && currentVolume > 0) {
            player.muted = false;
            isMuted = false;
        }
        updateVolumeIcon();
    }
    
    volumeContainer.addEventListener('mousedown', (e) => {
        changeVolume(e);
        
        const onMouseMove = (moveEvent) => {
            changeVolume(moveEvent);
        };
        
        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
        
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

// --- Real Shuffle Logic (Fisher-Yates) ---
function initShuffleBag(tracks) {
    allTracks = [...tracks];
    playedHistory = [];
    refillShuffleBag();
}

function refillShuffleBag() {
    shuffleBag = [...allTracks];
    
    for (let i = shuffleBag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffleBag[i], shuffleBag[j]] = [shuffleBag[j], shuffleBag[i]];
    }
    
    showToast("¡Bolsa vaciada y rebarajada con éxito!");
    updateShuffleStats();
}

function selectTrack(track) {
    if (currentTrack) {
        playedHistory.push(currentTrack);
    }
    shuffleBag = shuffleBag.filter(t => t.id !== track.id);
    playTrack(track);
}

function playTrack(track) {
    clearTimeout(ytErrorTimeout);
    isPlayingFallback = false;
    currentTrack = track;
    
    // Update player UI (Titles, CoverArt)
    document.getElementById('track-title').textContent = track.title;
    document.getElementById('track-artist').textContent = track.artist;
    
    const artwork = track.thumbnail || "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=600&auto=format&fit=crop";
    document.getElementById('track-art').src = artwork;
    
    // Dynamic background update
    updateAmbientBackground(artwork);
    
    if (player) {
        // Load YouTube track via Plyr source setter
        player.source = {
            type: 'video',
            sources: [
                {
                    src: track.id,
                    provider: 'youtube'
                }
            ]
        };
        
        // Plyr sometimes doesn't fire an error event if embedding blocks
        // Setup a watchdog timeout to catch blocks if play fails to start within 5s
        ytErrorTimeout = setTimeout(() => {
            if (player.buffered === 0 && !isPlaying) {
                console.warn("YouTube play timeout - triggers fallback");
                handlePlayerFailure();
            }
        }, 5000);
        
        const playPromise = player.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(console.error);
        }
    }
    
    updateShuffleStats();
    renderQueue();
}

// Bypasses the YouTube Iframe embedding block by requesting the direct stream URL from our proxy
async function loadDirectAudioFallback(videoId) {
    try {
        isPlayingFallback = true;
        document.getElementById('track-artist').textContent = "Bypaseando restricciones...";
        
        // Directly load from our proxy endpoint which streams raw audio chunks into Plyr
        player.source = {
            type: 'audio',
            title: currentTrack.title,
            sources: [
                {
                    src: `/api/stream-audio/${videoId}`,
                    type: 'audio/webm'
                }
            ]
        };
        
        // Plyr will automatically handle the stream playback natively
        await player.play();
        
        document.getElementById('track-artist').textContent = currentTrack.artist;
    } catch (e) {
        console.error("Direct audio fallback failed:", e);
        showToast("No se pudo omitir la restricción de este video. Saltando...", true);
        isPlayingFallback = false;
        setTimeout(nextTrack, 2000);
    }
}

function nextTrack() {
    if (allTracks.length === 0) return;
    
    if (shuffleBag.length === 0) {
        refillShuffleBag();
    }
    
    const next = shuffleBag.pop();
    if (currentTrack) {
        playedHistory.push(currentTrack);
    }
    
    playTrack(next);
}

function prevTrack() {
    if (playedHistory.length === 0) {
        showToast("No hay canciones en el historial", false);
        return;
    }
    
    const prev = playedHistory.pop();
    if (currentTrack) {
        shuffleBag.push(currentTrack);
    }
    playTrack(prev);
}

function togglePlayPause() {
    if (!currentTrack) {
        if (allTracks.length > 0) {
            nextTrack();
        }
        return;
    }
    
    if (player) {
        player.togglePlay();
    }
}

function toggleMute() {
    if (!player) return;
    player.muted = !player.muted;
    isMuted = player.muted;
    updateVolumeIcon();
}

function toggleVideoView() {
    isVideoVisible = !isVideoVisible;
    const playerWrapper = document.getElementById('plyr-player-container');
    const toggleBtn = document.getElementById('btn-toggle-video');
    
    playerWrapper.classList.toggle('hidden', !isVideoVisible);
    toggleBtn.classList.toggle('active', isVideoVisible);
}

function reshuffleBag() {
    if (allTracks.length === 0) return;
    refillShuffleBag();
    renderQueue();
}

// --- UI Sync utilities ---
function updatePlayPauseButton() {
    const playBtn = document.getElementById('btn-play-pause');
    playBtn.classList.toggle('playing', isPlaying);
    
    const iconName = isPlaying ? 'pause' : 'play';
    playBtn.innerHTML = `<i data-lucide="${iconName}" class="play-icon"></i>`;
    lucide.createIcons();
}

function updateVolumeIcon() {
    const muteBtn = document.getElementById('btn-mute');
    const fill = document.getElementById('volume-fill');
    const knob = document.getElementById('volume-knob');
    
    let iconName = 'volume-2';
    
    if (isMuted || currentVolume === 0) {
        iconName = 'volume-x';
        fill.style.width = '0%';
        knob.style.left = '0%';
    } else if (currentVolume < 30) {
        iconName = 'volume';
        fill.style.width = `${currentVolume}%`;
        knob.style.left = `${currentVolume}%`;
    } else if (currentVolume < 70) {
        iconName = 'volume-1';
        fill.style.width = `${currentVolume}%`;
        knob.style.left = `${currentVolume}%`;
    } else {
        iconName = 'volume-2';
        fill.style.width = `${currentVolume}%`;
        knob.style.left = `${currentVolume}%`;
    }
    
    muteBtn.innerHTML = `<i data-lucide="${iconName}"></i>`;
    lucide.createIcons();
}

function updateShuffleStats() {
    const total = allTracks.length;
    const remaining = shuffleBag.length;
    
    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-remaining').textContent = remaining;
    
    const progress = total > 0 ? ((total - remaining) / total) * 100 : 0;
    document.getElementById('bag-progress-fill').style.width = `${progress}%`;
}

function updateAmbientBackground(imgUrl) {
    const bg = document.getElementById('ambient-bg');
    bg.style.backgroundImage = `radial-gradient(circle at 10% 20%, hsla(342, 85%, 20%, 0.4) 0%, transparent 40%),
                                radial-gradient(circle at 90% 80%, hsla(263, 85%, 20%, 0.4) 0%, transparent 40%),
                                radial-gradient(circle at 50% 50%, rgba(12, 12, 14, 0.9) 0%, rgba(12, 12, 14, 1) 100%),
                                url('${imgUrl}')`;
}

// --- Queue Lists Rendering ---
function renderQueue() {
    const nextList = document.getElementById('queue-next-list');
    const historyList = document.getElementById('queue-history-list');
    const countNext = document.getElementById('count-next');
    const countHistory = document.getElementById('count-history');
    
    nextList.innerHTML = '';
    historyList.innerHTML = '';
    
    if (filterQuery !== '') {
        renderSearchResults();
        return;
    }
    
    const upcoming = [...shuffleBag].reverse();
    countNext.textContent = upcoming.length;
    
    if (upcoming.length === 0) {
        nextList.innerHTML = '<div class="list-placeholder-small">Bolsa vacía (se rellenará al finalizar)</div>';
    } else {
        upcoming.forEach((track, index) => {
            const card = createQueueTrackCard(track, index, false);
            nextList.appendChild(card);
        });
    }
    
    countHistory.textContent = playedHistory.length;
    
    if (playedHistory.length === 0) {
        historyList.innerHTML = '<div class="list-placeholder-small">Ninguna canción reproducida aún</div>';
    } else {
        const histCopy = [...playedHistory].reverse();
        histCopy.forEach((track, index) => {
            const card = createQueueTrackCard(track, index, true);
            historyList.appendChild(card);
        });
    }
}

function renderSearchResults() {
    const nextList = document.getElementById('queue-next-list');
    const countNext = document.getElementById('count-next');
    
    const query = filterQuery.toLowerCase();
    const results = allTracks.filter(t => 
        t.title.toLowerCase().includes(query) || 
        t.artist.toLowerCase().includes(query)
    );
    
    countNext.textContent = results.length;
    document.getElementById('queue-tab-next').innerHTML = `Resultados (${results.length})`;
    
    if (results.length === 0) {
        nextList.innerHTML = '<div class="list-placeholder-small">No se encontraron resultados</div>';
    } else {
        results.forEach((track, index) => {
            const active = currentTrack && currentTrack.id === track.id;
            const card = document.createElement('div');
            card.className = `queue-track-card ${active ? 'active' : ''}`;
            card.onclick = () => {
                selectTrack(track);
                clearSearchFilter();
            };
            
            card.innerHTML = `
                <img src="${track.thumbnail || ''}" alt="cover">
                <div class="queue-track-meta">
                    <h4>${track.title}</h4>
                    <span>${track.artist}</span>
                </div>
                <div class="queue-track-duration">${track.duration || ''}</div>
            `;
            nextList.appendChild(card);
        });
    }
}

function createQueueTrackCard(track, index, isHistoryCard) {
    const active = currentTrack && currentTrack.id === track.id;
    const card = document.createElement('div');
    card.className = `queue-track-card ${active ? 'active' : ''}`;
    
    card.onclick = () => {
        if (isHistoryCard) {
            const histIndex = playedHistory.findIndex(t => t.id === track.id);
            if (histIndex !== -1) {
                const itemsToBag = playedHistory.slice(histIndex + 1);
                if (currentTrack) itemsToBag.push(currentTrack);
                shuffleBag.push(...itemsToBag);
                playedHistory = playedHistory.slice(0, histIndex);
                playTrack(track);
            }
        } else {
            selectTrack(track);
        }
    };
    
    card.innerHTML = `
        <img src="${track.thumbnail || ''}" alt="cover">
        <div class="queue-track-meta">
            <h4>${track.title}</h4>
            <span>${track.artist}</span>
        </div>
        <div class="queue-track-duration">${track.duration || ''}</div>
    `;
    return card;
}

// --- Live Search ---
function filterTracks() {
    const query = document.getElementById('search-tracks').value;
    filterQuery = query.trim();
    
    if (filterQuery !== '') {
        switchQueueTab('next');
    } else {
        document.getElementById('queue-tab-next').innerHTML = `Siguientes (<span id="count-next">0</span>)`;
        updateShuffleStats();
        renderQueue();
    }
}

function clearSearchFilter() {
    filterQuery = '';
    document.getElementById('search-tracks').value = '';
    document.getElementById('queue-tab-next').innerHTML = `Siguientes (<span id="count-next">0</span>)`;
    renderQueue();
}

// --- Backend API Integration ---

async function checkAuthStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        
        const badge = document.getElementById('auth-status');
        const dot = badge.querySelector('.status-dot');
        const text = badge.querySelector('.status-text');
        
        badge.className = 'auth-badge'; // reset
        
        if (data.authenticated) {
            badge.classList.add('authenticated');
            text.textContent = 'Autenticado';
            
            document.getElementById('btn-liked-songs').classList.remove('disabled');
            document.getElementById('btn-clear-auth').classList.remove('hidden');
            fetchLibraryPlaylists();
        } else {
            badge.classList.add('guest');
            text.textContent = 'Modo Invitado';
            
            document.getElementById('btn-liked-songs').classList.add('disabled');
            document.getElementById('btn-clear-auth').classList.add('hidden');
            renderPlaylistsPlaceholder();
        }
    } catch (e) {
        console.error("Error reading auth status:", e);
        const badge = document.getElementById('auth-status');
        badge.className = 'auth-badge error';
        badge.querySelector('.status-text').textContent = 'Error';
    }
}

async function fetchLibraryPlaylists() {
    const container = document.getElementById('playlists-list');
    container.innerHTML = '<div class="list-placeholder-small">Cargando playlists...</div>';
    
    try {
        const res = await fetch('/api/playlists');
        if (!res.ok) throw new Error("API Error");
        
        const data = await res.json();
        container.innerHTML = '';
        
        if (data.playlists.length === 0) {
            container.innerHTML = '<div class="list-placeholder-small">No encontramos playlists en tu biblioteca.</div>';
            return;
        }
        
        data.playlists.forEach(pl => {
            const card = document.createElement('div');
            card.className = 'playlist-card';
            card.onclick = () => loadPlaylist(pl.id, pl.title);
            
            card.innerHTML = `
                <img src="${pl.thumbnail || ''}" alt="${pl.title}">
                <div class="playlist-meta">
                    <h4>${pl.title}</h4>
                    <span>${pl.count} canciones</span>
                </div>
            `;
            container.appendChild(card);
        });
    } catch (e) {
        console.error("Error loading library playlists:", e);
        container.innerHTML = '<div class="list-placeholder-small">Error al obtener playlists de la biblioteca.</div>';
    }
}

function renderPlaylistsPlaceholder() {
    const container = document.getElementById('playlists-list');
    container.innerHTML = `
        <div class="list-placeholder">
            <i data-lucide="lock" class="placeholder-icon"></i>
            <p>Inicia sesión con tu <code>oauth.json</code> para ver tu biblioteca.</p>
        </div>
    `;
    lucide.createIcons();
}

async function loadLikedSongs() {
    const btn = document.getElementById('btn-liked-songs');
    if (btn.classList.contains('disabled')) return;
    
    document.getElementById('active-playlist-title').textContent = "Cargando 'Canciones que te gustan'...";
    
    try {
        const res = await fetch('/api/liked-songs');
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Error al obtener canciones");
        }
        
        const data = await res.json();
        document.getElementById('active-playlist-title').textContent = data.title;
        
        if (data.tracks.length === 0) {
            showToast("No hay canciones gustadas en tu cuenta.", true);
            return;
        }
        
        initShuffleBag(data.tracks);
        nextTrack();
    } catch (e) {
        console.error("Error loading liked songs:", e);
        document.getElementById('active-playlist-title').textContent = "Error al cargar canciones";
        showToast(`Error: ${e.message}`, true);
    }
}

async function loadPlaylist(playlistId, playlistTitle) {
    document.getElementById('active-playlist-title').textContent = `Cargando '${playlistTitle}'...`;
    
    document.querySelectorAll('.playlist-card').forEach(card => card.classList.remove('active'));
    const clickCard = Array.from(document.querySelectorAll('.playlist-card')).find(c => c.textContent.includes(playlistTitle));
    if (clickCard) clickCard.classList.add('active');

    try {
        const res = await fetch(`/api/playlist/${playlistId}`);
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Error de red");
        }
        
        const data = await res.json();
        document.getElementById('active-playlist-title').textContent = data.title;
        
        if (data.tracks.length === 0) {
            showToast("Esta playlist no contiene pistas reproducibles.", true);
            return;
        }
        
        initShuffleBag(data.tracks);
        nextTrack();
    } catch (e) {
        console.error("Error loading playlist:", e);
        document.getElementById('active-playlist-title').textContent = "Error al cargar playlist";
        showToast(`Error: ${e.message}`, true);
    }
}

async function loadExternalPlaylist() {
    const input = document.getElementById('playlist-id-input');
    const plId = input.value.trim();
    
    if (!plId) {
        showToast("Por favor, ingresa un ID de playlist válido.", true);
        return;
    }
    
    loadPlaylist(plId, `Playlist Externa (${plId})`);
    input.value = '';
}

// --- Auth Modal Control ---
function openAuthModal() {
    document.getElementById('auth-modal').classList.remove('hidden');
    document.getElementById('auth-json-input').value = '';
}

function closeAuthModal() {
    document.getElementById('auth-modal').classList.add('hidden');
}

async function saveAuthCredentials() {
    const input = document.getElementById('auth-json-input');
    const content = input.value.trim();
    
    if (!content) {
        showToast("Por favor, introduce el contenido del archivo JSON.", true);
        return;
    }
    
    try {
        const res = await fetch('/api/save-auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: content })
        });
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Error al verificar credenciales");
        }
        
        showToast("¡Credenciales guardadas y verificadas!");
        closeAuthModal();
        checkAuthStatus();
    } catch (e) {
        console.error("Error verifying credentials:", e);
        showToast(`Error: ${e.message}`, true);
    }
}

async function logoutSession() {
    if (!confirm("¿Estás seguro de que deseas cerrar sesión? Esto eliminará oauth.json del servidor.")) return;
    
    try {
        const res = await fetch('/api/logout', { method: 'POST' });
        if (res.ok) {
            showToast("Sesión cerrada correctamente.");
            closeAuthModal();
            checkAuthStatus();
        }
    } catch (e) {
        showToast("Error al cerrar sesión", true);
    }
}

// --- Toast and Helper Utilities ---
function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = `toast-message ${isError ? 'error' : ''}`;
    toast.textContent = message;
    
    Object.assign(toast.style, {
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        padding: '12px 24px',
        borderRadius: '12px',
        background: isError ? 'linear-gradient(135deg, hsl(0, 84%, 60%) 0%, hsl(340, 80%, 45%) 100%)' : 'rgba(255, 255, 255, 0.95)',
        color: isError ? 'white' : 'black',
        fontSize: '0.85rem',
        fontWeight: '550',
        boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
        zIndex: '1000',
        transition: 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease',
        transform: 'translateY(100px)',
        opacity: '0'
    });
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.transform = 'translateY(0)';
        toast.style.opacity = '1';
    }, 50);
    
    setTimeout(() => {
        toast.style.transform = 'translateY(100px)';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function formatTime(seconds) {
    if (isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// Favorite toggle mock
function toggleFavoriteCurrent() {
    if (!currentTrack) return;
    const btn = document.getElementById('btn-favorite');
    btn.classList.toggle('active');
    
    const isActive = btn.classList.contains('active');
    showToast(isActive ? "Añadido a favoritos (Simulado)" : "Eliminado de favoritos (Simulado)");
}
