const { app, BrowserWindow, ipcMain, shell, session, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const os = require('os');

// Disable all Chromium autoplay restrictions so music starts immediately on click/launch
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Force consistent app name across dev and portable builds
app.name = 'SoundGlassPlayer';

let mainWindow;

// Triple-layer file paths for bulletproof playlist persistence
function getStorageFilePaths() {
  const filePaths = [];
  try {
    filePaths.push(path.join(app.getPath('userData'), 'user_saved_playlists.json'));
  } catch (e) {}
  try {
    filePaths.push(path.join(os.homedir(), '.soundglass_saved_playlists.json'));
  } catch (e) {}
  filePaths.push(path.join(__dirname, 'soundglass_saved_library.json'));
  return filePaths;
}

function readSavedPlaylistsFromFile() {
  const targets = getStorageFilePaths();
  for (const filePath of targets) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.playlists) && parsed.playlists.length > 0) {
          console.log(`Loaded library from ${filePath} (${parsed.playlists.length} playlists)`);
          return { success: true, data: parsed, path: filePath };
        } else if (Array.isArray(parsed) && parsed.length > 0) {
          console.log(`Loaded legacy library array from ${filePath} (${parsed.length} playlists)`);
          return {
            success: true,
            data: {
              activePlaylistId: parsed[0].id,
              lastTrackIndex: 0,
              playlists: parsed
            },
            path: filePath
          };
        }
      }
    } catch (err) {
      console.warn(`Could not read ${filePath}:`, err.message);
    }
  }
  return { success: false, data: null };
}

