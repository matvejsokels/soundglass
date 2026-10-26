const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  soundCloudLogin: () => ipcRenderer.invoke('soundcloud-account-login'),
  fetchUserLibrary: () => ipcRenderer.invoke('fetch-user-library'),
  extractSoundCloudUrl: (url) => ipcRenderer.invoke('extract-soundcloud-url', url),
  loadPlaylistsFile: () => ipcRenderer.invoke('load-playlists-file'),
  savePlaylistsFile: (data) => ipcRenderer.invoke('save-playlists-file', data),
  onMediaKeyNext: (cb) => ipcRenderer.on('media-key-next', (_event, ...args) => cb(...args)),
  onMediaKeyPrev: (cb) => ipcRenderer.on('media-key-prev', (_event, ...args) => cb(...args)),
  onMediaKeyToggle: (cb) => ipcRenderer.on('media-key-toggle', (_event, ...args) => cb(...args)),
  onMediaKeyStop: (cb) => ipcRenderer.on('media-key-stop', (_event, ...args) => cb(...args))
});
