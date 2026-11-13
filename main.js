const path = require('node:path')
const { pathToFileURL } = require('node:url')
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

// Links and HTML files macOS hands us (as the default browser, from Slack or
// Mail, or "Open With"). They can arrive before the app is ready or while no
// window is open, so they wait here until a window can take them.
const pendingOpens = []

function openFromOS(url) {
  if (browser?.win) return browser.openFromOS(url)
  pendingOpens.push(url)
  if (app.isReady() && store) createBrowser()
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  openFromOS(url)
})

app.on('open-file', (event, file) => {
  event.preventDefault()
  openFromOS(pathToFileURL(file).href)
})

const createBrowser = () => {
  browser = new Browser(store, histories)
  browser.onFavoritesChange = refreshMenu
  browser.onInstallUpdate = () => updater?.install()
  browser.onCheckForUpdates = () => updater?.check()
  browser.setUpdateReady(updateReady)
  if (blocker) browser.setBlocker(blocker)
  for (const url of pendingOpens.splice(0)) browser.openFromOS(url)
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