function writeSavedPlaylistsToFile(data) {
  if (!data) return { success: false, error: 'No data provided' };
  const targets = getStorageFilePaths();
  let writtenAny = false;
  let lastError = null;

  const jsonStr = JSON.stringify(data, null, 2);

  for (const filePath of targets) {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, jsonStr, 'utf-8');
      writtenAny = true;
    } catch (err) {
      lastError = err;
      console.error(`Failed to write playlists to ${filePath}:`, err.message);
    }
  }

  return writtenAny ? { success: true } : { success: false, error: lastError ? lastError.message : 'Write failed' };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1060,
    height: 840,
    minWidth: 860,
    minHeight: 640,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#090d16',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      partition: 'persist:soundglass-account', // Persistent login storage for SoundCloud
      webSecurity: false,
      backgroundThrottling: false // Prevent Electron from throttling background audio playback
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Grant all media, autoplay, and encrypted-media permissions to embedded SoundCloud streams
  mainWindow.webContents.session.setPermissionCheckHandler(() => true);
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });

  // Native Window Management
  ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('window-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
  });

  ipcMain.handle('window-is-maximized', () => {
    return mainWindow ? mainWindow.isMaximized() : false;
  });

  // ============================================================
  // File-Backed Playlist Persistence (Triple-layer storage)
  // ============================================================
  ipcMain.handle('load-playlists-file', () => {
    return readSavedPlaylistsFromFile();
  });

  ipcMain.handle('save-playlists-file', (event, data) => {
    return writeSavedPlaylistsToFile(data);
  });

  // ============================================================
  // SoundCloud In-App Account Login
  // ============================================================
  ipcMain.handle('soundcloud-account-login', async () => {
    return new Promise((resolve) => {
      const loginWin = new BrowserWindow({
        width: 580,
        height: 720,
        parent: mainWindow,
        modal: true,
        title: 'Sign in to SoundCloud',
        webPreferences: {
          partition: 'persist:soundglass-account',
          contextIsolation: true,
          nodeIntegration: false
        }
      });

      loginWin.loadURL('https://soundcloud.com/signin');

      let resolved = false;

      const checkLoginCookie = async () => {
        try {
          const scSession = session.fromPartition('persist:soundglass-account');
          const cookies = await scSession.cookies.get({});
          const oauthCookie = cookies.find(c => c.name === 'oauth_token' && c.value);

          if (oauthCookie) {
            if (!resolved) {
              resolved = true;
              setTimeout(() => {
                try { loginWin.close(); } catch(e) {}
                resolve({ success: true, token: oauthCookie.value });
              }, 1200);
            }
          }
        } catch (e) {
          console.error('Cookie inspection error:', e);
        }
      };

      loginWin.webContents.on('did-navigate', checkLoginCookie);
      loginWin.webContents.on('did-navigate-in-page', checkLoginCookie);

      const pollInterval = setInterval(checkLoginCookie, 1500);

      loginWin.on('closed', () => {
        clearInterval(pollInterval);
        if (!resolved) {
          resolved = true;
          const scSession = session.fromPartition('persist:soundglass-account');
          scSession.cookies.get({}).then(cookies => {
            const oauthCookie = cookies.find(c => c.name === 'oauth_token' && c.value);
            if (oauthCookie) {
              resolve({ success: true, token: oauthCookie.value });
            } else {
              resolve({ success: false, error: 'Login window closed without logging in' });
            }
          }).catch(() => resolve({ success: false, error: 'Login cancelled' }));
        }
      });
    });
  });

  // ============================================================
  // Fetch Logged-in User's Playlists & Hydrate Every Single Song
  // ============================================================
  ipcMain.handle('fetch-user-library', async () => {
    try {
      const scSession = session.fromPartition('persist:soundglass-account');
      const cookies = await scSession.cookies.get({});
      const oauthCookie = cookies.find(c => c.name === 'oauth_token' && c.value);

      if (!oauthCookie) {
        return { success: false, error: 'NOT_LOGGED_IN' };
      }

      const token = oauthCookie.value;
      const clientId = await getSoundCloudClientId();
      const authHeader = { 'Authorization': `OAuth ${token}` };

      // Step 1: Fetch user's profile to obtain user ID
      let userProfile = null;
      try {
        userProfile = await httpGetJson(
          `https://api-v2.soundcloud.com/me?client_id=${clientId}`,
          authHeader
        );
      } catch (err) {
        console.warn('Error fetching /me profile:', err.message);
      }

      const allPlaylistsMap = new Map();

      // Step 2: Fetch user's created & owned playlists via /users/{id}/playlists
      if (userProfile && userProfile.id) {
        try {
          const userPlaylistsData = await httpGetJson(
            `https://api-v2.soundcloud.com/users/${userProfile.id}/playlists?limit=50&client_id=${clientId}`,
            authHeader
          );
          const list = Array.isArray(userPlaylistsData) 
            ? userPlaylistsData 
            : (userPlaylistsData && userPlaylistsData.collection ? userPlaylistsData.collection : []);
          for (const pl of list) {
            if (pl && (pl.id || pl.title)) {
              allPlaylistsMap.set(pl.id || pl.permalink_url, pl);
            }
          }
        } catch (err) {
          console.warn('Error fetching /users/{id}/playlists:', err.message);
        }
      }

      // Step 3: Fetch user's library items (/me/library/all)
      try {
        const libraryData = await httpGetJson(
          `https://api-v2.soundcloud.com/me/library/all?limit=50&client_id=${clientId}`,
          authHeader
        );
        if (libraryData && libraryData.collection) {
          for (const item of libraryData.collection) {
            const entity = item.playlist || item.system_playlist;
            if (entity && (entity.id || entity.title)) {
              const key = entity.id || entity.permalink_url;
              if (!allPlaylistsMap.has(key)) {
                allPlaylistsMap.set(key, entity);
              }
            }
          }
        }
      } catch (err) {
        console.warn('Error querying /me/library/all:', err.message);
      }

      // Step 4: Fetch user's liked items (/users/{id}/likes)
      if (userProfile && userProfile.id) {
        try {
          const likesData = await httpGetJson(
            `https://api-v2.soundcloud.com/users/${userProfile.id}/likes?limit=50&client_id=${clientId}`,
            authHeader
          );
          if (likesData && likesData.collection) {
            const likedTracks = [];
            for (const item of likesData.collection) {
              if (item.playlist) {
                const key = item.playlist.id || item.playlist.permalink_url;
                if (!allPlaylistsMap.has(key)) {
                  allPlaylistsMap.set(key, item.playlist);
                }
              } else if (item.track) {
                likedTracks.push(item.track);
              }
            }

            // If user has liked tracks, generate a "Liked Songs" playlist
            if (likedTracks.length > 0) {
              const hydratedLikes = await hydrateTracks(likedTracks, clientId, authHeader);
              if (hydratedLikes.length > 0) {
                allPlaylistsMap.set('liked-songs-virtual', {
                  id: 'sc-likes-' + userProfile.id,
                  title: 'Liked Tracks (SoundCloud)',
                  permalink_url: 'https://soundcloud.com/you/likes',
                  tracks: hydratedLikes
                });
              }
            }
          }
        } catch (err) {
          console.warn('Error fetching /users/{id}/likes:', err.message);
        }
      }

      const parsedPlaylists = [];

      // Process and hydrate every single playlist to ensure 100% of songs are extracted
      for (const [key, entity] of allPlaylistsMap.entries()) {
        const title = entity.title || 'SoundCloud Playlist';
        let rawTracks = entity.tracks || [];

        // If tracks array is empty or incomplete, try resolving via permalink_url
        if ((!rawTracks || rawTracks.length === 0) && entity.permalink_url) {
          try {
            const resolved = await httpGetJson(
              `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(entity.permalink_url)}&client_id=${clientId}`,
              authHeader
            );
            if (resolved && resolved.tracks) {
              rawTracks = resolved.tracks;
            }
          } catch (resErr) {
            console.warn('Playlist resolve fallback error:', resErr.message);
          }
        }

        // Hydrate all tracks (resolves missing IDs beyond the first 5)
        const hydratedTracks = await hydrateTracks(rawTracks, clientId, authHeader);

        parsedPlaylists.push({
          id: 'sc-pl-' + (entity.id || Math.random().toString(36).substring(2, 9)),
          name: title,
          sourceUrl: entity.permalink_url || '',
          tracks: hydratedTracks
        });
      }

      const totalSongsCount = parsedPlaylists.reduce((acc, p) => acc + p.tracks.length, 0);

      return {
        success: true,
        playlists: parsedPlaylists,
        totalTracks: totalSongsCount
      };
    } catch (err) {
      console.error('Fetch library error:', err);
      return { success: false, error: err.message };
    }
  });

  // ============================================================
  // Full-Depth SoundCloud Playlist & Track Resolver
  // ============================================================
  ipcMain.handle('extract-soundcloud-url', async (event, targetUrl) => {
    try {
      const clientId = await getSoundCloudClientId();
      const scSession = session.fromPartition('persist:soundglass-account');
      const cookies = await scSession.cookies.get({});
      const oauthCookie = cookies.find(c => c.name === 'oauth_token' && c.value);
      const authHeader = oauthCookie ? { 'Authorization': `OAuth ${oauthCookie.value}` } : {};

      const resolveUrl = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(targetUrl)}&client_id=${clientId}`;
      const resolved = await httpGetJson(resolveUrl, authHeader);

      if (!resolved) {
        throw new Error('Could not resolve SoundCloud URL');
      }

      // If it's a playlist / album / set
      if (resolved.kind === 'playlist' || resolved.tracks) {
        const playlistTitle = resolved.title || 'SoundCloud Playlist';
        const rawTracks = resolved.tracks || [];

        // Hydrate all tracks
        const fullTracks = await hydrateTracks(rawTracks, clientId, authHeader);

        return {
          success: true,
          isPlaylist: true,
          playlistTitle: playlistTitle,
          sourceUrl: resolved.permalink_url || targetUrl,
          tracks: fullTracks
        };
      }

      // Single track
      if (resolved.kind === 'track' || resolved.permalink_url) {
        return {
          success: true,
          isPlaylist: false,
          tracks: [formatTrackObject(resolved)]
        };
      }

      throw new Error('Unsupported SoundCloud entity');
    } catch (err) {
      console.error('SoundCloud API extract error:', err);
      return { success: false, error: err.message, tracks: [] };
    }
  });
}

// Hydrate track ID stubs into full track objects with metadata in exact playlist sequence
async function hydrateTracks(rawTracks, clientId, authHeader = {}) {
  if (!Array.isArray(rawTracks) || rawTracks.length === 0) return [];

  const trackMap = new Map();
  const missingIds = [];

  for (const t of rawTracks) {
    if (typeof t === 'number' || typeof t === 'string') {
      const numId = parseInt(t, 10);
      if (!isNaN(numId)) missingIds.push(numId);
    } else if (t && t.id) {
      if (t.title && t.permalink_url) {
        trackMap.set(t.id, formatTrackObject(t));
      } else {
        missingIds.push(t.id);
      }
    }
  }

  // Batch query all missing track IDs in chunks of 50
  if (missingIds.length > 0) {
    const chunkSize = 50;
    for (let i = 0; i < missingIds.length; i += chunkSize) {
      const chunk = missingIds.slice(i, i + chunkSize);
      const idsParam = chunk.join('%2C');
      try {
        const batchData = await httpGetJson(
          `https://api-v2.soundcloud.com/tracks?ids=${idsParam}&client_id=${clientId}`,
          authHeader
        );
        if (Array.isArray(batchData)) {
          for (const item of batchData) {
            if (item && item.id && item.permalink_url) {
              trackMap.set(item.id, formatTrackObject(item));
            }
          }
        }
      } catch (err) {
        console.warn('Batch track hydration error:', err.message);
      }
    }
  }

  // Reconstruct tracks preserving original playlist ordering
  const finalTracks = [];
  for (const t of rawTracks) {
    const id = (typeof t === 'object' && t !== null) ? t.id : parseInt(t, 10);
    if (trackMap.has(id)) {
      finalTracks.push(trackMap.get(id));
    }
  }

  return finalTracks;
}

