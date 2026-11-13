const path = require('node:path')
const { app, ipcMain, Menu, nativeTheme } = require('electron')
const { Store } = require('./lib/store')
const { Browser } = require('./lib/browser')
const { Histories } = require('./lib/history')
const { buildMenu } = require('./lib/menu')
const { startUpdater } = require('./lib/updater')
const { loadBlocker } = require('./lib/adblock')

// Present as plain Chrome: some sites (notably Google sign-in) refuse browsers
// whose user agent mentions Electron or an unknown app name.
app.userAgentFallback = app.userAgentFallback
  .replace(/\sElectron\/\S+/, '')
  .replace(new RegExp(`\\s${app.getName()}/\\S+`), '')

let store = null
let histories = null
let browser = null
let updater = null
let updateReady = null // version downloaded and waiting for a restart
let blocker = null // ad blocker, once its lists have loaded

const refreshMenu = () => Menu.setApplicationMenu(buildMenu(() => browser, store.space.favorites))

const createBrowser = () => {
  browser = new Browser(store, histories)
  browser.onFavoritesChange = refreshMenu
  browser.onInstallUpdate = () => updater?.install()
  browser.onCheckForUpdates = () => updater?.check()
  browser.setUpdateReady(updateReady)
  if (blocker) browser.setBlocker(blocker)
  browser.win.on('closed', () => {
    browser = null
  })
}

ipcMain.on('action', (event, action) => {
  if (!browser?.win) return
  if (!browser.isUiSender(event.sender)) return
  if (action && typeof action.type === 'string') browser.handle(action)
})

app.whenReady().then(() => {
  // Packaged builds get the icon from build/icon.icns; show it in the Dock
  // when running from source (npm start) too.
  if (process.platform === 'darwin' && !app.isPackaged) app.dock.setIcon(path.join(__dirname, 'build', 'icon.png'))
  // Dark menus and dialogs, and sites with a dark mode use it.
  nativeTheme.themeSource = 'dark'
  store = new Store(path.join(app.getPath('userData'), 'bookmarks.json'))
  histories = new Histories(app.getPath('userData'))
  refreshMenu()
  createBrowser()
  loadBlocker(app.getPath('userData'))
    .then((loaded) => {
      blocker = loaded
      browser?.setBlocker(loaded)
    })
    .catch(() => {}) // no lists and no network: browse without blocking
  updater = startUpdater({
    onReady: (version) => {
      updateReady = version
      browser?.setUpdateReady(version)
    },
    onStatus: (text) => browser?.notify(text),
  })

  app.on('activate', () => {
    if (!browser) createBrowser()
  })
})

// Open tabs and history are saved in batches; write the last of both.
app.on('before-quit', () => browser?.saveSession())
app.on('will-quit', () => histories?.saveAll())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
