const api = window.myarc
const $ = (selector) => document.querySelector(selector)

const ICONS = {
  back: '<svg viewBox="0 0 16 16"><path d="M10 3 5 8l5 5"/></svg>',
  forward: '<svg viewBox="0 0 16 16"><path d="m6 3 5 5-5 5"/></svg>',
  reload: '<svg viewBox="0 0 16 16"><path d="M13 8a5 5 0 1 1-1.46-3.54M13 2.5v3h-3"/></svg>',
  folderPlus:
    '<svg viewBox="0 0 16 16"><path d="M14 8V6a1.5 1.5 0 0 0-1.5-1.5H7.8L6.3 3H3.5A1.5 1.5 0 0 0 2 4.5v7A1.5 1.5 0 0 0 3.5 13H8"/><path d="M12 10v4M10 12h4"/></svg>',
  plus: '<svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"/></svg>',
  close: '<svg viewBox="0 0 16 16"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg>',
  check: '<svg viewBox="0 0 16 16"><path d="m3.5 8.5 3 3 6-7"/></svg>',
  link: '<svg viewBox="0 0 16 16"><path d="M6.8 9.2a2.7 2.7 0 0 0 3.8 0l2.2-2.2a2.7 2.7 0 0 0-3.8-3.8l-.9.9"/><path d="M9.2 6.8a2.7 2.7 0 0 0-3.8 0L3.2 9a2.7 2.7 0 0 0 3.8 3.8l.9-.9"/></svg>',
  sliders: '<svg viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><path d="M5.5 6.2h5M5.5 9.8h5"/><circle cx="7" cy="6.2" r=".9"/><circle cx="9" cy="9.8" r=".9"/></svg>',
  incognito: '<svg viewBox="0 0 16 16"><circle cx="4.5" cy="10.5" r="2.3"/><circle cx="11.5" cy="10.5" r="2.3"/><path d="M6.8 10.5h2.4M1.5 7.5h13M3.6 7.5 5 3.5h6l1.4 4"/></svg>',
  lock: '<svg viewBox="0 0 16 16"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>',
  unlock: '<svg viewBox="0 0 16 16"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7"/></svg>',
  inspect: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4.5"/><circle cx="8" cy="8" r="1"/><path d="M8 1.5v2.2M8 12.3v2.2M1.5 8h2.2M12.3 8h2.2"/></svg>',
  shield: '<svg viewBox="0 0 16 16"><path d="M8 1.8 3 3.6v4c0 3.1 2.1 5.4 5 6.6 2.9-1.2 5-3.5 5-6.6v-4z"/><path d="m5.8 8.2 1.6 1.6 2.9-3.2"/></svg>',
  wrench: '<svg viewBox="0 0 16 16"><path d="M10.3 2.6a3.3 3.3 0 0 0-3.9 4.3L2.7 10.6a1.4 1.4 0 0 0 2 2l3.7-3.7a3.3 3.3 0 0 0 4.3-3.9l-2 2-1.8-.5-.5-1.8z"/></svg>',
  globe: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c-2.2 2.2-2.2 8.8 0 11M8 2.5c2.2 2.2 2.2 8.8 0 11"/></svg>',
  folder:
    '<svg viewBox="0 0 16 16"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.8l1.5 1.5h4.7A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z"/></svg>',
  folderOpen:
    '<svg viewBox="0 0 16 16"><path d="M2 11.5v-7A1.5 1.5 0 0 1 3.5 3h2.8l1.5 1.5h4A1.5 1.5 0 0 1 13.3 6v1"/><path d="M2 11.5 3.7 7.6a1 1 0 0 1 .9-.6h9.2a.7.7 0 0 1 .65.97l-1.55 3.98a1.6 1.6 0 0 1-1.5 1.05H3.5A1.5 1.5 0 0 1 2 11.5z"/></svg>',
}

let state = null
let pending = null // state that arrived mid-drag or mid-rename
let dragging = null // { kind: 'node' | 'tab', id, isFolder, el }
let dropAction = null
let renaming = false

const failedIcons = new Set()

// ---- state ----------------------------------------------------------------

api.onState((next) => {
  if (dragging || renaming) {
    pending = next
    return
  }
  state = next
  render()
})

function flush() {
  if (!pending) return
  state = pending
  pending = null
  render()
}

