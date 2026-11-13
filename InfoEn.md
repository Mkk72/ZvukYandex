In short, this is an **Electron wrapper for the official web player**, lacking its own audio engine and any DRM-bypassing capabilities.

**1. Website Window**
The application opens `music.yandex.ru` or `zvuk.com` in a dedicated Chromium window with its own persistent profile. It uses the same player found in a standard web browser, meaning your subscription status, audio quality, and DRM protections remain exactly as they are on the original platform.

**2. Mini-Player**
A separate, frameless window—available either as a compact 48px-high strip or a wider 420×110px panel. It stays "always on top" without stealing focus and offers the following features:
- Displays album art, track title, artist, playback time, and progress;
- Allows for pausing, skipping tracks, and "liking" songs;
- Supports seeking via the progress bar and adjusting volume;
- Features an upward-expanding menu that doesn't shift the position of the panel itself.

**3. Controlling the Website**
There are three levels of control:
- **Primary:** An interceptor for `navigator.mediaSession` injected before the page's own scripts load. It captures the site's native handlers (`play`, `pause`, `nexttrack`, `previoustrack`) and triggers the **site's own code** directly, rather than simulating mouse clicks.
- **Fallback:** Clicks on the website's UI elements based on `aria-label` or DOM structure—used for actions like liking, disliking, managing the queue, toggling repeat, or adjusting audio settings.
- **Final Resort:** Synthetic keypresses.

**4. State Management**
The main process captures a snapshot of the page every 500ms—including metadata, `<audio>` element data, `positionState`, and "like" status. This data is compiled into a `PlayerState` object, which feeds a `BarViewModel`. The panel updates with every poll, ensuring that the playback time and progress bar remain fluid and accurate.

**5. Session**
The profile and cookies are stored in the application folder. Yandex Music also maintains a backup of its cookies: session cookies are saved every 15 seconds and upon application closure; they are then restored upon startup—**before the website loads**—otherwise, Yandex would prompt for a login after every restart.

**6. System Tray and Hotkeys**
The system tray menu mirrors the core commands and displays the "Artist — Track" information. Multimedia keys and `Ctrl+Alt+…` shortcuts remain functional even when the window is minimized.

**7. Decoupling Logic from UI**
`src/core` contains pure logic, independent of Electron—handling state, commands, menus, and formatting. `src/main` manages windows, the system tray, the bridge to the website, and the presenter. This architecture allows the core to be tested without requiring a windowed environment, while the UI layer remains "dumb"—simply rendering the provided data model.

**8. Anti-Bot Measures**
Both players identify themselves as a standard Chrome browser; they do not reload verification pages or overwhelm the site with automated clicks. For Sber, stream initialization is limited to two attempts; the same applies to Yandex, with the additional constraint that automatic stream playback is disabled by default.