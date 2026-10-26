// ============================================================
// SoundGlass Music Player — renderer.js
// Permanent Persistence, Full Account Sync & Track Search
// ============================================================

// UI Elements
const minBtn = document.getElementById('min-btn');
const maxBtn = document.getElementById('max-btn');
const closeBtn = document.getElementById('close-btn');

const scLoginBtn = document.getElementById('sc-login-btn');
const scLoginText = document.getElementById('sc-login-text');

const soundcloudIframe = document.getElementById('soundcloud-hidden-iframe');

const mainAlbumArt = document.getElementById('main-album-art');
const bgCoverBlur = document.getElementById('bg-cover-blur');
const artSourcePill = document.getElementById('art-source-pill');
const trackTitle = document.getElementById('track-title');
const trackArtist = document.getElementById('track-artist');
const playerStatusTag = document.getElementById('player-status-tag');
const engineStatus = document.getElementById('engine-status');
const currentPlaylistNameEl = document.getElementById('current-playlist-name');

const seekBar = document.getElementById('seek-bar');
const currentTimeEl = document.getElementById('current-time');
const totalDurationEl = document.getElementById('total-duration');
const volumeSlider = document.getElementById('volume-slider');

const playBtn = document.getElementById('play-btn');
const playIcon = document.getElementById('play-icon');
const pauseIcon = document.getElementById('pause-icon');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');

const urlInput = document.getElementById('url-input');
const loadBtn = document.getElementById('load-btn');
const loadBtnText = document.getElementById('load-btn-text');
const refreshActivePlaylistBtn = document.getElementById('refresh-active-playlist-btn');
const refreshIcon = document.getElementById('refresh-icon');

const queueDrawer = document.getElementById('queue-drawer');
const queueToggleBtn = document.getElementById('queue-toggle-btn');
const queueCloseBtn = document.getElementById('queue-close-btn');
const queueList = document.getElementById('queue-list');
const queuePillCount = document.getElementById('queue-pill-count');
const queuePlaylistTitle = document.getElementById('queue-playlist-title');
const clearQueueBtn = document.getElementById('clear-queue-btn');
const trackSearchInput = document.getElementById('track-search-input');
const clearSearchBtn = document.getElementById('clear-search-btn');

const playlistsBtn = document.getElementById('playlists-btn');
const playlistsDrawer = document.getElementById('playlists-drawer');
const playlistsCloseBtn = document.getElementById('playlists-close-btn');
const playlistsList = document.getElementById('playlists-list');
const newPlaylistBtn = document.getElementById('new-playlist-btn');
const refreshLibraryBtn = document.getElementById('refresh-library-btn');

const playlistModal = document.getElementById('playlist-modal');
const playlistModalClose = document.getElementById('playlist-modal-close');
const newPlaylistInput = document.getElementById('new-playlist-input');
const cancelPlaylistBtn = document.getElementById('cancel-playlist-btn');
const createPlaylistBtn = document.getElementById('create-playlist-btn');

// State
let isPlaying = false;
let currentTrackIndex = 0;
let scWidget = null;
let scWidgetReady = false;
let pendingTrackToLoad = null;
let isSeeking = false;
let currentTrackDurationMs = 0;
let searchQuery = '';

// Persistent Multi-Playlist State
let savedPlaylists = [];
let activePlaylistId = 'default';

// ============================================================
// Multi-Tier Bulletproof Storage (File on Disk + LocalStorage)
// ============================================================
async function loadStoredPlaylists() {
  let loaded = false;

  // Layer 1: Attempt to load from JSON file on disk
  if (window.electronAPI && window.electronAPI.loadPlaylistsFile) {
    try {
      const res = await window.electronAPI.loadPlaylistsFile();
      if (res && res.success && res.data && res.data.playlists && res.data.playlists.length > 0) {
        savedPlaylists = res.data.playlists;
        activePlaylistId = res.data.activePlaylistId || savedPlaylists[0].id;
        currentTrackIndex = typeof res.data.lastTrackIndex === 'number' ? res.data.lastTrackIndex : 0;
        loaded = true;
      }
    } catch (e) {
      console.warn('File read note:', e);
    }
  }

  // Layer 2: Fallback to localStorage if file didn't exist yet
  if (!loaded) {
    try {
      const raw = localStorage.getItem('soundglass_playlists');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          savedPlaylists = parsed;
          activePlaylistId = localStorage.getItem('soundglass_active_playlist') || savedPlaylists[0].id;
          currentTrackIndex = parseInt(localStorage.getItem('soundglass_last_track_idx') || '0', 10);
          loaded = true;
        }
      }
    } catch (e) {
      console.error('LocalStorage read error:', e);
    }
  }

  // Sanitize: strip out any lingering legacy demo tracks
  if (savedPlaylists && savedPlaylists.length > 0) {
    savedPlaylists.forEach(pl => {
      if (Array.isArray(pl.tracks)) {
        pl.tracks = pl.tracks.filter(t => !t.id.toString().startsWith('demo-'));
      } else {
        pl.tracks = [];
      }
    });
  }

  // Default fallback only if brand new empty installation
  if (!savedPlaylists || savedPlaylists.length === 0) {
    savedPlaylists = [
      {
        id: 'default',
        name: 'My Playlist',
        sourceUrl: '',
        tracks: []
      }
    ];
  }

  const found = savedPlaylists.find(p => p.id === activePlaylistId);
  if (!found) {
    activePlaylistId = savedPlaylists[0].id;
  }

  const activePl = getActivePlaylist();
  if (currentTrackIndex < 0 || currentTrackIndex >= activePl.tracks.length) {
    currentTrackIndex = 0;
  }

  savePlaylistsToStorage();
}

