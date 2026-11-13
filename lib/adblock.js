const fs = require('node:fs')
const path = require('node:path')
const { ipcMain } = require('electron')

// Ad and tracker blocking with Ghostery's engine (the same filter lists as
// uBlock Origin). The compiled lists are cached on disk so blocking starts
// instantly and works offline; they're refreshed every few days.
const REFRESH_AFTER = 3 * 24 * 60 * 60 * 1000
const COSMETIC_CHANNELS = ['@ghostery/adblocker/inject-cosmetic-filters', '@ghostery/adblocker/is-mutation-observer-enabled']

async function loadBlocker(dir) {
  const { ElectronBlocker } = require('@ghostery/adblocker-electron')
  const cache = path.join(dir, 'adblock-engine.bin')
  try {
    if (Date.now() - fs.statSync(cache).mtimeMs > REFRESH_AFTER) fs.rmSync(cache)
  } catch {}
  return ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
    path: cache,
    read: fs.promises.readFile,
    write: fs.promises.writeFile,
  })
}

// isOff(webContents) -> true when the page in that tab has ad blocking
// switched off. Requests and page clean-up for it are let through.
function allowSitesOff(blocker, isOff) {
  if (blocker.myarcWrapped) return
  blocker.myarcWrapped = true
  const { onBeforeRequest, onHeadersReceived, onInjectCosmeticFilters } = blocker
  blocker.onBeforeRequest = (details, callback) => (isOff(details.webContentsId) ? callback({}) : onBeforeRequest(details, callback))
  blocker.onHeadersReceived = (details, callback) => (isOff(details.webContentsId) ? callback({}) : onHeadersReceived(details, callback))
  blocker.onInjectCosmeticFilters = async (event, url, msg) => (isOff(event.sender.id) ? undefined : onInjectCosmeticFilters(event, url, msg))
}

// The library registers its page clean-up handlers globally each time it
// attaches to a session, which throws on the second session. Every space has
// its own session, so clear them first; the handlers are the same each time.
function enableIn(blocker, session) {
  for (const channel of COSMETIC_CHANNELS) ipcMain.removeHandler(channel)
  blocker.enableBlockingInSession(session)
}

module.exports = { loadBlocker, allowSitesOff, enableIn }
