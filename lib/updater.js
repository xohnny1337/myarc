const { app } = require('electron')

// Auto-update from GitHub Releases (the latest-mac.yml + zip each release
// publishes). Only the packaged, signed app updates itself; `npm start` never
// does. Updates download in the background; the sidebar then offers a
// restart, and otherwise they install on the next quit.
const CHECK_EVERY = 4 * 60 * 60 * 1000

function startUpdater({ onReady, onStatus }) {
  if (!app.isPackaged) return { check: () => onStatus('Updates only work in the installed app'), install() {} }

  const { autoUpdater } = require('electron-updater')
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null

  let manual = false // a check the user asked for gets a reply either way
  autoUpdater.on('update-downloaded', (info) => onReady(info.version))
  autoUpdater.on('update-not-available', () => {
    if (manual) onStatus('MyArc is up to date')
    manual = false
  })
  autoUpdater.on('update-available', (info) => {
    if (manual) onStatus(`Downloading MyArc ${info.version}…`)
    manual = false
  })
  autoUpdater.on('error', () => {
    if (manual) onStatus('Couldn’t check for updates')
    manual = false
  })

  const check = (byUser = false) => {
    manual = byUser
    autoUpdater.checkForUpdates().catch(() => {})
  }
  check()
  setInterval(check, CHECK_EVERY).unref?.()

  return { check: () => check(true), install: () => autoUpdater.quitAndInstall() }
}

module.exports = { startUpdater }
