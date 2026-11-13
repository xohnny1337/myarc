const path = require('node:path')
const { app, ipcMain, Menu, nativeTheme } = require('electron')
const { Store } = require('./lib/store')
const { Browser } = require('./lib/browser')
const { Histories } = require('./lib/history')
const { buildMenu } = require('./lib/menu')

// Present as plain Chrome: some sites (notably Google sign-in) refuse browsers
// whose user agent mentions Electron or an unknown app name.
app.userAgentFallback = app.userAgentFallback
  .replace(/\sElectron\/\S+/, '')
  .replace(new RegExp(`\\s${app.getName()}/\\S+`), '')

let store = null
let histories = null
let browser = null

const refreshMenu = () => Menu.setApplicationMenu(buildMenu(() => browser, store.space.favorites))

const createBrowser = () => {
  browser = new Browser(store, histories)
  browser.onFavoritesChange = refreshMenu
  browser.win.on('closed', () => {
    browser = null
  })
}

ipcMain.on('action', (event, action) => {
  if (!browser?.win) return
  if (event.sender !== browser.win.webContents && event.sender !== browser.palette.webContents) return
  if (action && typeof action.type === 'string') browser.handle(action)
})

app.whenReady().then(() => {
  // Dark menus and dialogs, and sites with a dark mode use it.
  nativeTheme.themeSource = 'dark'
  store = new Store(path.join(app.getPath('userData'), 'bookmarks.json'))
  histories = new Histories(app.getPath('userData'))
  refreshMenu()
  createBrowser()

  app.on('activate', () => {
    if (!browser) createBrowser()
  })
})

// History writes are batched; flush the last ones before quitting.
app.on('will-quit', () => histories?.saveAll())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