function savePlaylistsToStorage() {
  const payload = {
    activePlaylistId: activePlaylistId,
    lastTrackIndex: currentTrackIndex,
    playlists: savedPlaylists
  };

  // Save to localStorage
  try {
    localStorage.setItem('soundglass_playlists', JSON.stringify(savedPlaylists));
    localStorage.setItem('soundglass_active_playlist', activePlaylistId);
    localStorage.setItem('soundglass_last_track_idx', currentTrackIndex.toString());
  } catch (e) {
    console.error('LocalStorage write error:', e);
  }

  // Save to persistent file on disk (written to userData, home dir, and app dir)
  if (window.electronAPI && window.electronAPI.savePlaylistsFile) {
    window.electronAPI.savePlaylistsFile(payload).catch(err => {
      console.warn('File save warning:', err);
    });
  }
}

// Ensure saved data is flushed when closing or reloading
window.addEventListener('beforeunload', () => savePlaylistsToStorage());
window.addEventListener('pagehide', () => savePlaylistsToStorage());

function getActivePlaylist() {
  return savedPlaylists.find(p => p.id === activePlaylistId) || savedPlaylists[0];
}

// Window Controls
if (window.electronAPI) {
  minBtn.addEventListener('click', () => window.electronAPI.minimizeWindow());
  maxBtn.addEventListener('click', () => window.electronAPI.maximizeWindow());
  closeBtn.addEventListener('click', () => window.electronAPI.closeWindow());
}

// Format milliseconds to mm:ss
function formatTime(ms) {
  if (!ms || isNaN(ms) || ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

// Update Play/Pause UI state
function setPlayState(playing) {
  isPlaying = playing;
  if (playing) {
    playIcon.classList.add('hidden');
    pauseIcon.classList.remove('hidden');
    engineStatus.textContent = 'Playing';
    engineStatus.className = 'text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20';
  } else {
    playIcon.classList.remove('hidden');
    pauseIcon.classList.add('hidden');
    engineStatus.textContent = 'Paused';
    engineStatus.className = 'text-[11px] font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20';
  }
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    } catch (e) {}
  }
  renderQueue();
}

// ============================================================
// SoundCloud In-App Account Login & UI Status
// ============================================================
scLoginBtn.addEventListener('click', async () => {
  scLoginText.textContent = 'Signing in…';

  try {
    const res = await window.electronAPI.soundCloudLogin();
    if (res && res.success) {
      setLoggedInUI();
      // Prompt user to sync right away
      handleAccountRefresh();
    } else {
      scLoginText.textContent = 'Sign In to SoundCloud';
    }
  } catch (err) {
    console.error('Login error:', err);
    scLoginText.textContent = 'Sign In to SoundCloud';
  }
});

function setLoggedInUI() {
  scLoginText.textContent = 'SoundCloud Connected ✓';
  scLoginBtn.className = 'flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[#ff5500] text-black transition-all';
  playerStatusTag.textContent = 'SoundCloud Linked';
}