function formatTrackObject(t) {
  let art = t.artwork_url;
  if (art) {
    art = art.replace('-large', '-t500x500');
  } else if (t.user && t.user.avatar_url) {
    art = t.user.avatar_url.replace('-large', '-t500x500');
  } else {
    art = 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&auto=format&fit=crop&q=80';
  }

  return {
    id: 'sc-' + t.id,
    title: t.title || 'SoundCloud Track',
    artist: (t.user && t.user.username) ? t.user.username : 'SoundCloud Artist',
    source: 'soundcloud',
    url: t.permalink_url,
    art: art,
    durationMs: t.duration || t.full_duration || 0
  };
}

function httpGetJson(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      ...extraHeaders
    };

    https.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpGetJson(res.headers.location, extraHeaders));
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

let cachedClientId = null;
let lastClientFetch = 0;

async function getSoundCloudClientId() {
  const now = Date.now();
  if (cachedClientId && (now - lastClientFetch < 3600000)) {
    return cachedClientId;
  }

  return new Promise((resolve) => {
    const defaultFallback = '3GKD969NJWD1eB6gvQJN0GnueYbcWszv';

    https.get('https://soundcloud.com', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, (res) => {
      let html = '';
      res.on('data', chunk => html += chunk);
      res.on('end', async () => {
        const scriptMatches = [...html.matchAll(/<script[^>]+src=["']([^"']+\.js)["']/gi)].map(m => m[1]);
        const assetScripts = scriptMatches.filter(s => s.includes('assets/'));

        for (const scriptUrl of assetScripts.slice(-4)) {
          try {
            const jsContent = await fetchScript(scriptUrl);
            const clientMatch = jsContent.match(/client_id[:=]\s*["']([a-zA-Z0-9]{32})["']/i);
            if (clientMatch && clientMatch[1]) {
              cachedClientId = clientMatch[1];
              lastClientFetch = now;
              return resolve(cachedClientId);
            }
          } catch(e) {}
        }

        resolve(defaultFallback);
      });
    }).on('error', () => resolve(defaultFallback));
  });
}

function fetchScript(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function registerMediaShortcuts() {
  try {
    globalShortcut.register('MediaPlayPause', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('media-key-toggle');
      }
    });

    globalShortcut.register('MediaNextTrack', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('media-key-next');
      }
    });

    globalShortcut.register('MediaPreviousTrack', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('media-key-prev');
      }
    });

    globalShortcut.register('MediaStop', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('media-key-stop');
      }
    });
  } catch (err) {
    console.warn('Could not register global media keys:', err.message);
  }
}

app.whenReady().then(() => {
  createWindow();
  registerMediaShortcuts();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
