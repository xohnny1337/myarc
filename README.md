# MyArc

A minimal Chromium browser for macOS, Windows and Linux, built with Electron after Arc's sidebar. It has a favorites grid, nested bookmark folders, and spaces that keep work and personal accounts apart.

## Download

| Platform | Download |
| --- | --- |
| macOS (Apple Silicon) | [MyArc-mac-arm64.dmg](https://github.com/xohnny1337/myarc/releases/latest/download/MyArc-mac-arm64.dmg) |
| macOS (Intel) | [MyArc-mac-x64.dmg](https://github.com/xohnny1337/myarc/releases/latest/download/MyArc-mac-x64.dmg) |
| Windows | [MyArc-win.exe](https://github.com/xohnny1337/myarc/releases/latest/download/MyArc-win.exe) |
| Linux | [MyArc-linux.AppImage](https://github.com/xohnny1337/myarc/releases/latest/download/MyArc-linux.AppImage) |

These links always point to the newest build. Older versions are on the [Releases](https://github.com/xohnny1337/myarc/releases) page. The macOS app is signed and notarized by Apple.

## Features

- **Sidebar**: favorites as a grid of icons, bookmarks in folders you can nest, and your open tabs below. Drag to reorder, pin, or move items into folders. Drag the sidebar's edge to resize it.
- **Spaces**: each space is its own profile, with its own favorites, folders, tabs, history and sign-ins. You can be signed in to a work Google account in one space and a personal one in another. Switch spaces from the footer or by swiping sideways with two fingers over the sidebar.
- **Incognito**: <kbd>⇧⌘N</kbd> opens a temporary space with only tabs. It keeps no history and stores nothing on disk, and everything in it is gone once you leave it.
- **Command bar**: <kbd>⌘T</kbd> and <kbd>⌘L</kbd> open it. Type to search your open tabs, bookmarks and history, or enter an address or a search.
- **Developer Mode**: turned on per site from the site menu. It shows an address bar above the page that you can edit, and a button that opens Chrome's inspector docked next to the page.
- **Permissions**: sites have to ask before using your camera, microphone, location, notifications or clipboard. You can have your answer remembered per site, separately in each space.
- **Dark theme** throughout.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| <kbd>⌘T</kbd> | New tab (command bar) |
| <kbd>⌘L</kbd> | Edit the current address |
| <kbd>⌘W</kbd> | Close tab |
| <kbd>⇧⌘C</kbd> | Copy the current URL |
| <kbd>⇧⌘N</kbd> | New incognito space |
| <kbd>⌥⌘N</kbd> | New folder |
| <kbd>⌘D</kbd> / <kbd>⇧⌘D</kbd> | Pin tab / add tab to favorites |
| <kbd>⌘1</kbd>–<kbd>⌘9</kbd> | Open favorites 1–9 |
| <kbd>⌘[</kbd> / <kbd>⌘]</kbd> | Back / forward |
| <kbd>⌘R</kbd> | Reload |
| <kbd>⌥⌘I</kbd> | Inspector |
| <kbd>⌘S</kbd> / <kbd>⌘P</kbd> | Save page / print |

## Development

You need Node.js 22.

```bash
npm install
npm start
```

`npm run pack` builds an unsigned app for your machine into `dist/`.

| Path | Contents |
| --- | --- |
| `main.js` | Starts the app |
| `lib/browser.js` | Window, tabs, spaces, incognito, menus |
| `lib/store.js` | Bookmarks and spaces (`bookmarks.json`) |
| `lib/history.js` | Browsing history, one file per space |
| `lib/permissions.js` | Permission prompts |
| `lib/google-signin.js` | Workarounds that let Google sign-in work |
| `renderer/` | Sidebar and command bar UI |

Data lives in `~/Library/Application Support/MyArc` for the installed app, and in `myarc` when you run it with `npm start`.

## Releases

Every push to `main` runs [`.github/workflows/release.yml`](.github/workflows/release.yml). It builds macOS, Windows and Linux and publishes them as release `v1.0.<run number>`. To push without making a release, put `[skip ci]` in the commit message.

The macOS build is signed and notarized using these repository secrets:

| Secret | Contents |
| --- | --- |
| `MAC_CERT_P12_BASE64` | Developer ID Application certificate (.p12, base64) |
| `MAC_CERT_PASSWORD` | Password for the .p12 |
| `APPLE_API_KEY_P8` | App Store Connect API key (.p8) |
| `APPLE_API_KEY_ID` | That key's ID |
| `APPLE_API_ISSUER` | App Store Connect issuer ID |

Without these secrets, the macOS build still works. It's ad-hoc signed and not notarized, so macOS asks users to confirm the first time they open it.

## Known limitations

- **Passkeys don't work.** Electron has no passkey support, so on Google sign-in use your password and 2-step verification instead.
- **No Safe Browsing.** There are no warnings for phishing or malware sites.
- **Open tabs aren't restored** after quitting.