// ============================================================
// Account Refresh: Deletes all previous playlists and imports
// all playlists & 100% of songs from user's SoundCloud account
// ============================================================
async function handleAccountRefresh() {
  refreshIcon.classList.add('animate-spin');
  refreshActivePlaylistBtn.disabled = true;
  if (refreshLibraryBtn) refreshLibraryBtn.disabled = true;
  engineStatus.textContent = 'Syncing...';

  try {
    let libRes = await window.electronAPI.fetchUserLibrary();

    // If user is not logged into SoundCloud, open login modal first
    if (!libRes || !libRes.success) {
      if (libRes && libRes.error === 'NOT_LOGGED_IN') {
        const proceed = confirm('To import your playlists and songs, please sign into your SoundCloud account. Would you like to sign in now?');
        if (proceed) {
          const loginRes = await window.electronAPI.soundCloudLogin();
          if (loginRes && loginRes.success) {
            setLoggedInUI();
            libRes = await window.electronAPI.fetchUserLibrary();
          } else {
            alert('SoundCloud sign-in was not completed. Library sync cancelled.');
            return;
          }
        } else {
          return;
        }
      } else {
        alert('Could not fetch library: ' + (libRes ? libRes.error : 'Unknown error'));
        return;
      }
    }

    if (libRes && libRes.success && libRes.playlists && libRes.playlists.length > 0) {
      // 1. DELETE ALL PREVIOUS PLAYLISTS as requested by user
      savedPlaylists = [];

      // 2. Import all playlists and their full song lists
      libRes.playlists.forEach((pl) => {
        savedPlaylists.push({
          id: pl.id,
          name: pl.name,
          sourceUrl: pl.sourceUrl || '',
          tracks: pl.tracks || []
        });
      });

      // 3. Make the first playlist active and reset track index
      activePlaylistId = savedPlaylists[0].id;
      currentTrackIndex = 0;

      // 4. Save permanently to disk immediately
      savePlaylistsToStorage();

      // 5. Update UI
      setLoggedInUI();
      renderPlaylists();
      renderQueue();

      // 6. Select and cue the first song ready to play
      const activePl = getActivePlaylist();
      if (activePl.tracks.length > 0) {
        selectTrack(0, false);
      }

      const totalSongs = savedPlaylists.reduce((acc, p) => acc + p.tracks.length, 0);
      alert(`Success! Deleted previous playlists and imported ${savedPlaylists.length} playlist(s) with ${totalSongs} total songs directly from your SoundCloud account!`);
    } else {
      alert('SoundCloud login was successful, but no playlists were found on your account. You can paste any playlist link in the search bar above to import songs!');
    }
  } catch (err) {
    console.error('Account refresh error:', err);
    alert('Refresh failed: ' + err.message);
  } finally {
    refreshIcon.classList.remove('animate-spin');
    refreshActivePlaylistBtn.disabled = false;
    if (refreshLibraryBtn) refreshLibraryBtn.disabled = false;
    engineStatus.textContent = isPlaying ? 'Playing' : 'Ready';
  }
}

// Hook up both refresh buttons
refreshActivePlaylistBtn.addEventListener('click', handleAccountRefresh);
if (refreshLibraryBtn) {
  refreshLibraryBtn.addEventListener('click', handleAccountRefresh);
}