api.onCommand((command) => {
  if (command.type === 'rename') startRename(command.id)
  if (command.type === 'rename-space') startSpaceRename(command.id)
  if (command.type === 'toast') showToast(command.text)
})

let toastTimer = 0

function showToast(text) {
  const toast = $('#toast')
  toast.innerHTML = ICONS.check
  toast.append(text)
  toast.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1600)
}

// ---- helpers --------------------------------------------------------------

function el(tag, className, attrs = {}) {
  const node = document.createElement(tag)
  if (className) node.className = className
  for (const [key, value] of Object.entries(attrs)) node[key] = value
  return node
}

function icon(name) {
  const span = el('span', 'favicon')
  span.innerHTML = ICONS[name]
  return span
}

function fallbackIcon(url) {
  try {
    const u = new URL(url)
    return /^https?:$/.test(u.protocol) ? `${u.origin}/favicon.ico` : null
  } catch {
    return null
  }
}

function favicon(item) {
  const src = [item.favicon, fallbackIcon(item.url)].find((s) => s && !failedIcons.has(s))
  if (!src) return icon('globe')
  const wrap = el('span', 'favicon')
  const img = el('img', '', { src, alt: '', draggable: false })
  img.addEventListener('error', () => {
    failedIcons.add(src)
    wrap.replaceWith(favicon(item))
  })
  wrap.append(img)
  return wrap
}

function label(text) {
  return el('span', 'label', { textContent: text })
}

function closeButton(onClick) {
  const button = el('button', 'icon-btn close', { title: 'Close Tab' })
  button.innerHTML = ICONS.close
  button.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
  })
  return button
}

function onContextMenu(node, kind, id) {
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    e.stopPropagation()
    api.dispatch({ type: 'context-menu', kind, id })
  })
}

function prettyUrl(url) {
  try {
    const u = new URL(url)
    return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '') : url
  } catch {
    return url
  }
}

// ---- render ---------------------------------------------------------------

function render() {
  if (!state) return
  document.body.classList.toggle('palette-open', state.paletteOpen)
  // Incognito is just tabs: no favorites, folders or pinning.
  document.body.classList.toggle('incognito', !!state.incognito)
  $('#incognito-hint').hidden = !state.incognito || state.tabs.length > 0
  // Hidden sidebar: width 0, so everything positioned from it (the
  // Developer Mode bar, the drag strip) moves to the window's edge.
  document.body.classList.toggle('sidebar-hidden', !!state.sidebarHidden)
  if (!resizing) setSidebarWidth(state.sidebarHidden ? 0 : state.sidebarWidth)
  renderSpaces()
  renderFavorites()
  $('#pinned').replaceChildren(renderTree(state.pinned, null, 0))
  if (state.pinned.length === 0) $('#pinned').append(newFolderCta())
  renderTabs()

  const nav = state.nav
  $('#back').disabled = !nav?.canGoBack
  $('#forward').disabled = !nav?.canGoForward
  $('#reload').disabled = !nav
  $('#clear').hidden = state.tabs.length === 0
  $('#update-banner').hidden = !state.updateReady
  if (state.updateReady) $('#update-text').textContent = `MyArc ${state.updateReady} is ready`
  showUrl()
  syncSwipe()
}

function renderSpaces() {
  const active = state.spaces.find((s) => s.id === state.activeSpaceId)
  const title = $('#space-title')
  title.replaceChildren()
  if (active?.incognito) title.append(icon('incognito'))
  title.append(active?.name ?? '')
  $('#spaces').replaceChildren(
    // Like Arc: the current space as its first letter, the others as quiet dots.
    ...state.spaces.map((space) => {
      const current = space.id === state.activeSpaceId
      const button = el('button', current ? 'space-current' : 'space-dot', { title: space.name })
      button.classList.toggle('incognito', space.incognito)
      if (current && space.incognito) button.innerHTML = ICONS.incognito
      else if (current) button.textContent = [...space.name.trim()][0]?.toUpperCase() ?? '?'
      button.setAttribute('aria-label', space.name)
      button.setAttribute('role', 'tab')
      button.setAttribute('aria-selected', String(current))
      button.addEventListener('click', () => api.dispatch({ type: 'switch-space', id: space.id }))
      onContextMenu(button, 'space', space.id)
      return button
    }),
  )
}

