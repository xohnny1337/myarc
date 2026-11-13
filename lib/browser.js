const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { app, BrowserWindow, WebContentsView, Menu, clipboard, dialog, session } = require('electron')
const { bookmark, folder, bookmarkIds } = require('./store')
const { followSigninUserAgent, installSigninHeaders } = require('./google-signin')
const { historyKey } = require('./history')
const { Permissions } = require('./permissions')
const { readArcSidebar } = require('./arc-import')
const { allowSitesOff, enableIn } = require('./adblock')

const SIDEBAR_WIDTH = { min: 200, default: 260, max: 480 }
const GAP = 8
const DEV_BAR = 40 // Developer Mode's address bar above the page (drawn by the sidebar page)
const SEARCH_URL = 'https://www.google.com/search?q='

function toURL(input) {
  const text = String(input ?? '').trim()
  if (!text) return null
  if (/\s/.test(text)) return SEARCH_URL + encodeURIComponent(text)
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(text) || /^(about|data|file|view-source):/i.test(text)) return text
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(text)) return `http://${text}`
  if (/^[^/]+\.[a-z]{2,}(:\d+)?(\/|$)/i.test(text) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(text)) {
    return `https://${text}`
  }
  return SEARCH_URL + encodeURIComponent(text)
}

function hostOf(url) {
  try {
    const u = new URL(url)
    return /^https?:$/.test(u.protocol) ? u.hostname : null
  } catch {
    return null
  }
}

function sameSite(a, b) {
  try {
    const host = (u) => new URL(u).hostname.replace(/^www\./, '')
    return host(a) === host(b)
  } catch {
    return false
  }
}

function clampSidebar(width) {
  const n = width == null ? NaN : Math.round(Number(width))
  return Number.isFinite(n) ? Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, n)) : SIDEBAR_WIDTH.default
}

function toTarget(t = {}) {
  const id = (v) => (typeof v === 'string' && v ? v : null)
  return { zone: t.zone === 'favorites' ? 'favorites' : 'pinned', parentId: id(t.parentId), beforeId: id(t.beforeId) }
}

// Incognito keeps no history.
const NO_HISTORY = { visit() {}, update() {}, ranked: () => [], clear() {} }

