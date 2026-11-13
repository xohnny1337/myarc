const { app, Menu, dialog } = require('electron')

async function confirmClearHistory(browser) {
  const { response } = await dialog.showMessageBox(browser.win, {
    type: 'warning',
    message: `Clear browsing history in “${browser.store.space.name}”?`,
    detail: 'Choose how far back. Cleared pages stop showing up in the command bar. Other spaces, bookmarks and open tabs are kept.',
    buttons: ['Last 24 Hours', 'Last 7 Days', 'All History', 'Cancel'],
    defaultId: 3,
    cancelId: 3,
  })
  const history = browser.historyFor()
  if (response === 0) {
    history.clearSince(Date.now() - 24 * 60 * 60 * 1000)
    browser.notify('Cleared the last 24 hours of history')
  } else if (response === 1) {
    history.clearSince(Date.now() - 7 * 24 * 60 * 60 * 1000)
    browser.notify('Cleared the last 7 days of history')
  } else if (response === 2) {
    history.clear()
    browser.notify('Cleared all history')
  }
}

function buildMenu(getBrowser, favorites = []) {
  const run = (fn) => () => {
    const browser = getBrowser()
    if (browser?.win) fn(browser)
  }

  return Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: run((b) => b.onCheckForUpdates?.()) },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: run((b) => b.showPalette(true)) },
        { label: 'Open Location', accelerator: 'CmdOrCtrl+L', click: run((b) => b.showPalette(false)) },
        { label: 'New Incognito Space', accelerator: 'Shift+CmdOrCtrl+N', click: run((b) => b.openIncognito()) },
        { label: 'Copy URL', accelerator: 'Shift+CmdOrCtrl+C', click: run((b) => b.copyUrl()) },
        { label: 'Import from Arc…', click: run((b) => b.importFromArc()) },
        { label: 'Save as PDF…', accelerator: 'CmdOrCtrl+P', click: run((b) => b.savePdf()) },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: run((b) => b.closeActive()) },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: run((b) => b.openFind()) },
        { label: 'Find Next', accelerator: 'CmdOrCtrl+G', click: run((b) => b.findStep(true)) },
        { label: 'Find Previous', accelerator: 'Shift+CmdOrCtrl+G', click: run((b) => b.findStep(false)) },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+S', click: run((b) => b.toggleSidebar()) },
        { type: 'separator' },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: run((b) => b.handle({ type: 'reload' })) },
        // Bypasses the cache, like Chrome's ⇧⌘R.
        { label: 'Hard Reload', accelerator: 'Shift+CmdOrCtrl+R', click: run((b) => b.handle({ type: 'hard-reload' })) },
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: run((b) => b.handle({ type: 'back' })) },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: run((b) => b.handle({ type: 'forward' })) },
        { type: 'separator' },
        {
          label: 'Developer Tools',
          accelerator: 'Alt+CmdOrCtrl+I',
          click: run((b) => b.toggleInspector()),
        },
        {
          label: 'Sidebar Developer Tools',
          accelerator: 'Alt+Shift+CmdOrCtrl+I',
          click: run((b) => b.win.webContents.toggleDevTools({ mode: 'detach' })),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Bookmarks',
      submenu: [
        { label: 'Pin Tab', accelerator: 'CmdOrCtrl+D', click: run((b) => b.pinActive({ zone: 'pinned' })) },
        { label: 'Add Tab to Favorites', accelerator: 'Shift+CmdOrCtrl+D', click: run((b) => b.pinActive({ zone: 'favorites' })) },
        { label: 'New Folder', accelerator: 'Alt+CmdOrCtrl+N', click: run((b) => b.newFolder(null)) },
        // Your first nine favorites by name, on ⌘1–⌘9.
        ...(favorites.length ? [{ type: 'separator' }] : []),
        ...favorites.slice(0, 9).map((fav, i) => ({
          label: fav.title || fav.url,
          accelerator: `CmdOrCtrl+${i + 1}`,
          click: run((b) => b.openFavorite(i)),
        })),
      ],
    },
    {
      label: 'History',
      submenu: [
        { label: 'Clear Browsing History…', click: run((b) => confirmClearHistory(b)) },
        { label: 'Clear Browsing Data…', accelerator: 'Shift+CmdOrCtrl+Backspace', click: run((b) => b.clearBrowsingData()) },
      ],
    },
    { role: 'windowMenu' },
  ])
}

module.exports = { buildMenu }