// Inline rename of the current space, in its title above the bookmarks.
function startSpaceRename(id) {
  const title = $('#space-title')
  const space = state?.spaces.find((s) => s.id === id)
  if (!space || space.incognito) return
  renaming = true
  const input = el('input', 'rename', { value: space.name, spellcheck: false })
  title.replaceChildren(input)
  input.focus()
  input.select()
  let done = false
  const finish = (commit) => {
    if (done) return
    done = true
    renaming = false
    const name = input.value.trim()
    if (commit && name && name !== space.name) api.dispatch({ type: 'rename-space', id, name })
    if (pending) flush()
    else render()
  }
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') finish(true)
    if (e.key === 'Escape') finish(false)
  })
  input.addEventListener('blur', () => finish(true))
}

$('#space-title').addEventListener('dblclick', () => startSpaceRename(state?.activeSpaceId))
$('#space-title').addEventListener('contextmenu', (e) => {
  e.preventDefault()
  e.stopPropagation()
  api.dispatch({ type: 'context-menu', kind: 'space', id: state?.activeSpaceId })
})

function renderFavorites() {
  const grid = $('#favorites')
  grid.replaceChildren()
  if (state.favorites.length === 0) {
    grid.append(el('div', 'favorites-hint', { textContent: 'Drag tabs here to add Favorites' }))
    return
  }
  state.favorites.forEach((node, i) => {
    const link = state.linked[node.id]
    const tile = el('button', 'fav', { title: node.title, draggable: true })
    Object.assign(tile.dataset, { drop: 'fav', id: node.id, next: state.favorites[i + 1]?.id ?? '' })
    // The dot means a loaded page; restored tabs that haven't been opened yet don't count.
    tile.classList.toggle('open', !!link && !link.asleep)
    tile.classList.toggle('loading', !!link?.loading)
    tile.classList.toggle('active', state.activeBookmarkId === node.id)
    tile.append(favicon(node))
    tile.addEventListener('click', () => api.dispatch({ type: 'open-bookmark', id: node.id }))
    onContextMenu(tile, 'bookmark', node.id)
    draggable(tile, tile, { kind: 'node', id: node.id })
    grid.append(tile)
  })
}

function renderTree(list, parentId, depth) {
  const ul = el('ul', 'tree')
  list.forEach((node, i) => {
    const li = el('li')
    const row = el('div', `row ${node.type}`, { draggable: true })
    row.style.setProperty('--depth', depth)
    Object.assign(row.dataset, {
      drop: 'row',
      id: node.id,
      type: node.type,
      parent: parentId ?? '',
      next: list[i + 1]?.id ?? '',
    })
    draggable(row, li, { kind: 'node', id: node.id, isFolder: node.type === 'folder' })
    li.append(row)

    if (node.type === 'folder') {
      row.dataset.open = node.open ? '1' : ''
      row.dataset.first = node.children[0]?.id ?? ''
      row.append(icon(node.open ? 'folderOpen' : 'folder'), label(node.name))
      row.addEventListener('click', () => api.dispatch({ type: 'toggle-folder', id: node.id }))
      onContextMenu(row, 'folder', node.id)
      if (node.open) li.append(renderTree(node.children, node.id, depth + 1))
    } else {
      const link = state.linked[node.id]
      row.classList.toggle('open', !!link && !link.asleep)
      row.classList.toggle('loading', !!link?.loading)
      row.classList.toggle('active', state.activeBookmarkId === node.id)
      row.append(favicon(node), label(node.title))
      if (link) row.append(closeButton(() => api.dispatch({ type: 'close-bookmark-tab', id: node.id })))
      row.addEventListener('click', () => api.dispatch({ type: 'open-bookmark', id: node.id }))
      onContextMenu(row, 'bookmark', node.id)
    }
    ul.append(li)
  })
  return ul
}

// Empty space: an invitation to make the first folder (tabs can also be
// dropped here to pin them).
function newFolderCta() {
  const row = el('div', 'row new-folder-cta', { title: 'New Folder (⌥⌘N)' })
  row.append(icon('folderPlus'), label('New Folder'))
  row.addEventListener('click', () => api.dispatch({ type: 'new-folder' }))
  return row
}

