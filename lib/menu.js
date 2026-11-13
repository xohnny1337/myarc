const { Menu, dialog } = require('electron')

async function confirmClearHistory(browser) {
  const { response } = await dialog.showMessageBox(browser.win, {
    type: 'warning',
    message: `Clear browsing history in “${browser.store.space.name}”?`,
    detail: 'Visited pages in this space will no longer show up in the command bar. Other spaces, bookmarks and open tabs are kept.',
    buttons: ['Clear History', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  })
  if (response === 0) browser.historyFor().clear()
}

function buildMenu(getBrowser, favorites = []) {
  const run = (fn) => () => {
    const browser = getBrowser()
    if (browser?.win) fn(browser)
  }

  return Menu.buildFromTemplate([
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: run((b) => b.showPalette(true)) },
        { label: 'Open Location', accelerator: 'CmdOrCtrl+L', click: run((b) => b.showPalette(false)) },
        { label: 'New Incognito Space', accelerator: 'Shift+CmdOrCtrl+N', click: run((b) => b.openIncognito()) },
        { label: 'Copy URL', accelerator: 'Shift+CmdOrCtrl+C', click: run((b) => b.copyUrl()) },
        { type: 'separator' },
        { label: 'Save Page As…', accelerator: 'CmdOrCtrl+S', click: run((b) => b.savePage()) },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: run((b) => b.printPage()) },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: run((b) => b.closeActive()) },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: run((b) => b.handle({ type: 'reload' })) },
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
      submenu: [{ label: 'Clear Browsing History…', click: run((b) => confirmClearHistory(b)) }],
    },
    { role: 'windowMenu' },
  ])
}

module.exports = { buildMenu }