// ============================================================
// Queue Management & Real-Time Track Search Filtering
// ============================================================
function renderQueue() {
  const currentPlaylist = getActivePlaylist();
  const allTracks = currentPlaylist.tracks || [];

  queuePillCount.textContent = `Queue (${allTracks.length})`;
  currentPlaylistNameEl.textContent = currentPlaylist.name;
  queuePlaylistTitle.textContent = `(${currentPlaylist.name})`;

  // Filter tracks by search query (instant search)
  const q = searchQuery.toLowerCase().trim();
  const displayedTracks = q
    ? allTracks
        .map((t, originalIndex) => ({ track: t, originalIndex }))
        .filter(item => 
          item.track.title.toLowerCase().includes(q) ||
          item.track.artist.toLowerCase().includes(q)
        )
    : allTracks.map((t, originalIndex) => ({ track: t, originalIndex }));

  queueList.innerHTML = '';

  if (allTracks.length === 0) {
    queueList.innerHTML = `
      <div class="text-center py-12 text-xs text-slate-500 space-y-2">
        <p class="font-medium text-slate-400">Queue is currently empty</p>
        <p>Click <span class="text-orange-400 font-semibold">"Refresh Account"</span> to import all songs from your SoundCloud account, or paste a link above!</p>
      </div>
    `;
    return;
  }

  if (displayedTracks.length === 0 && q) {
    queueList.innerHTML = `
      <div class="text-center py-8 text-xs text-slate-400 space-y-1">
        <p>No songs found matching "<span class="text-orange-400">${q}</span>"</p>
        <button id="reset-search-prompt" class="text-xs text-[#ff5500] hover:underline mt-1">Clear search filter</button>
      </div>
    `;
    const resetPrompt = document.getElementById('reset-search-prompt');
    if (resetPrompt) {
      resetPrompt.addEventListener('click', () => {
        trackSearchInput.value = '';
        searchQuery = '';
        clearSearchBtn.classList.add('hidden');
        renderQueue();
      });
    }
    return;
  }

  displayedTracks.forEach(({ track, originalIndex }) => {
    const isCurrent = originalIndex === currentTrackIndex;
    const item = document.createElement('div');
    item.className = `flex items-center justify-between p-2 rounded-xl transition-all group ${
      isCurrent ? 'bg-orange-500/20 border border-orange-500/40' : 'hover:bg-white/5 border border-transparent'
    }`;

    item.innerHTML = `
      <div class="flex items-center space-x-3 min-w-0 flex-1 cursor-pointer track-click-target">
        <div class="relative w-10 h-10 rounded-lg overflow-hidden border border-white/10 shrink-0">
          <img src="${track.art}" alt="" class="w-full h-full object-cover">
          ${isCurrent && isPlaying ? `
            <div class="absolute inset-0 bg-black/40 flex items-center justify-center">
              <span class="w-2 h-2 rounded-full bg-[#ff5500] animate-ping"></span>
            </div>
          ` : ''}
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-xs font-semibold ${isCurrent ? 'text-orange-400 font-bold' : 'text-slate-200'} truncate group-hover:text-white">${track.title}</div>
          <div class="text-[11px] text-slate-400 truncate">${track.artist}</div>
        </div>
      </div>
      <div class="flex items-center space-x-2 shrink-0 pl-2">
        <span class="text-[11px] font-mono text-slate-400">${track.durationMs > 0 ? formatTime(track.durationMs) : ''}</span>
        <button data-index="${originalIndex}" class="remove-track-btn w-6 h-6 flex items-center justify-center rounded text-slate-500 hover:text-rose-400 hover:bg-white/5 transition-colors" title="Remove track">
          ✕
        </button>
      </div>
    `;

    item.querySelector('.track-click-target').addEventListener('click', () => {
      selectTrack(originalIndex, true);
    });

    item.querySelector('.remove-track-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      removeTrackFromCurrentPlaylist(originalIndex);
    });

    queueList.appendChild(item);
  });
}

// Track Search Input Listeners
trackSearchInput.addEventListener('input', (e) => {
  searchQuery = e.target.value;
  if (searchQuery.trim().length > 0) {
    clearSearchBtn.classList.remove('hidden');
  } else {
    clearSearchBtn.classList.add('hidden');
  }
  renderQueue();
});

clearSearchBtn.addEventListener('click', () => {
  trackSearchInput.value = '';
  searchQuery = '';
  clearSearchBtn.classList.add('hidden');
  renderQueue();
  trackSearchInput.focus();
});

function removeTrackFromCurrentPlaylist(idx) {
  const currentPlaylist = getActivePlaylist();
  if (idx < 0 || idx >= currentPlaylist.tracks.length) return;

  currentPlaylist.tracks.splice(idx, 1);

  if (currentTrackIndex >= currentPlaylist.tracks.length) {
    currentTrackIndex = Math.max(0, currentPlaylist.tracks.length - 1);
  }

  savePlaylistsToStorage();

  if (currentPlaylist.tracks.length > 0) {
    if (idx === currentTrackIndex) {
      selectTrack(currentTrackIndex, isPlaying);
    } else {
      renderQueue();
    }
  } else {
    if (scWidget) { try { scWidget.pause(); } catch(e) {} }
    setPlayState(false);
    trackTitle.textContent = 'No track selected';
    trackArtist.textContent = 'Click "Refresh Account" or paste a SoundCloud link';
    currentTimeEl.textContent = '0:00';
    totalDurationEl.textContent = '0:00';
    seekBar.value = 0;
    renderQueue();
  }
}

clearQueueBtn.addEventListener('click', () => {
  const currentPlaylist = getActivePlaylist();
  if (confirm(`Remove all tracks from "${currentPlaylist.name}"?`)) {
    currentPlaylist.tracks = [];
    currentPlaylist.sourceUrl = '';
    currentTrackIndex = 0;
    savePlaylistsToStorage();

    if (scWidget) { try { scWidget.pause(); } catch(e) {} }
    setPlayState(false);
    trackTitle.textContent = 'Queue cleared';
    trackArtist.textContent = 'Click "Refresh Account" or paste a SoundCloud link';
    currentTimeEl.textContent = '0:00';
    totalDurationEl.textContent = '0:00';
    seekBar.value = 0;
    renderQueue();
  }
});