function renderTabs() {
  const ul = $('#tabs')
  ul.replaceChildren()
  state.tabs.forEach((tab, i) => {
    const row = el('li', 'row tab', { draggable: true, title: tab.title })
    Object.assign(row.dataset, { drop: 'tab', id: tab.id, next: state.tabs[i + 1]?.id ?? '' })
    row.classList.toggle('active', state.activeTabId === tab.id)
    row.classList.toggle('loading', tab.loading)
    row.append(favicon(tab), label(tab.title), closeButton(() => api.dispatch({ type: 'close-tab', id: tab.id })))
    row.addEventListener('click', () => api.dispatch({ type: 'activate-tab', id: tab.id }))
    row.addEventListener('auxclick', (e) => {
      if (e.button === 1) api.dispatch({ type: 'close-tab', id: tab.id })
    })
    onContextMenu(row, 'tab', tab.id)
    draggable(row, row, { kind: 'tab', id: tab.id })
    ul.append(row)
  })
}

// ---- url bar --------------------------------------------------------------

// The pill only shows where you are; editing happens in the command bar.
function showUrl() {
  const nav = state?.nav
  const bar = $('#urlbar')
  $('#url').textContent = nav ? prettyUrl(nav.url) : 'Search or Enter URL'
  bar.title = nav ? `${nav.url}\nClick to edit (⌘L)` : 'Search or Enter URL (⌘T)'
  bar.classList.toggle('placeholder', !nav)
  showDevBar(nav)
  if (!nav?.host) closeSiteMenu()
  else renderSiteMenu()
}

// Developer Mode: the full address in a bar above the page.
function showDevBar(nav) {
  const devbar = $('#devbar')
  devbar.hidden = !nav?.devMode
  document.body.classList.toggle('dev-mode', !devbar.hidden)
  if (devbar.hidden) return
  const secure = nav.url.startsWith('https:')
  const lock = $('#devbar-lock')
  lock.innerHTML = secure ? ICONS.lock : ICONS.unlock
  lock.classList.toggle('insecure', !secure)
  lock.title = secure ? 'Connection is secure' : 'Not secure'
  const input = $('#devbar-url')
  if (document.activeElement !== input) input.value = nav.url
  $('#devbar-inspect').classList.toggle('on', !!nav.inspectorOpen)
}

// ---- site menu --------------------------------------------------------------

function renderSiteMenu() {
  const nav = state?.nav
  if (!nav) return
  $('#site-menu-host').textContent = nav.host
  $('#dev-mode').classList.toggle('on', nav.devMode)
  $('#dev-mode-state').textContent = nav.devMode ? 'On' : 'Off'
  $('#adblock').classList.toggle('on', nav.adblock === 'on')
  $('#adblock-state').textContent = { on: 'On', off: 'Off for this site', loading: 'Starting…' }[nav.adblock] ?? 'On'
  const permissions = nav.permissions ?? []
  $('#site-permissions').hidden = permissions.length === 0
  $('#site-permission-list').replaceChildren(
    ...permissions.map((p) => {
      const li = el('li')
      li.append(el('span', '', { textContent: p.name }), el('span', `state ${p.allowed ? '' : 'blocked'}`, { textContent: p.allowed ? 'Allowed' : 'Blocked' }))
      return li
    }),
  )
}

function openSiteMenu() {
  if (!state?.nav?.host) return
  renderSiteMenu()
  $('#site-menu').hidden = false
  $('#urlbar').classList.add('menu-open')
}

function closeSiteMenu() {
  $('#site-menu').hidden = true
  $('#urlbar').classList.remove('menu-open')
}

document.addEventListener('mousedown', (e) => {
  if ($('#site-menu').hidden) return
  if (!e.target.closest('#site-menu, #site-menu-btn')) closeSiteMenu()
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSiteMenu()
})

// ---- rename ---------------------------------------------------------------

function startRename(id) {
  const row = document.querySelector(`.row[data-id="${CSS.escape(id)}"]`)
  const text = row?.querySelector('.label')
  if (!text) return
  renaming = true
  row.draggable = false
  const input = el('input', 'rename', { value: text.textContent, spellcheck: false })
  text.replaceWith(input)
  input.focus()
  input.select()

  let done = false
  const finish = (commit) => {
    if (done) return
    done = true
    renaming = false
    const name = input.value.trim()
    if (commit && name && name !== text.textContent) api.dispatch({ type: 'rename', id, name })
    if (pending) flush()
    else render()
  }
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') finish(true)
    if (e.key === 'Escape') finish(false)
  })
  input.addEventListener('blur', () => finish(true))
  input.addEventListener('click', (e) => e.stopPropagation())
}

