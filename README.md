# Glass Art Music Player - Windows Desktop Application

A full-bleed, art-first desktop music player built with **Electron**, **Tailwind CSS**, and **Vanilla JavaScript**, featuring native window controls, PKCE Spotify OAuth authentication with Web Playback SDK streaming, and hidden embed sandboxing.

---

## What's New in this Refactor

1. **Art-First Layout**:
   - Giant square album art taking 60–70% of the upper window with smooth rounded corners, deep drop shadow, and a reactive blurred backdrop reflection.
   - Raw iframes and embed elements are completely sandboxed off-screen (`.hidden-embed-container`). You only see our custom UI.
2. **Exact Duration Tracking & Scrubbing**:
   - **SoundCloud**: Uses `scWidget.getDuration()` and `PLAY_PROGRESS` event to get exact milliseconds and position updates.
   - **Spotify**: Uses `player_state_changed` inside the Spotify Web Playback SDK.
   - **Interactive Timeline**: Scrub and seek smoothly to any point in the track.
3. **Spotify OAuth & Web Playback SDK**:
   - PKCE Authorization flow running directly inside an Electron child window via `main.js`.
   - Streams full high-fidelity tracks to the local device (`Glass Music Desktop`).
   - Settings modal for saving Client ID and Client Secret locally.
4. **Collapsible Queue**:
   - Compact overlay drawer that slides up from the bottom when requested.

---

## Setup & Running

1. **Install Node.js (if not already installed):**
   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```
   *(Restart PowerShell after installation).*

2. **Install project dependencies:**
   ```powershell
   npm install
   ```

3. **Start the app:**
   ```powershell
   npm start
   ```

4. **Compile the portable `.exe`:**
   ```powershell
   npm run dist
   ```

---

## Spotify OAuth Setup (For Full Streaming)
1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and click your app.
2. Click **Settings** (top right of the app page).
3. Under **Redirect URIs**, add this exact URI:
   ```text
   http://127.0.0.1:8888/callback
   ```
   *(Make sure to click **Add** and then scroll down to click **Save**).*
4. In the Music Player app, click the **Settings** gear (top right).
5. Paste your **Client ID**, ensure the Redirect URI matches `http://127.0.0.1:8888/callback`, and click **Save Credentials**.
6. Click **Connect Spotify** to log in.