// ============================================================
// Playlists Drawer & Manager
// ============================================================
function renderPlaylists() {
  playlistsList.innerHTML = '';

  savedPlaylists.forEach((pl) => {
    const isActive = pl.id === activePlaylistId;
    const card = document.createElement('div');
    card.className = `flex items-center justify-between p-3 rounded-xl transition-all ${
      isActive ? 'bg-orange-500/20 border border-orange-500/40' : 'bg-white/5 hover:bg-white/10 border border-white/5'
    }`;

    card.innerHTML = `
      <div class="flex items-center space-x-3 cursor-pointer flex-1 select-playlist-target min-w-0">
        <div class="w-9 h-9 rounded-lg bg-orange-500/20 border border-orange-500/30 flex items-center justify-center text-[#ff5500] font-bold text-xs shrink-0">
          ${(pl.name || 'P').charAt(0).toUpperCase()}
        </div>
        <div class="min-w-0">
          <div class="text-xs font-semibold ${isActive ? 'text-orange-400 font-bold' : 'text-slate-200'} truncate">${pl.name}</div>
          <div class="text-[11px] text-slate-400 flex items-center space-x-1.5">
            <span>${pl.tracks.length} song${pl.tracks.length === 1 ? '' : 's'}</span>
            ${pl.sourceUrl ? '<span class="text-slate-500">•</span><span class="text-emerald-400/80">SoundCloud</span>' : ''}
          </div>
        </div>
      </div>
      <div class="flex items-center space-x-1.5 shrink-0 pl-2">
        ${isActive ? `
          <span class="text-[10px] uppercase font-bold text-orange-400 bg-orange-500/20 px-2 py-0.5 rounded-full border border-orange-500/30">Active</span>
        ` : `
          <button class="switch-to-btn px-2.5 py-1 text-[11px] rounded bg-white/10 hover:bg-white/20 text-slate-300 transition-colors">Select</button>
        `}
        ${savedPlaylists.length > 1 ? `
          <button data-id="${pl.id}" class="delete-playlist-btn text-slate-500 hover:text-rose-400 p-1.5 rounded hover:bg-white/5 transition-colors" title="Delete playlist">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        ` : ''}
      </div>
    `;

    const selectTarget = () => {
      activePlaylistId = pl.id;
      currentTrackIndex = 0;
      savePlaylistsToStorage();
      renderPlaylists();
      renderQueue();
      const currentPlaylist = getActivePlaylist();
      if (currentPlaylist.tracks.length > 0) {
        selectTrack(0, true);
      }
    };

    card.querySelector('.select-playlist-target').addEventListener('click', selectTarget);
    const switchBtn = card.querySelector('.switch-to-btn');
    if (switchBtn) switchBtn.addEventListener('click', selectTarget);

    const deleteBtn = card.querySelector('.delete-playlist-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Delete playlist "${pl.name}"?`)) {
          savedPlaylists = savedPlaylists.filter(p => p.id !== pl.id);
          if (activePlaylistId === pl.id) {
            activePlaylistId = savedPlaylists[0].id;
            currentTrackIndex = 0;
          }
          savePlaylistsToStorage();
          renderPlaylists();
          renderQueue();
          selectTrack(0, false);
        }
      });
    }

    playlistsList.appendChild(card);
  });
}

// Drawer Toggle Handlers
playlistsBtn.addEventListener('click', () => {
  renderPlaylists();
  playlistsDrawer.classList.toggle('translate-y-full');
  queueDrawer.classList.add('translate-y-full');
});
playlistsCloseBtn.addEventListener('click', () => {
  playlistsDrawer.classList.add('translate-y-full');
});

queueToggleBtn.addEventListener('click', () => {
  renderQueue();
  queueDrawer.classList.toggle('translate-y-full');
  playlistsDrawer.classList.add('translate-y-full');
  trackSearchInput.focus();
});
queueCloseBtn.addEventListener('click', () => {
  queueDrawer.classList.add('translate-y-full');
});

// Create New Playlist Modal
newPlaylistBtn.addEventListener('click', () => {
  newPlaylistInput.value = '';
  playlistModal.classList.remove('hidden');
  newPlaylistInput.focus();
});
playlistModalClose.addEventListener('click', () => playlistModal.classList.add('hidden'));
cancelPlaylistBtn.addEventListener('click', () => playlistModal.classList.add('hidden'));

createPlaylistBtn.addEventListener('click', () => {
  const name = newPlaylistInput.value.trim();
  if (!name) return;

  const newPl = {
    id: 'pl-' + Date.now(),
    name: name,
    sourceUrl: '',
    tracks: []
  };

  savedPlaylists.push(newPl);
  activePlaylistId = newPl.id;
  currentTrackIndex = 0;
  savePlaylistsToStorage();

  playlistModal.classList.add('hidden');
  renderPlaylists();
  renderQueue();
});

newPlaylistInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') createPlaylistBtn.click();
});

// ============================================================
// Media Session & Hardware Keyboard Media Keys Support
// ============================================================
function updateMediaSession(track) {
  if (!('mediaSession' in navigator) || !track) return;
  try {
    const plName = getActivePlaylist() ? getActivePlaylist().name : 'SoundGlass';
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || 'SoundCloud Track',
      artist: track.artist || 'SoundCloud Artist',
      album: plName,
      artwork: [
        { src: track.art, sizes: '500x500', type: 'image/jpeg' }
      ]
    });
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  } catch (err) {
    console.warn('MediaSession metadata error:', err);
  }
}

let mediaKeysInitialized = false;

function initMediaKeysAndSession() {
  if (mediaKeysInitialized) return;
  mediaKeysInitialized = true;

  // 1. Windows Native MediaSession Actions (Hardware keys & OS volume flyouts)
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', () => {
        if (!isPlaying) togglePlay();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        if (isPlaying) togglePlay();
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        playPrev();
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        playNext();
      });
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime && currentTrackDurationMs > 0 && scWidget) {
          scWidget.seekTo(details.seekTime * 1000);
        }
      });
    } catch (e) {
      console.warn('MediaSession action handler error:', e);
    }
  }

  // 2. Global System-Wide Media Keys from Electron IPC (works even when minimized or in games)
  if (window.electronAPI) {
    if (window.electronAPI.onMediaKeyNext) {
      window.electronAPI.onMediaKeyNext(() => {
        console.log('Hardware MediaNextTrack triggered');
        playNext();
      });
    }
    if (window.electronAPI.onMediaKeyPrev) {
      window.electronAPI.onMediaKeyPrev(() => {
        console.log('Hardware MediaPreviousTrack triggered');
        playPrev();
      });
    }
    if (window.electronAPI.onMediaKeyToggle) {
      window.electronAPI.onMediaKeyToggle(() => {
        console.log('Hardware MediaPlayPause triggered');
        togglePlay();
      });
    }
    if (window.electronAPI.onMediaKeyStop) {
      window.electronAPI.onMediaKeyStop(() => {
        if (scWidget) { try { scWidget.pause(); } catch(e) {} }
        setPlayState(false);
      });
    }
  }

  // 3. Local DOM Keyboard Media Key & Shortcut Listener (when window is in focus)
  window.addEventListener('keydown', (e) => {
    const isTyping = document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);

    // Hardware media keys on keyboard (Skip / Back / PlayPause / Stop)
    if (e.code === 'MediaTrackNext' || e.key === 'MediaTrackNext') {
      e.preventDefault();
      playNext();
      return;
    }
    if (e.code === 'MediaTrackPrevious' || e.key === 'MediaTrackPrevious') {
      e.preventDefault();
      playPrev();
      return;
    }
    if (e.code === 'MediaPlayPause' || e.key === 'MediaPlayPause') {
      e.preventDefault();
      togglePlay();
      return;
    }
    if (e.code === 'MediaStop' || e.key === 'MediaStop') {
      e.preventDefault();
      if (scWidget) { try { scWidget.pause(); } catch(err) {} }
      setPlayState(false);
      return;
    }

    // Convenient keyboard shortcuts when not typing in search bar or input field
    if (!isTyping) {
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowRight' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        playNext();
      } else if (e.code === 'ArrowLeft' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        playPrev();
      }
    }
  });
}

// ============================================================
// SoundCloud Audio Engine & Playback Management
// ============================================================
let currentLoadedUrl = null;

function initSoundCloudEngine() {
  initMediaKeysAndSession();

  if (typeof window.SC === 'undefined') {
    setTimeout(initSoundCloudEngine, 100);
    return;
  }

  try {
    scWidget = window.SC.Widget(soundcloudIframe);

    scWidget.bind(window.SC.Widget.Events.READY, () => {
      scWidgetReady = true;
      console.log('SoundCloud Widget Engine Ready');
      try {
        if (volumeSlider) {
          scWidget.setVolume(parseFloat(volumeSlider.value) * 100);
        }
      } catch(e) {}

      if (pendingTrackToLoad) {
        const { track, autoPlay } = pendingTrackToLoad;
        pendingTrackToLoad = null;
        loadAndPlayTrack(track, autoPlay);
      }
    });

    scWidget.bind(window.SC.Widget.Events.PLAY, () => setPlayState(true));
    scWidget.bind(window.SC.Widget.Events.PAUSE, () => setPlayState(false));
    scWidget.bind(window.SC.Widget.Events.FINISH, () => playNext());

    scWidget.bind(window.SC.Widget.Events.PLAY_PROGRESS, (data) => {
      if (!isSeeking && data) {
        const currentMs = data.currentPosition || 0;
        currentTimeEl.textContent = formatTime(currentMs);
        if (currentTrackDurationMs > 0) {
          seekBar.value = Math.floor((currentMs / currentTrackDurationMs) * 1000);
        }
      }
    });

    scWidget.bind(window.SC.Widget.Events.ERROR, (err) => {
      console.warn('SoundCloud Widget playback event error:', err);
    });
  } catch (err) {
    console.warn('Widget binding note:', err);
  }
}