// ---- drag and drop --------------------------------------------------------

function draggable(handle, container, payload) {
  handle.addEventListener('dragstart', (e) => {
    dragging = { ...payload, el: container }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(payload.id))
    requestAnimationFrame(() => container.classList.add('dragging'))
  })
  handle.addEventListener('dragend', endDrag)
}

function clearIndicator() {
  for (const node of document.querySelectorAll('.drop-before, .drop-after, .drop-into')) {
    node.classList.remove('drop-before', 'drop-after', 'drop-into')
  }
}

function endDrag() {
  if (!dragging) return
  dragging.el.classList.remove('dragging')
  dragging = null
  dropAction = null
  clearIndicator()
  flush()
}

// What dropping the current drag item onto `target` would do.
function place(target) {
  return dragging.kind === 'tab'
    ? { type: 'pin-tab', id: dragging.id, target }
    : { type: 'move', id: dragging.id, target }
}

function resolveDrop(e) {
  const zone = e.target.closest?.('[data-drop]')
  if (!zone || dragging.el.contains(zone)) return null
  const { drop, id, next } = zone.dataset
  const rect = zone.getBoundingClientRect()
  const y = (e.clientY - rect.top) / rect.height
  const isFolder = !!dragging.isFolder

  switch (drop) {
    case 'fav': {
      if (isFolder) return null
      const after = e.clientX > rect.left + rect.width / 2
      return {
        el: zone,
        cls: after ? 'drop-after' : 'drop-before',
        action: place({ zone: 'favorites', beforeId: after ? next || null : id }),
      }
    }
    case 'favorites':
      if (isFolder) return null
      return { el: zone.querySelector('.favorites-hint') ?? zone, cls: 'drop-into', action: place({ zone: 'favorites' }) }
    case 'row': {
      const parentId = zone.dataset.parent || null
      if (zone.dataset.type === 'folder') {
        if (y > 0.25 && y < 0.75) {
          return { el: zone, cls: 'drop-into', action: place({ zone: 'pinned', parentId: id }) }
        }
        if (y >= 0.75 && zone.dataset.open) {
          return {
            el: zone,
            cls: 'drop-after',
            action: place({ zone: 'pinned', parentId: id, beforeId: zone.dataset.first || null }),
          }
        }
      }
      const after = y >= 0.5
      return {
        el: zone,
        cls: after ? 'drop-after' : 'drop-before',
        action: place({ zone: 'pinned', parentId, beforeId: after ? next || null : id }),
      }
    }
    case 'pinned':
      return { el: null, action: place({ zone: 'pinned' }) }
    case 'tab':
    case 'tabs': {
      if (isFolder) return null
      const onRow = drop === 'tab'
      const after = onRow && y >= 0.5
      const beforeId = onRow ? (after ? Number(next) || null : Number(id)) : null
      return {
        el: onRow ? zone : null,
        cls: after ? 'drop-after' : 'drop-before',
        action:
          dragging.kind === 'tab'
            ? { type: 'move-tab', id: dragging.id, beforeId }
            : { type: 'unpin', id: dragging.id, beforeId },
      }
    }
  }
  return null
}

document.addEventListener('dragover', (e) => {
  if (!dragging) return
  clearIndicator()
  const drop = resolveDrop(e)
  dropAction = drop?.action ?? null
  if (!drop) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  drop.el?.classList.add(drop.cls)
})

document.addEventListener('drop', (e) => {
  e.preventDefault()
  const action = dropAction
  endDrag()
  if (action) api.dispatch(action)
})

// ---- swipe between spaces -------------------------------------------------

// Two-finger horizontal swipe over the sidebar switches to the next or
// previous space, instantly, the same as clicking its dot. Swiping toward a
// space that doesn't exist (past the first or last) does nothing.
//
// Trackpads keep sending decaying "momentum" wheel events after the fingers
// lift. Those must not trigger a second switch, but a new swipe started while
// they're still coming in must work: deltas that grow again, or reverse
// direction, mean new fingers.
const SWIPE = {
  threshold: 80, // px of finger travel to switch
  quiet: 120, // ms without events = gesture over
  cooldown: 220, // ms after a switch before a new swipe can start
}
const swipe = { dx: 0, locked: false, lockedAt: 0, lastAt: 0, lastAbs: 0, lastSign: 0, timer: 0, expectedId: null, fromId: null }