class Browser {
  constructor(store, histories) {
    this.store = store
    this.histories = histories
    this.tabs = new Map() // tabId -> { id, view, bookmarkId, url, title, favicon, loading }
    this.looseTabs = [] // ids of tabs not attached to a bookmark, in sidebar order
    this.recent = [] // activation history, most recent last
    this.activeId = null
    this.sidebarWidth = clampSidebar(store.data.sidebarWidth)

    this.win = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 720,
      minHeight: 420,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 16 },
      backgroundColor: '#000000',
      webPreferences: { preload: path.join(__dirname, '..', 'preload.js') },
    })
    this.win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
    // The sidebar can drive the whole browser, so it may only ever show its
    // own page. A link dropped on it opens as a tab instead.
    this.lockDown(this.win.webContents, (url) => this.createTab(url))
    for (const event of ['resize', 'enter-full-screen', 'leave-full-screen']) this.win.on(event, () => this.layout())
    this.sidebarReady = false
    this.win.webContents.on('did-finish-load', () => {
      this.sidebarReady = true
      this.emit()
    })

    // Command bar (⌘T / ⌘L): a transparent layer above every tab.
    this.paletteOpen = false
    this.palette = new WebContentsView({ webPreferences: { preload: path.join(__dirname, '..', 'preload.js') } })
    this.palette.setBackgroundColor('#00000000')
    this.palette.setVisible(false)
    this.paletteReady = new Promise((resolve) => this.palette.webContents.once('did-finish-load', resolve))
    this.palette.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'palette.html'))
    this.lockDown(this.palette.webContents)

    // Sites must ask for camera, microphone, location, notifications…
    this.permissions = new Permissions({
      store: this.store,
      getWindow: () => this.win,
      isTab: (wc) => wc !== this.win?.webContents && wc !== this.palette?.webContents,
    })
    for (const space of this.store.data.spaces) this.sessionFor(space)
    this.restoreSession()
    this.win.contentView.addChildView(this.palette)

    // Save open tabs while they still exist.
    this.win.on('close', () => this.saveSession())
    this.win.on('closed', () => {
      this.palette.webContents.close()
      for (const view of [this.findView, this.importView]) {
        if (view && !view.webContents.isDestroyed()) view.webContents.close()
      }
      for (const tab of this.tabs.values()) {
        if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
      }
      this.tabs.clear()
      this.win = null
    })
  }

  // ---- tabs -------------------------------------------------------------

  active() {
    return this.tabs.get(this.activeId) ?? null
  }

  tabForBookmark(bookmarkId) {
    for (const tab of this.tabs.values()) if (tab.bookmarkId === bookmarkId) return tab
    return null
  }

  // Keep a browser-UI page (sidebar, command bar) on its own file: no
  // navigating away, no popups, no embedded pages.
  lockDown(wc, onLink) {
    wc.on('will-navigate', (e, url) => {
      e.preventDefault()
      if (onLink && /^https?:\/\//i.test(url)) onLink(url)
    })
    wc.on('will-redirect', (e) => e.preventDefault())
    wc.on('will-attach-webview', (e) => e.preventDefault())
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  }

  // Each space has its own session (cookies, sign-ins, storage).
  sessionFor(space) {
    const ses = space?.partition ? session.fromPartition(space.partition) : session.defaultSession
    this.sessions ??= new Set()
    if (!this.sessions.has(ses)) {
      this.sessions.add(ses)
      installSigninHeaders(ses, app.userAgentFallback)
      this.permissions.install(ses, space.id)
      if (this.blocker) enableIn(this.blocker, ses)
    }
    return ses
  }

  // restore: { title, favicon } for a tab brought back from the last session;
  // it isn't loaded until you open it.
  createTab(url, { bookmarkId = null, activate = true, space = this.store.space, restore = null } = {}) {
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        session: this.sessionFor(space),
        preload: path.join(__dirname, '..', 'tab-preload.js'),
      },
    })
    view.setBorderRadius(GAP)
    view.setBackgroundColor('#ffffff')
    view.setVisible(false)
    const tab = { id: view.webContents.id, spaceId: space.id, view, bookmarkId, url, title: '', favicon: null, loading: true }
    if (restore) Object.assign(tab, { title: restore.title || '', favicon: restore.favicon || null, loading: false, pendingUrl: url })
    this.tabs.set(tab.id, tab)
    if (!bookmarkId) this.looseTabs.unshift(tab.id)
    this.wire(tab)
    this.win.contentView.addChildView(view)
    // Keep the find bar and command bar above pages.
    if (this.findOpen) this.win.contentView.addChildView(this.findView)
    if (this.paletteOpen) this.win.contentView.addChildView(this.palette)
    if (!restore) view.webContents.loadURL(url).catch(() => {})
    if (activate) this.activate(tab.id)
    else this.emit()
    return tab
  }

  wire(tab) {
    const wc = tab.view.webContents
    const refresh = () => this.emit()
    followSigninUserAgent(wc, app.userAgentFallback)
    wc.on('page-title-updated', (_e, title) => {
      tab.title = title
      this.historyFor(tab).update(tab.url, { title })
      refresh()
    })
    wc.on('page-favicon-updated', (_e, favicons) => {
      tab.favicon = favicons[0] ?? null
      if (tab.favicon) this.historyFor(tab).update(tab.url, { favicon: tab.favicon })
      const node = tab.bookmarkId && this.store.get(tab.bookmarkId)
      if (node && tab.favicon && node.favicon !== tab.favicon && sameSite(tab.url, node.url)) {
        node.favicon = tab.favicon
        this.store.save()
      }
      refresh()
    })
    wc.on('did-navigate', (_e, url) => {
      tab.url = url
      this.historyFor(tab).visit(url) // title arrives later via page-title-updated
      if (tab.id === this.activeId) this.layout() // the Developer Mode bar may come or go
      refresh()
    })
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame || url === tab.url) return
      tab.url = url
      this.historyFor(tab).visit(url, wc.getTitle())
      refresh()
    })
    wc.on('context-menu', (_e, params) => this.pageMenu(tab, params))
    wc.on('found-in-page', (_e, result) => {
      if (!this.findOpen || this.findTabId !== tab.id || !result.finalUpdate) return
      this.findView.webContents.send('command', { type: 'find-result', active: result.activeMatchOrdinal, matches: result.matches })
    })
    // Chrome's docked inspector lives inside the page view; keep the
    // Developer Mode bar's button in sync however it's opened or closed.
    wc.on('devtools-opened', refresh)
    wc.on('devtools-closed', refresh)
    wc.on('did-start-loading', () => {
      tab.loading = true
      refresh()
    })
    wc.on('did-stop-loading', () => {
      tab.loading = false
      refresh()
    })
    wc.setWindowOpenHandler(({ url, disposition }) => {
      // Real popups (OAuth sign-in etc.) need window.opener, so let them open as windows.
      if (disposition === 'new-window') return { action: 'allow' }
      this.createTab(url, { activate: disposition !== 'background-tab' })
      return { action: 'deny' }
    })
  }

  activate(id) {
    const next = this.tabs.get(id)
    if (!next) return
    if (next.spaceId !== this.store.space.id) {
      this.discardIncognitoOnLeave()
      this.store.data.activeSpaceId = next.spaceId
      this.store.save()
    }
    const prev = this.active()
    if (prev && prev !== next) {
      prev.view.setVisible(false)
    }
    this.activeId = id
    this.recent = this.recent.filter((x) => x !== id).concat(id)
    if (next.pendingUrl) {
      // A restored tab loads the first time it's opened.
      next.loading = true
      next.view.webContents.loadURL(next.pendingUrl).catch(() => {})
      next.pendingUrl = null
    }
    this.layout()
    next.view.setVisible(true)
    next.view.webContents.focus()
    this.emit()
  }

  layout() {
    if (!this.win) return
    const [width, height] = this.win.getContentSize()
    if (this.paletteOpen) this.palette.setBounds({ x: 0, y: 0, width, height })
    if (this.importOpen) this.importView.setBounds({ x: 0, y: 0, width, height })
    const tab = this.active()
    if (this.findOpen && tab?.id !== this.findTabId) this.closeFind({ focusPage: false })
    if (!tab) return
    const top = this.isDevSite(tab.url) ? DEV_BAR : GAP
    const left = this.sidebarHidden ? GAP : this.sidebarWidth
    const page = {
      x: left,
      y: top,
      width: Math.max(0, width - left - GAP),
      height: Math.max(0, height - top - GAP),
    }
    tab.view.setBounds(page)
    // The find bar floats over the page's top-right corner.
    if (this.findOpen) {
      const barWidth = Math.min(380, Math.max(0, page.width - 24))
      this.findView.setBounds({ x: page.x + page.width - barWidth - 12, y: page.y + 10, width: barWidth, height: 50 })
    }
  }

  // ---- find in page -------------------------------------------------------

  // ⌘F: a find bar over the current page (Electron has none built in).
  async openFind() {
    const tab = this.active()
    if (!tab || !this.win) return
    if (!this.findView) {
      this.findView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, '..', 'preload.js') } })
      this.findView.setBackgroundColor('#00000000')
      this.findView.setVisible(false)
      this.findReady = new Promise((resolve) => this.findView.webContents.once('did-finish-load', resolve))
      this.findView.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'find.html'))
      this.lockDown(this.findView.webContents)
      this.win.contentView.addChildView(this.findView)
    }
    await this.findReady
    if (!this.win || this.active() !== tab) return
    this.findOpen = true
    this.findTabId = tab.id
    this.layout()
    this.win.contentView.addChildView(this.findView) // on top of the page
    if (this.paletteOpen) this.win.contentView.addChildView(this.palette)
    this.findView.setVisible(true)
    this.findView.webContents.focus()
    this.findView.webContents.send('command', { type: 'find-open', text: this.findText ?? '' })
  }

  closeFind({ focusPage = true } = {}) {
    if (!this.findOpen) return
    this.findOpen = false
    this.findView.setVisible(false)
    const tab = this.tabs.get(this.findTabId)
    this.findTabId = null
    if (!tab || tab.view.webContents.isDestroyed()) return
    tab.view.webContents.stopFindInPage('clearSelection')
    if (focusPage && tab.id === this.activeId) tab.view.webContents.focus()
  }

  find(text, forward = true, findNext = false) {
    const tab = this.tabs.get(this.findTabId)
    if (!tab) return
    this.findText = String(text ?? '')
    const wc = tab.view.webContents
    if (!this.findText) {
      wc.stopFindInPage('clearSelection')
      this.findView.webContents.send('command', { type: 'find-result', active: 0, matches: 0 })
      return
    }
    wc.findInPage(this.findText, { forward, findNext })
  }

  // ⌘G / ⇧⌘G: next or previous match; opens the bar with the last search
  // if it's closed.
  findStep(forward) {
    if (!this.findOpen) return this.openFind()
    this.findView.webContents.send('command', { type: 'find-step', forward })
  }

  // ⌘S: hide the sidebar entirely so the page fills the window, or bring it
  // back. The window buttons hide with it, since they'd sit on the page.
  toggleSidebar() {
    this.sidebarHidden = !this.sidebarHidden
    this.win?.setWindowButtonVisibility(!this.sidebarHidden)
    this.layout()
    this.emit()
  }

  // ---- ad blocking ------------------------------------------------------

  // Called once the block lists have loaded: blocks in every space's session
  // (and any made later), except on sites where it's switched off.
  setBlocker(blocker) {
    if (!blocker || this.blocker) return
    this.blocker = blocker
    allowSitesOff(blocker, (webContentsId) => {
      const tab = this.tabs.get(webContentsId)
      return !!tab && this.isAdblockOff(tab.url)
    })
    for (const ses of this.sessions ?? []) enableIn(blocker, ses)
    this.emit()
  }

  isAdblockOff(url) {
    const host = hostOf(url)
    return !!host && (this.store.data.adblockOff ?? []).includes(host)
  }

  // Site menu: switch ad blocking off (or back on) for the current site, in
  // every space, and reload so it takes effect.
  toggleAdblock() {
    const tab = this.active()
    const host = hostOf(tab?.url)
    if (!host) return
    const off = new Set(this.store.data.adblockOff ?? [])
    if (off.has(host)) off.delete(host)
    else off.add(host)
    this.store.data.adblockOff = [...off]
    this.store.save()
    tab.view.webContents.reload()
    this.emit()
  }

  // ---- developer mode ---------------------------------------------------

  isDevSite(url) {
    const host = hostOf(url)
    return !!host && (this.store.data.devSites ?? []).includes(host)
  }

  toggleDevMode() {
    const host = hostOf(this.active()?.url)
    if (!host) return
    const sites = new Set(this.store.data.devSites ?? [])
    if (sites.has(host)) sites.delete(host)
    else sites.add(host)
    this.store.data.devSites = [...sites]
    this.store.save()
    // Turning Developer Mode off removes the inspector button, so close those inspectors.
    if (!sites.has(host)) {
      for (const tab of this.tabs.values()) {
        if (hostOf(tab.url) === host) tab.view.webContents.closeDevTools()
      }
    }
    this.layout()
    this.emit()
  }

  // Chrome's own inspector, docked inside the page view like Arc and Chrome
  // (the button in the Developer Mode bar, ⌥⌘I, or right-click > Inspect).
  toggleInspector() {
    const wc = this.active()?.view.webContents
    if (!wc) return
    if (wc.isDevToolsOpened()) wc.closeDevTools()
    else wc.openDevTools({ mode: 'right' })
  }

  closeTab(id) {
    const tab = this.tabs.get(id)
    if (!tab) return
    if (this.findTabId === id) this.closeFind({ focusPage: false })
    this.tabs.delete(id)
    this.looseTabs = this.looseTabs.filter((x) => x !== id)
    this.recent = this.recent.filter((x) => x !== id)
    this.win.contentView.removeChildView(tab.view)
    tab.view.webContents.close()
    if (this.activeId === id) {
      this.activeId = null
      const fallback = this.lastTabIn(tab.spaceId)
      if (fallback) return this.activate(fallback)
    }
    this.emit()
  }

  closeActive() {
    if (this.activeId != null) this.closeTab(this.activeId)
  }

  placeLoose(id, beforeId) {
    const at = beforeId != null ? this.looseTabs.indexOf(beforeId) : -1
    this.looseTabs.splice(at === -1 ? this.looseTabs.length : at, 0, id)
  }

  moveTab(id, beforeId) {
    if (this.looseTabs.includes(id) && id !== beforeId) {
      this.looseTabs = this.looseTabs.filter((x) => x !== id)
      this.placeLoose(id, beforeId)
    }
    this.emit()
  }

  open(input, newTab) {
    const url = toURL(input)
    if (!url) return
    const tab = this.active()
    if (tab && !newTab) {
      tab.view.webContents.loadURL(url).catch(() => {})
      tab.view.webContents.focus()
    } else {
      this.createTab(url)
    }
  }

  // ---- spaces -----------------------------------------------------------

  // A tab's space's history, or the current space's.
  historyFor(tab) {
    const space = (tab && this.store.spaceById(tab.spaceId)) || this.store.space
    return space.incognito ? NO_HISTORY : this.histories.for(space)
  }

  // ---- incognito ----------------------------------------------------------

  // ⇧⌘N: a temporary space with its own in-memory session (nothing written
  // to disk) and no history, favorites or folders. It goes away, with its
  // tabs, cookies and site data, as soon as you leave it, close it, or quit.
  openIncognito() {
    if (!this.store.temporary) {
      const id = `incognito-${randomUUID()}`
      // No "persist:" prefix = Chromium keeps this session in memory only.
      this.store.temporary = { id, name: 'Incognito', incognito: true, partition: id, favorites: [], pinned: [] }
    }
    const incognito = this.store.temporary
    if (this.store.space.id !== incognito.id) {
      this.store.returnSpaceId = this.store.space.id
      this.switchSpace(incognito.id)
    }
    this.showPalette(true)
  }

  closeIncognito() {
    const incognito = this.store.temporary
    if (!incognito) return
    const wasActive = this.store.space.id === incognito.id
    for (const tab of [...this.tabs.values()]) {
      if (tab.spaceId === incognito.id) this.closeTab(tab.id)
    }
    if (wasActive) this.switchSpace(this.store.returnSpaceId ?? this.store.data.spaces[0].id)
    this.store.temporary = null
    this.store.returnSpaceId = null
    if (this.store.data.activeSpaceId === incognito.id) this.store.data.activeSpaceId = this.store.space.id
    this.store.save()
    const ses = session.fromPartition(incognito.partition)
    ses.clearStorageData().catch(() => {})
    ses.clearCache().catch(() => {})
    this.sessions?.delete(ses)
    this.emit()
  }

  // Leaving incognito discards it, open tabs and all.
  discardIncognitoOnLeave() {
    const leaving = this.store.space
    if (!leaving.incognito) return
    queueMicrotask(() => {
      if (this.store.temporary?.id === leaving.id && this.store.space.id !== leaving.id) this.closeIncognito()
    })
  }

  // Pinning, favorites and folders don't exist in incognito.
  inIncognito() {
    return !!this.store.space.incognito
  }

  spaceLooseTabs(spaceId = this.store.space.id) {
    return this.looseTabs.filter((id) => this.tabs.get(id)?.spaceId === spaceId)
  }

  lastTabIn(spaceId) {
    return [...this.recent].reverse().find((id) => this.tabs.get(id)?.spaceId === spaceId) ?? null
  }

  switchSpace(id) {
    if (!this.store.spaceById(id) || id === this.store.space.id) return
    this.discardIncognitoOnLeave()
    this.hidePalette()
    this.active()?.view.setVisible(false)
    this.activeId = null
    this.store.data.activeSpaceId = id
    this.store.save()
    const last = this.lastTabIn(id)
    if (last) return this.activate(last)
    this.layout()
    this.emit()
  }

  // File › Import from Arc…: each Arc space becomes a new space here, with
  // its favorites, folders and pinned tabs.
  async importFromArc() {
    if (!this.win) return
    let spaces
    try {
      spaces = readArcSidebar()
    } catch {
      await dialog.showMessageBox(this.win, { type: 'warning', message: 'Couldn’t read Arc’s sidebar', detail: 'The file exists but isn’t in a format MyArc understands.' })
      return
    }
    if (!spaces?.length) {
      await dialog.showMessageBox(this.win, { type: 'info', message: 'Nothing to import from Arc', detail: 'Arc doesn’t seem to be installed on this Mac, or it has no spaces.' })
      return
    }
    this.arcSpaces = spaces
    if (!this.importView) {
      this.importView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, '..', 'preload.js') } })
      this.importView.setBackgroundColor('#00000000')
      this.importView.setVisible(false)
      this.importReady = new Promise((resolve) => this.importView.webContents.once('did-finish-load', resolve))
      this.importView.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'import.html'))
      this.lockDown(this.importView.webContents)
      this.win.contentView.addChildView(this.importView)
    }
    await this.importReady
    if (!this.win) return
    this.hidePalette()
    this.importOpen = true
    this.emit() // the sidebar drops its window-drag areas while this is open
    this.layout()
    this.win.contentView.addChildView(this.importView) // on top of everything
    this.importView.setVisible(true)
    this.importView.webContents.focus()
    this.importView.webContents.send('command', {
      type: 'arc-import-open',
      spaces: spaces.map((s, index) => ({ index, name: s.name, favorites: s.favorites, pinned: s.pinned })),
    })
  }

  closeArcImport() {
    if (!this.importOpen) return
    this.importOpen = false
    this.arcSpaces = null
    this.importView.setVisible(false)
    this.active()?.view.webContents.focus()
    this.emit()
  }

  // selected: [{ index, excluded: [ids of unticked tabs and empty folders] }]
  runArcImport(selected) {
    const source = this.arcSpaces
    if (!source || !Array.isArray(selected)) return
    // Drop unticked tabs; keep a folder if anything inside survived (or it
    // was an empty folder that stayed ticked).
    const prune = (nodes, out) =>
      nodes.flatMap((node) => {
        if (node.type !== 'folder') return out.has(node.id) ? [] : [node]
        const children = prune(node.children, out)
        const keep = children.length > 0 || (node.children.length === 0 && !out.has(node.id))
        return keep ? [{ ...node, children }] : []
      })
    const created = []
    for (const pick of selected) {
      const arc = source[pick?.index]
      if (!arc) continue
      const out = new Set(Array.isArray(pick.excluded) ? pick.excluded : [])
      const space = this.store.addSpace(arc.name)
      space.favorites = arc.favorites.filter((f) => !out.has(f.id))
      space.pinned = prune(arc.pinned, out)
      created.push(space)
    }
    this.store.save()
    this.closeArcImport()
    if (!created.length) return
    this.switchSpace(created[0].id)
    this.notify(`Imported ${created.length} ${created.length === 1 ? 'space' : 'spaces'} from Arc`)
  }

  // ---- clearing browsing data (per space) -------------------------------

  // History › Clear Browsing Data…: cookies and site data, the cache, or
  // everything (which also clears the space's history). Other spaces keep
  // their sign-ins.
  async clearBrowsingData() {
    if (!this.win) return
    const space = this.store.space
    const { response } = await dialog.showMessageBox(this.win, {
      type: 'warning',
      message: `Clear browsing data in “${space.name}”?`,
      detail: 'Clearing cookies and site data signs you out of websites in this space. Other spaces aren’t affected. This can’t be undone.',
      buttons: ['Clear Everything', 'Cookies and Site Data', 'Cached Images and Files', 'Cancel'],
      defaultId: 3,
      cancelId: 3,
    })
    if (response === 3) return
    const ses = this.sessionFor(space)
    try {
      if (response === 0 || response === 1) await ses.clearStorageData()
      if (response === 0 || response === 2) await ses.clearCache()
      if (response === 0) this.historyFor().clear()
    } catch {
      return this.notify('Couldn’t clear browsing data')
    }
    this.notify(['Cleared all browsing data', 'Cleared cookies and site data', 'Cleared cached files'][response])
  }

  // Site menu: sign out of just this site (its cookies, including on its
  // subdomains, and its storage) and reload it.
  async clearSiteData(tab = this.active()) {
    const host = hostOf(tab?.url)
    if (!host) return
    const ses = tab.view.webContents.session
    const site = host.replace(/^www\./, '')
    try {
      await ses.clearStorageData({ origin: new URL(tab.url).origin })
      const cookies = await ses.cookies.get({})
      await Promise.all(
        cookies
          .filter((c) => {
            const domain = (c.domain || '').replace(/^\./, '')
            return domain === site || domain.endsWith(`.${site}`) || site.endsWith(`.${domain}`)
          })
          .map((c) => {
            const domain = (c.domain || '').replace(/^\./, '')
            return ses.cookies.remove(`${c.secure ? 'https' : 'http'}://${domain}${c.path || '/'}`, c.name)
          }),
      )
    } catch {
      return this.notify('Couldn’t clear site data')
    }
    tab.view.webContents.reload()
    this.notify(`Cleared data for ${site}`)
  }

  newSpace() {
    const created = this.store.addSpace(`Space ${this.store.data.spaces.length + 1}`)
    this.store.save()
    this.switchSpace(created.id)
    this.command({ type: 'rename-space', id: created.id })
  }

  renameSpace(id, name) {
    const space = this.store.spaceById(id)
    const value = String(name ?? '').trim()
    if (!space || !value) return
    space.name = value
    this.store.save()
    this.emit()
  }

  // Removes the space's bookmarks, tabs and sign-ins, after asking.
  async deleteSpace(id) {
    const space = this.store.spaceById(id)
    if (!space || this.store.data.spaces.length <= 1) return
    const { response } = await dialog.showMessageBox(this.win, {
      type: 'warning',
      message: `Delete “${space.name}”?`,
      detail: 'Its favorites, folders and open tabs are removed, and you are signed out of every site in it. This can’t be undone.',
      buttons: ['Delete Space', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    })
    if (response !== 0) return
    for (const tab of [...this.tabs.values()]) {
      if (tab.spaceId === id) this.closeTab(tab.id)
    }
    const wasActive = this.store.space.id === id
    this.store.removeSpace(id)
    this.store.save()
    if (space.partition) session.fromPartition(space.partition).clearStorageData().catch(() => {})
    this.histories.forget(space)
    if (wasActive) {
      this.activeId = null
      const last = this.lastTabIn(this.store.space.id)
      if (last) return this.activate(last)
      this.layout()
    }
    this.emit()
  }

  // ---- command bar ------------------------------------------------------

  async showPalette(newTab) {
    const active = this.active()
    const editing = !newTab && active
    const command = { type: 'palette-open', newTab: !editing, url: editing ? active.url : '', items: this.paletteItems() }
    await this.paletteReady
    if (!this.win) return
    this.paletteOpen = true
    this.emit() // sidebar drops its window-drag areas while the bar is open
    this.layout()
    this.win.contentView.addChildView(this.palette) // re-adding moves it to the top
    this.palette.setVisible(true)
    this.palette.webContents.focus()
    this.palette.webContents.send('command', command)
  }

  hidePalette() {
    if (!this.paletteOpen) return
    this.paletteOpen = false
    this.palette.setVisible(false)
    this.active()?.view.webContents.focus()
    this.emit()
  }

  // Open tabs (most recently used first, minus the current one), then
  // bookmarks that don't have a tab open.
  paletteItems() {
    const order = [...new Set([...this.recent].reverse().concat([...this.tabs.keys()]))]
    const tabs = order
      .filter((id) => id !== this.activeId)
      .map((id) => this.tabs.get(id))
      .filter((t) => t.spaceId === this.store.space.id)
      .map((t) => ({ kind: 'tab', id: t.id, title: t.title || t.url, url: t.url, favicon: t.favicon }))
    const bookmarks = []
    const walk = (list, trail) => {
      for (const node of list) {
        if (node.type === 'folder') walk(node.children, [...trail, node.name])
        else if (!this.tabForBookmark(node.id)) {
          bookmarks.push({ kind: 'bookmark', id: node.id, title: node.title, url: node.url, favicon: node.favicon, path: trail.join(' / ') })
        }
      }
    }
    walk(this.store.space.favorites, ['Favorites'])
    walk(this.store.space.pinned, [])
    // History, minus pages already offered as a tab or bookmark.
    const offered = new Set([...tabs, ...bookmarks].map((item) => historyKey(item.url)))
    const history = this.historyFor()
      .ranked()
      .filter((entry) => !offered.has(entry.url))
      .map((e) => ({ kind: 'history', url: e.url, title: e.title || e.url, favicon: e.favicon }))
    return [...tabs, ...bookmarks, ...history]
  }

  // ---- bookmarks --------------------------------------------------------

  openBookmark(id) {
    const node = this.store.get(id)
    if (node?.type !== 'bookmark') return
    const tab = this.tabForBookmark(id)
    if (tab) this.activate(tab.id)
    else this.createTab(node.url, { bookmarkId: id })
  }

  openFavorite(index) {
    const node = this.store.space.favorites[index]
    if (node) this.openBookmark(node.id)
  }

  // Turn an open tab into a bookmark at `target`; the tab stays attached to it.
  pinTab(id, target) {
    const tab = this.tabs.get(id)
    if (!tab || tab.bookmarkId || this.store.spaceById(tab.spaceId)?.incognito) return this.emit()
    const node = bookmark(tab.title || tab.url, tab.url, tab.favicon)
    if (!this.store.insert(node, target)) return this.emit()
    this.store.save()
    tab.bookmarkId = node.id
    this.looseTabs = this.looseTabs.filter((x) => x !== id)
    this.emit()
  }

  pinActive(target) {
    const tab = this.active()
    if (!tab || this.inIncognito()) return
    if (tab.bookmarkId) this.moveNode(tab.bookmarkId, target)
    else this.pinTab(tab.id, target)
  }

  // Remove a bookmark but keep (or open) its page as a regular tab.
  unpin(id, beforeId) {
    const node = this.store.get(id)
    if (node?.type !== 'bookmark') return this.emit()
    const tab = this.tabForBookmark(id) ?? this.createTab(node.url, { activate: false })
    this.store.remove(id)
    this.store.save()
    tab.bookmarkId = null
    this.looseTabs = this.looseTabs.filter((x) => x !== tab.id)
    this.placeLoose(tab.id, beforeId)
    this.emit()
  }

  moveNode(id, target) {
    if (!this.inIncognito() && this.store.move(id, target)) this.store.save()
    this.emit()
  }

  deleteNode(id) {
    const node = this.store.remove(id)
    if (!node) return
    this.store.save()
    for (const bookmarkId of bookmarkIds(node)) {
      const tab = this.tabForBookmark(bookmarkId)
      if (tab) {
        tab.bookmarkId = null
        this.looseTabs.unshift(tab.id)
      }
    }
    this.emit()
  }

  newFolder(parentId = null) {
    if (this.inIncognito()) return
    const node = folder('New Folder')
    const parent = parentId && this.store.get(parentId)
    if (parent) parent.open = true
    if (!this.store.insert(node, { zone: 'pinned', parentId })) return
    this.store.save()
    this.emit()
    this.command({ type: 'rename', id: node.id })
  }

  rename(id, name) {
    const node = this.store.get(id)
    const value = String(name ?? '').trim()
    if (!node || !value) return
    if (node.type === 'folder') node.name = value
    else node.title = value
    this.store.save()
    this.emit()
  }

  toggleFolder(id) {
    const node = this.store.get(id)
    if (node?.type !== 'folder') return
    node.open = !node.open
    this.store.save()
    this.emit()
  }

  // ---- context menus ----------------------------------------------------

  contextMenu({ kind, id, x, y }) {
    const sep = { type: 'separator' }
    let template = []

    if (kind === 'bookmark') {
      const node = this.store.get(id)
      if (!node) return
      const tab = this.tabForBookmark(id)
      const favorite = this.store.isFavorite(id)
      template = [
        { label: 'Open', click: () => this.openBookmark(id) },
        !favorite && { label: 'Rename…', click: () => this.command({ type: 'rename', id }) },
        { label: 'Copy Link', click: () => clipboard.writeText(node.url) },
        tab &&
          tab.url !== node.url && {
            label: 'Replace with Current URL',
            click: () => {
              node.url = tab.url
              this.store.save()
              this.emit()
            },
          },
        sep,
        favorite
          ? { label: 'Move to Pinned', click: () => this.moveNode(id, { zone: 'pinned' }) }
          : { label: 'Add to Favorites', click: () => this.moveNode(id, { zone: 'favorites' }) },
        tab && { label: 'Close Tab', click: () => this.closeTab(tab.id) },
        sep,
        { label: 'Delete', click: () => this.deleteNode(id) },
      ]
    } else if (kind === 'folder') {
      const active = this.active()
      template = [
        { label: 'New Folder Inside', click: () => this.newFolder(id) },
        {
          label: 'Pin Current Tab Here',
          enabled: !!active,
          click: () => this.pinActive({ zone: 'pinned', parentId: id }),
        },
        { label: 'Rename…', click: () => this.command({ type: 'rename', id }) },
        sep,
        { label: 'Delete Folder', click: () => this.deleteNode(id) },
      ]
    } else if (kind === 'tab') {
      const tab = this.tabs.get(id)
      if (!tab) return
      const pinnable = !this.store.spaceById(tab.spaceId)?.incognito
      template = [
        pinnable && { label: 'Add to Favorites', click: () => this.pinTab(id, { zone: 'favorites' }) },
        pinnable && { label: 'Pin Tab', click: () => this.pinTab(id, { zone: 'pinned' }) },
        { label: 'Copy Link', click: () => clipboard.writeText(tab.url) },
        sep,
        { label: 'Close Tab', click: () => this.closeTab(id) },
      ]
    } else if (kind === 'add') {
      // The sidebar's bottom + button.
      template = [
        { label: 'New Space', click: () => this.newSpace() },
        { label: 'New Incognito Space', accelerator: 'Shift+CmdOrCtrl+N', registerAccelerator: false, click: () => this.openIncognito() },
        { label: 'New Folder', accelerator: 'Alt+CmdOrCtrl+N', registerAccelerator: false, enabled: !this.inIncognito(), click: () => this.newFolder(null) },
        sep,
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', registerAccelerator: false, click: () => this.showPalette(true) },
      ]
    } else if (kind === 'space' && this.store.spaceById(id)?.incognito) {
      template = [{ label: 'Close Incognito Space', click: () => this.closeIncognito() }]
    } else if (kind === 'space') {
      const space = this.store.spaceById(id)
      if (!space) return
      template = [
        {
          label: 'Rename Space…',
          click: () => {
            this.switchSpace(id)
            this.command({ type: 'rename-space', id })
          },
        },
        sep,
        { label: 'Delete Space…', enabled: this.store.data.spaces.length > 1, click: () => this.deleteSpace(id) },
      ]
    } else {
      template = [{ label: 'New Folder', enabled: !this.inIncognito(), click: () => this.newFolder(null) }]
    }

    const at = Number.isFinite(x) && Number.isFinite(y) ? { x: Math.round(x), y: Math.round(y) } : {}
    Menu.buildFromTemplate(template.filter(Boolean)).popup({ window: this.win, ...at })
  }

  // Saves the page as it looks on screen (screen styles and backgrounds, not
  // the site's print stylesheet) to a PDF.
  async savePdf(tab = this.active()) {
    if (!tab || !this.win) return
    const name = (tab.title || 'page').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 120) || 'page'
    const { canceled, filePath } = await dialog.showSaveDialog(this.win, {
      defaultPath: path.join(app.getPath('downloads'), `${name}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (canceled || !filePath) return
    const wc = tab.view.webContents
    // Render with screen CSS. Needs the debugger, which is busy while the
    // inspector is open; then the page's print styles are used instead.
    let emulating = false
    try {
      if (!wc.debugger.isAttached()) {
        wc.debugger.attach('1.3')
        await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'screen' })
        emulating = true
      }
    } catch {}
    try {
      const pdf = await wc.printToPDF({ printBackground: true, margins: { marginType: 'none' } })
      await fs.promises.writeFile(filePath, pdf)
      this.notify('Saved as PDF')
    } catch {
      this.notify('Couldn’t save PDF')
    } finally {
      if (emulating) {
        try {
          await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { media: '' })
          wc.debugger.detach()
        } catch {}
      }
    }
  }

  // Right-click menu for web pages (Electron has none built in).
  pageMenu(tab, params) {
    const wc = tab.view.webContents
    const sep = { type: 'separator' }
    const items = []
    const quote = (text) => (text.length > 30 ? `${text.slice(0, 30)}…` : text)

    if (params.linkURL) {
      items.push(
        { label: 'Open Link in New Tab', click: () => this.createTab(params.linkURL, { activate: false }) },
        { label: 'Open Link Here', click: () => wc.loadURL(params.linkURL).catch(() => {}) },
        { label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) },
        sep,
      )
    }

    if (params.mediaType === 'image' && params.srcURL) {
      items.push(
        { label: 'Open Image in New Tab', click: () => this.createTab(params.srcURL, { activate: false }) },
        { label: 'Copy Image', click: () => wc.copyImageAt(params.x, params.y) },
        { label: 'Copy Image Address', click: () => clipboard.writeText(params.srcURL) },
        sep,
      )
    }

    if (params.isEditable) {
      // Spelling suggestions first, like Chrome.
      for (const word of params.dictionarySuggestions.slice(0, 4)) {
        items.push({ label: word, click: () => wc.replaceMisspelling(word) })
      }
      if (params.misspelledWord) {
        items.push(
          {
            label: 'Add to Dictionary',
            click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord),
          },
          sep,
        )
      }
      const can = params.editFlags
      items.push(
        { label: 'Undo', role: 'undo', enabled: can.canUndo },
        { label: 'Redo', role: 'redo', enabled: can.canRedo },
        sep,
        { label: 'Cut', role: 'cut', enabled: can.canCut },
        { label: 'Copy', role: 'copy', enabled: can.canCopy },
        { label: 'Paste', role: 'paste', enabled: can.canPaste },
        { label: 'Paste and Match Style', role: 'pasteAndMatchStyle', enabled: can.canPaste },
        { label: 'Select All', role: 'selectAll', enabled: can.canSelectAll },
        sep,
      )
    } else if (params.selectionText.trim()) {
      const text = params.selectionText.trim()
      items.push(
        { label: 'Copy', role: 'copy' },
        { label: `Search Google for “${quote(text)}”`, click: () => this.createTab(SEARCH_URL + encodeURIComponent(text)) },
        sep,
      )
    }

    if (!params.linkURL && !params.isEditable && !params.selectionText.trim() && params.mediaType === 'none') {
      const history = wc.navigationHistory
      items.push(
        { label: 'Back', enabled: history.canGoBack(), click: () => history.goBack() },
        { label: 'Forward', enabled: history.canGoForward(), click: () => history.goForward() },
        { label: 'Reload', click: () => wc.reload() },
        sep,
        { label: 'Save as PDF…', click: () => this.savePdf(tab) },
        sep,
      )
    }

    items.push({
      label: 'Inspect',
      // Opens the docked inspector if needed and jumps to this element.
      click: () => wc.inspectElement(params.x, params.y),
    })

    // Drop a trailing or doubled separator.
    const template = items.filter((item, i, all) => item.type !== 'separator' || (i > 0 && all[i - 1].type !== 'separator'))
    Menu.buildFromTemplate(template).popup({ window: this.win })
  }

  // ---- sidebar bridge ---------------------------------------------------

  handle(a) {
    const wc = this.active()?.view.webContents
    switch (a.type) {
      case 'open':
        this.hidePalette()
        return this.open(a.input, !!a.newTab)
      case 'show-palette':
        return this.showPalette(!!a.newTab)
      case 'palette-close':
        return this.hidePalette()
      case 'palette-pick':
        this.hidePalette()
        return a.kind === 'tab' ? this.activate(a.id) : this.openBookmark(a.id)
      case 'open-bookmark':
        return this.openBookmark(a.id)
      case 'activate-tab':
        return this.activate(a.id)
      case 'close-tab':
        return this.closeTab(a.id)
      case 'close-bookmark-tab': {
        const tab = this.tabForBookmark(a.id)
        return tab && this.closeTab(tab.id)
      }
      case 'clear-tabs':
        return this.spaceLooseTabs().forEach((id) => this.closeTab(id))
      case 'switch-space':
        return this.switchSpace(a.id)
      case 'open-incognito':
        return this.openIncognito()
      case 'back':
        return wc?.navigationHistory.canGoBack() && wc.navigationHistory.goBack()
      case 'forward':
        return wc?.navigationHistory.canGoForward() && wc.navigationHistory.goForward()
      case 'reload':
        return wc?.reload()
      case 'hard-reload':
        return wc?.reloadIgnoringCache()
      case 'toggle-folder':
        return this.toggleFolder(a.id)
      case 'rename':
        return this.rename(a.id, a.name)
      case 'move':
        return this.moveNode(a.id, toTarget(a.target))
      case 'pin-tab':
        return this.pinTab(a.id, toTarget(a.target))
      case 'move-tab':
        return this.moveTab(a.id, a.beforeId ?? null)
      case 'unpin':
        return this.unpin(a.id, a.beforeId ?? null)
      case 'new-folder':
        return this.newFolder(a.parentId ?? null)
      case 'context-menu':
        return this.contextMenu(a)
      case 'copy-url':
        return this.copyUrl(!!a.quiet)
      case 'toggle-dev-mode':
        return this.toggleDevMode()
      case 'toggle-adblock':
        return this.toggleAdblock()
      case 'clear-site-data':
        return this.clearSiteData()
      case 'reset-permissions': {
        const tab = this.active()
        if (tab) this.permissions.reset(tab.spaceId, tab.url)
        return this.emit()
      }
      case 'toggle-inspector':
        return this.toggleInspector()
      case 'rename-space':
        return this.renameSpace(a.id, a.name)
      case 'toggle-sidebar':
        return this.toggleSidebar()
      case 'arc-import-close':
        return this.closeArcImport()
      case 'arc-import-run':
        return this.runArcImport(a.spaces)
      case 'find':
        return this.find(a.text, a.forward !== false, !!a.findNext)
      case 'find-close':
        return this.closeFind()
      case 'install-update':
        return this.onInstallUpdate?.()
      case 'resize-sidebar':
        return this.resizeSidebar(a.width, !!a.done)
    }
  }

  // Live while dragging the sidebar edge; saved once the drag ends.
  resizeSidebar(width, done) {
    this.sidebarWidth = clampSidebar(width)
    this.layout()
    if (done) {
      this.store.data.sidebarWidth = this.sidebarWidth
      this.store.save()
      this.emit()
    }
  }

  // quiet: the copy button shows its own checkmark, so skip the toast.
  copyUrl(quiet = false) {
    const tab = this.active()
    if (!tab) return
    clipboard.writeText(tab.url)
    if (!quiet) this.notify('Copied URL')
  }

  // A short message in the sidebar; unlike command(), it doesn't take focus
  // away from the page.
  notify(text) {
    if (this.win && this.sidebarReady) this.win.webContents.send('command', { type: 'toast', text })
  }

  // ---- updates ----------------------------------------------------------

  setUpdateReady(version) {
    this.updateReady = version || null
    this.emit()
  }

  // Messages from these pages (the browser's own UI) are trusted.
  isUiSender(wc) {
    return [this.win?.webContents, this.palette?.webContents, this.findView?.webContents, this.importView?.webContents].includes(wc)
  }

  command(c) {
    if (!this.win) return
    this.win.webContents.focus()
    this.win.webContents.send('command', c)
  }

  // Tells main.js when favorites change so the Bookmarks menu can list them.
  favoritesChanged() {
    const signature = JSON.stringify(this.store.space.favorites.slice(0, 9).map((f) => [f.id, f.title]))
    if (signature === this.favoritesSignature) return
    this.favoritesSignature = signature
    this.onFavoritesChange?.()
  }

  // ---- session: restore tabs after quitting -------------------------------

  sessionFile() {
    return path.join(app.getPath('userData'), 'session.json')
  }

  // Open tabs per space (not incognito), in sidebar order, plus each space's
  // last-used tab. Written a second after changes, and on close/quit.
  saveSession() {
    clearTimeout(this.sessionTimer)
    if (!this.sessionReady) return
    const spaces = {}
    for (const space of this.store.data.spaces) {
      const loose = this.spaceLooseTabs(space.id).map((id) => this.tabs.get(id))
      const linked = [...this.tabs.values()].filter((t) => t.spaceId === space.id && t.bookmarkId)
      const ordered = [...loose, ...linked]
      if (ordered.length === 0) continue
      const last = this.lastTabIn(space.id)
      spaces[space.id] = {
        active: ordered.findIndex((t) => t.id === last),
        tabs: ordered.map((t) => ({ url: t.pendingUrl || t.url, title: t.title, favicon: t.favicon, bookmarkId: t.bookmarkId })),
      }
    }
    const current = this.store.space.incognito ? this.store.returnSpaceId : this.store.space.id
    try {
      const file = this.sessionFile()
      fs.writeFileSync(`${file}.tmp`, JSON.stringify({ activeSpaceId: current, spaces }))
      fs.renameSync(`${file}.tmp`, file)
    } catch {}
  }

  scheduleSessionSave() {
    if (!this.sessionReady) return
    clearTimeout(this.sessionTimer)
    this.sessionTimer = setTimeout(() => this.saveSession(), 1000)
  }

  restoreSession() {
    let data = null
    try {
      data = JSON.parse(fs.readFileSync(this.sessionFile(), 'utf8'))
    } catch {}
    for (const [spaceId, saved] of Object.entries(data?.spaces ?? {})) {
      const space = this.store.spaceById(spaceId)
      if (!space || space.incognito || !Array.isArray(saved?.tabs)) continue
      const created = saved.tabs
        .filter((t) => typeof t?.url === 'string' && t.url)
        .map((t) => {
          // Re-attach to its bookmark if that still exists and isn't open yet.
          const bookmarkId = t.bookmarkId && this.store.get(t.bookmarkId) && !this.tabForBookmark(t.bookmarkId) ? t.bookmarkId : null
          return this.createTab(t.url, { bookmarkId, activate: false, space, restore: { title: t.title, favicon: t.favicon } })
        })
      // createTab puts new tabs first; put this space's tabs back in saved order.
      const loose = created.filter((t) => !t.bookmarkId).map((t) => t.id)
      this.looseTabs = this.looseTabs.filter((id) => !loose.includes(id)).concat(loose)
      const active = created[saved.active]
      if (active) this.recent.push(active.id)
    }
    if (data?.activeSpaceId && this.store.spaceById(data.activeSpaceId)) this.store.data.activeSpaceId = data.activeSpaceId
    this.sessionReady = true
    const last = this.lastTabIn(this.store.space.id)
    if (last) this.activate(last)
    else this.emit()
  }

  emit() {
    this.scheduleSessionSave()
    this.favoritesChanged()
    if (!this.win || !this.sidebarReady) return
    this.win.webContents.send('state', this.snapshot())
  }

  snapshot() {
    const active = this.active()
    const linked = {}
    for (const tab of this.tabs.values()) {
      // asleep: restored after a restart but not opened yet, so not really "open"
      if (tab.bookmarkId) linked[tab.bookmarkId] = { tabId: tab.id, loading: tab.loading, asleep: !!tab.pendingUrl }
    }
    const history = active?.view.webContents.navigationHistory
    return {
      favorites: this.store.space.favorites,
      pinned: this.store.space.pinned,
      spaces: [...this.store.data.spaces, ...(this.store.temporary ? [this.store.temporary] : [])].map((s) => ({
        id: s.id,
        name: s.name,
        incognito: !!s.incognito,
      })),
      incognito: this.inIncognito(),
      activeSpaceId: this.store.space.id,
      tabs: this.spaceLooseTabs().map((id) => {
        const t = this.tabs.get(id)
        return { id: t.id, title: t.title || t.url, url: t.url, favicon: t.favicon, loading: t.loading }
      }),
      linked,
      activeTabId: this.activeId,
      paletteOpen: this.paletteOpen || !!this.importOpen, // a full-window overlay is up
      updateReady: this.updateReady ?? null,
      sidebarWidth: this.sidebarWidth,
      sidebarHidden: !!this.sidebarHidden,
      sidebarLimits: SIDEBAR_WIDTH,
      activeBookmarkId: active?.bookmarkId ?? null,
      nav: active && {
        url: active.url,
        host: hostOf(active.url),
        permissions: this.permissions.list(active.spaceId, active.url),
        devMode: this.isDevSite(active.url),
        adblock: this.blocker ? (this.isAdblockOff(active.url) ? 'off' : 'on') : 'loading',
        inspectorOpen: active.view.webContents.isDevToolsOpened(),
        loading: active.loading,
        canGoBack: history.canGoBack(),
        canGoForward: history.canGoForward(),
      },
    }
  }
}

module.exports = { Browser, SIDEBAR_WIDTH }