function selectTrack(index, autoPlay = true) {
  const currentPlaylist = getActivePlaylist();
  const tracks = currentPlaylist.tracks || [];
  if (tracks.length === 0) return;

  if (index < 0) index = 0;
  if (index >= tracks.length) index = tracks.length - 1;
  currentTrackIndex = index;
  savePlaylistsToStorage();

  const track = tracks[currentTrackIndex];

  // Visuals updated immediately
  trackTitle.textContent = track.title || 'SoundCloud Track';
  trackArtist.textContent = track.artist || 'SoundCloud Artist';
  mainAlbumArt.src = track.art || 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&auto=format&fit=crop&q=80';
  bgCoverBlur.src = track.art || 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&auto=format&fit=crop&q=80';
  currentTrackDurationMs = track.durationMs || 0;
  totalDurationEl.textContent = formatTime(currentTrackDurationMs);
  currentTimeEl.textContent = '0:00';
  seekBar.value = 0;
  artSourcePill.textContent = 'SOUNDCLOUD';
  playerStatusTag.textContent = 'SoundCloud Stream Active';

  updateMediaSession(track);

  loadAndPlayTrack(track, autoPlay);
  renderQueue();
}

function loadAndPlayTrack(track, autoPlay = true) {
  if (!track || !track.url) return;

  const targetUrl = track.url;

  if (currentLoadedUrl === targetUrl && scWidgetReady && scWidget) {
    if (autoPlay) {
      try {
        scWidget.play();
        setPlayState(true);
      } catch(e) {}
    }
    return;
  }

  currentLoadedUrl = targetUrl;

  if (!scWidgetReady || !scWidget) {
    pendingTrackToLoad = { track, autoPlay };
    return;
  }

  try {
    scWidget.load(targetUrl, {
      auto_play: autoPlay,
      show_artwork: false,
      color: '#ff5500',
      callback: () => {
        if (autoPlay) {
          try {
            scWidget.play();
            setPlayState(true);
          } catch(e) {}
        }

        try {
          scWidget.getCurrentSound((sound) => {
            if (sound) {
              if (sound.title && (!track.title || track.title.startsWith('SoundCloud Track'))) {
                track.title = sound.title;
                trackTitle.textContent = sound.title;
              }
              if (sound.user && sound.user.username) {
                track.artist = sound.user.username;
                trackArtist.textContent = sound.user.username;
              }
              if (sound.artwork_url) {
                const highRes = sound.artwork_url.replace('-large', '-t500x500');
                track.art = highRes;
                mainAlbumArt.src = highRes;
                bgCoverBlur.src = highRes;
              }
              if (sound.duration) {
                track.durationMs = sound.duration;
                currentTrackDurationMs = sound.duration;
                totalDurationEl.textContent = formatTime(sound.duration);
              }
              savePlaylistsToStorage();
              renderQueue();
            }
          });
        } catch (soundErr) {
          console.warn('getCurrentSound warning:', soundErr);
        }
      }
    });
  } catch (err) {
    console.warn('Widget load fallback to direct iframe src:', err);
    soundcloudIframe.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(targetUrl)}&auto_play=${autoPlay}&show_user=false&color=%23ff5500`;
  }
}

// Timeline / Scrub bar Seeking
seekBar.addEventListener('mousedown', () => isSeeking = true);
seekBar.addEventListener('touchstart', () => isSeeking = true);

seekBar.addEventListener('input', (e) => {
  const ratio = e.target.value / 1000;
  currentTimeEl.textContent = formatTime(ratio * currentTrackDurationMs);
});

seekBar.addEventListener('change', (e) => {
  isSeeking = false;
  const ratio = e.target.value / 1000;
  const targetMs = ratio * currentTrackDurationMs;
  if (scWidget) {
    try {
      scWidget.seekTo(targetMs);
    } catch(err) {
      console.warn('Seek error:', err);
    }
  }
});

// Transport Controls
function togglePlay() {
  const currentPlaylist = getActivePlaylist();
  if (!currentPlaylist || currentPlaylist.tracks.length === 0) {
    alert('Please import songs using "Refresh Account" or paste a SoundCloud link above!');
    return;
  }

  const track = currentPlaylist.tracks[currentTrackIndex];

  if (isPlaying) {
    if (scWidget) {
      try { scWidget.pause(); } catch(e) {}
    }
    setPlayState(false);
  } else {
    if (!currentLoadedUrl || currentLoadedUrl !== track.url) {
      loadAndPlayTrack(track, true);
    } else if (scWidget) {
      try {
        scWidget.play();
        setPlayState(true);
      } catch(e) {
        loadAndPlayTrack(track, true);
      }
    } else {
      loadAndPlayTrack(track, true);
    }
  }
}

function playPrev() {
  const currentPlaylist = getActivePlaylist();
  if (currentPlaylist.tracks.length === 0) return;
  let prevIdx = currentTrackIndex - 1;
  if (prevIdx < 0) prevIdx = currentPlaylist.tracks.length - 1;
  selectTrack(prevIdx, true);
}

function playNext() {
  const currentPlaylist = getActivePlaylist();
  if (currentPlaylist.tracks.length === 0) return;
  let nextIdx = (currentTrackIndex + 1) % currentPlaylist.tracks.length;
  selectTrack(nextIdx, true);
}

playBtn.addEventListener('click', togglePlay);
prevBtn.addEventListener('click', playPrev);
nextBtn.addEventListener('click', playNext);

// Volume
volumeSlider.addEventListener('input', (e) => {
  const vol = parseFloat(e.target.value);
  if (scWidget) scWidget.setVolume(vol * 100);
});

// ============================================================
// Direct URL Import (Full-Depth Playlist Extraction)
// ============================================================
async function handleUrlInput() {
  const rawUrl = urlInput.value.trim();
  if (!rawUrl) return;

  if (!rawUrl.includes('soundcloud.com')) {
    alert('Please enter a valid SoundCloud link (e.g. soundcloud.com/artist/sets/playlist-name)');
    return;
  }

  loadBtnText.textContent = 'Extracting all…';
  loadBtn.disabled = true;

  try {
    const result = await window.electronAPI.extractSoundCloudUrl(rawUrl);

    if (result && result.success && result.tracks && result.tracks.length > 0) {
      const extracted = result.tracks;
      console.log(`Successfully extracted all ${extracted.length} songs from playlist!`);

      let targetPlaylist;
      if (result.isPlaylist && result.playlistTitle) {
        targetPlaylist = savedPlaylists.find(p => p.name === result.playlistTitle);
        if (!targetPlaylist) {
          targetPlaylist = {
            id: 'sc-set-' + Date.now(),
            name: result.playlistTitle,
            sourceUrl: result.sourceUrl || rawUrl,
            tracks: []
          };
          savedPlaylists.push(targetPlaylist);
        } else {
          targetPlaylist.sourceUrl = result.sourceUrl || rawUrl;
        }
        activePlaylistId = targetPlaylist.id;
      } else {
        targetPlaylist = getActivePlaylist();
        if (!targetPlaylist.sourceUrl) {
          targetPlaylist.sourceUrl = rawUrl;
        }
      }

      // Add all tracks
      targetPlaylist.tracks.push(...extracted);
      savePlaylistsToStorage();

      renderPlaylists();
      renderQueue();
      selectTrack(targetPlaylist.tracks.length - extracted.length, true);
      urlInput.value = '';
      alert(`Imported all ${extracted.length} songs into "${targetPlaylist.name}"!`);
    } else {
      alert('Could not parse playlist tracks from that URL.');
    }
  } catch (err) {
    console.error('Extraction error:', err);
    alert('Extraction failed: ' + err.message);
  } finally {
    loadBtnText.textContent = 'Import Songs';
    loadBtn.disabled = false;
  }
}

loadBtn.addEventListener('click', handleUrlInput);
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleUrlInput();
});

// ============================================================
// App Launch Initialization
// ============================================================
window.addEventListener('DOMContentLoaded', async () => {
  initSoundCloudEngine();

  await loadStoredPlaylists();
  renderPlaylists();
  renderQueue();

  const currentPlaylist = getActivePlaylist();
  if (currentPlaylist.tracks.length > 0) {
    // Cue up the exact saved song ready for playback (without harsh autoplay blast)
    const resumeIndex = Math.min(currentTrackIndex, currentPlaylist.tracks.length - 1);
    selectTrack(resumeIndex, false);
  }

  // Check if SoundCloud account is already connected
  try {
    const res = await window.electronAPI.fetchUserLibrary();
    if (res && res.success) {
      setLoggedInUI();
    }
  } catch (e) {}
});