// The space we're on. Right after a swipe switches, the sidebar hasn't heard
// back yet, so trust the space it switched to until the update arrives;
// otherwise a quick next swipe would look like a dead end and be dropped.
function spaceIndex() {
  if (!state) return -1
  if (swipe.expectedId && state.activeSpaceId !== swipe.expectedId) {
    const expected = state.spaces.findIndex((s) => s.id === swipe.expectedId)
    if (expected !== -1) return expected
  }
  swipe.expectedId = null
  return state.spaces.findIndex((s) => s.id === state.activeSpaceId)
}

// Called after each render: once an update shows we've left the space the
// swipe started from, the real active space is known again.
function syncSwipe() {
  if (swipe.expectedId && state.activeSpaceId !== swipe.fromId) swipe.expectedId = null
}

function commitSwipe(direction) {
  // direction: +1 = next space, -1 = previous.
  const target = state.spaces[spaceIndex() + direction]
  swipe.locked = true
  swipe.lockedAt = performance.now()
  swipe.dx = 0
  swipe.expectedId = target.id
  swipe.fromId = state.activeSpaceId
  api.dispatch({ type: 'switch-space', id: target.id })
}

function onSwipeWheel(e) {
  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return // vertical scrolling stays scrolling
  if (!state || state.spaces.length < 2 || renaming) return
  e.preventDefault()

  const now = performance.now()
  const abs = Math.abs(e.deltaX)
  const sign = Math.sign(e.deltaX)
  const quietGap = now - swipe.lastAt > SWIPE.quiet
  const newFingers =
    swipe.locked &&
    now - swipe.lockedAt > SWIPE.cooldown &&
    (sign !== swipe.lastSign || (abs > swipe.lastAbs * 1.5 && abs > 3))
  swipe.lastAt = now
  swipe.lastAbs = abs
  swipe.lastSign = sign

  if (quietGap || newFingers) {
    swipe.dx = 0
    swipe.locked = false
  }
  clearTimeout(swipe.timer)
  swipe.timer = setTimeout(() => {
    swipe.locked = false
    swipe.dx = 0
  }, SWIPE.quiet)
  if (swipe.locked) return // momentum from the swipe that already switched

  swipe.dx -= e.deltaX
  const direction = swipe.dx < 0 ? 1 : -1
  if (!state.spaces[spaceIndex() + direction]) {
    swipe.dx = 0 // dead end
    return
  }
  if (Math.abs(swipe.dx) > SWIPE.threshold) commitSwipe(direction)
}

$('#sidebar').addEventListener('wheel', onSwipeWheel, { passive: false })

// ---- sidebar resizing -----------------------------------------------------

let resizing = false

function setSidebarWidth(width) {
  document.documentElement.style.setProperty('--sidebar-w', `${width}px`)
}

{
  const handle = $('.resizer')
  let startX = 0
  let startWidth = 0
  let width = 0
  let frame = 0

  const send = (done) => api.dispatch({ type: 'resize-sidebar', width, done })

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !state) return
    e.preventDefault()
    // Pointer capture keeps the moves coming while the cursor is over the page.
    handle.setPointerCapture(e.pointerId)
    resizing = true
    startX = e.clientX
    startWidth = width = state.sidebarWidth
    document.body.classList.add('resizing')
  })

  handle.addEventListener('pointermove', (e) => {
    if (!resizing) return
    const { min, max } = state.sidebarLimits
    width = Math.min(max, Math.max(min, Math.round(startWidth + e.clientX - startX)))
    setSidebarWidth(width)
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0
        send(false)
      })
    }
  })

  const finish = () => {
    if (!resizing) return
    resizing = false
    cancelAnimationFrame(frame)
    frame = 0
    document.body.classList.remove('resizing')
    send(true)
  }
  handle.addEventListener('pointerup', finish)
  handle.addEventListener('pointercancel', finish)
  handle.addEventListener('lostpointercapture', finish)

  // Double-click puts it back to the default width.
  handle.addEventListener('dblclick', () => {
    width = state.sidebarLimits.default
    setSidebarWidth(width)
    send(true)
  })
}

// ---- static controls ------------------------------------------------------

$('#back').innerHTML = ICONS.back
$('#forward').innerHTML = ICONS.forward
$('#reload').innerHTML = ICONS.reload
$('#add').innerHTML = ICONS.plus
$('#new-tab .favicon').innerHTML = ICONS.plus

$('#back').addEventListener('click', () => api.dispatch({ type: 'back' }))
$('#forward').addEventListener('click', () => api.dispatch({ type: 'forward' }))
// Shift-click the reload button for a hard reload (⇧⌘R).
$('#reload').addEventListener('click', (e) => api.dispatch({ type: e.shiftKey ? 'hard-reload' : 'reload' }))
$('#add').addEventListener('click', () => {
  // Open the menu upward from the button, like Arc.
  const rect = $('#add').getBoundingClientRect()
  api.dispatch({ type: 'context-menu', kind: 'add', x: rect.left, y: rect.top - 4 })
})
$('#update-banner').addEventListener('click', () => api.dispatch({ type: 'install-update' }))
$('#clear').addEventListener('click', () => api.dispatch({ type: 'clear-tabs' }))
$('#new-tab').addEventListener('click', () => api.dispatch({ type: 'show-palette', newTab: true }))
$('#urlbar').addEventListener('click', () => {
  closeSiteMenu()
  api.dispatch({ type: 'show-palette', newTab: false })
})
$('#copy-url').innerHTML = ICONS.link
$('#site-menu-btn').innerHTML = ICONS.sliders
$('#dev-mode-icon').innerHTML = ICONS.wrench
$('#adblock-icon').innerHTML = ICONS.shield
$('#adblock').addEventListener('click', () => api.dispatch({ type: 'toggle-adblock' }))
// The link icon morphs into a checkmark for a moment after copying.
function copyWithCheck(button) {
  api.dispatch({ type: 'copy-url', quiet: true })
  clearTimeout(button.copiedTimer)
  button.innerHTML = ICONS.check
  button.classList.remove('copied')
  void button.offsetWidth // restart the animation on repeat clicks
  button.classList.add('copied')
  button.copiedTimer = setTimeout(() => {
    button.classList.remove('copied')
    button.innerHTML = ICONS.link
  }, 1400)
}

$('#copy-url').addEventListener('click', (e) => {
  e.stopPropagation()
  copyWithCheck(e.currentTarget)
})
$('#site-menu-btn').addEventListener('click', (e) => {
  e.stopPropagation()
  if ($('#site-menu').hidden) openSiteMenu()
  else closeSiteMenu()
})
$('#dev-mode').addEventListener('click', () => api.dispatch({ type: 'toggle-dev-mode' }))
$('#reset-permissions').addEventListener('click', () => api.dispatch({ type: 'reset-permissions' }))
$('#clear-site-data').addEventListener('click', () => {
  closeSiteMenu()
  api.dispatch({ type: 'clear-site-data' })
})
$('#devbar-copy').innerHTML = ICONS.link
$('#devbar-copy').addEventListener('click', (e) => copyWithCheck(e.currentTarget))
$('#devbar-inspect').innerHTML = ICONS.inspect
$('#devbar-inspect').addEventListener('click', () => api.dispatch({ type: 'toggle-inspector' }))

{
  const input = $('#devbar-url')
  const revert = () => {
    input.value = state?.nav?.url ?? ''
  }
  input.addEventListener('focus', () => input.select())
  // Keep the click that focused the field from collapsing the selection.
  input.addEventListener('mouseup', (e) => {
    if (input.dataset.justFocused) e.preventDefault()
    delete input.dataset.justFocused
  })
  input.addEventListener('mousedown', () => {
    if (document.activeElement !== input) input.dataset.justFocused = '1'
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const value = input.value.trim()
      if (value && value !== state?.nav?.url) api.dispatch({ type: 'open', input: value, newTab: false })
      input.blur()
    } else if (e.key === 'Escape') {
      revert()
      input.blur()
    }
  })
  input.addEventListener('blur', revert)
}

for (const zone of ['#pinned', '.tabs-zone']) {
  $(zone).addEventListener('contextmenu', (e) => {
    e.preventDefault()
    api.dispatch({ type: 'context-menu', kind: 'sidebar' })
  })
}
