// Import from Arc: pick spaces, folders and single tabs to bring over.
// Everything starts selected; unticking removes it from the import.
const api = window.myarc
const $ = (selector) => document.querySelector(selector)

const ICONS = {
  chevron: '<svg viewBox="0 0 16 16"><path d="m6 4 4 4-4 4"/></svg>',
  folder:
    '<svg viewBox="0 0 16 16"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.8l1.5 1.5h4.7A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z"/></svg>',
  globe: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c-2.2 2.2-2.2 8.8 0 11M8 2.5c2.2 2.2 2.2 8.8 0 11"/></svg>',
}

let spaces = [] // [{ index, name, favorites: [bookmark], pinned: [bookmark | folder] }]
const excluded = new Set() // ids of unticked tabs (and unticked empty folders)
const expanded = new Set() // ids of open spaces and folders
const failedIcons = new Set()

// ---- selection model --------------------------------------------------------

// The things a checkbox actually controls: tabs, plus folders with nothing
// inside (so they can still be picked on their own).
function leaves(node) {
  if (node.type === 'folder') return node.children.length ? node.children.flatMap(leaves) : [node]
  return [node]
}

function spaceLeaves(space) {
  return [...space.favorites, ...space.pinned.flatMap(leaves)]
}

function stateOf(items) {
  const on = items.filter((n) => !excluded.has(n.id)).length
  return on === 0 ? 'off' : on === items.length ? 'on' : 'some'
}

function toggle(items) {
  const turnOn = stateOf(items) !== 'on'
  for (const n of items) turnOn ? excluded.delete(n.id) : excluded.add(n.id)
  render()
}

// ---- rendering --------------------------------------------------------------

function el(tag, className, props = {}) {
  const node = document.createElement(tag)
  if (className) node.className = className
  Object.assign(node, props)
  return node
}

function checkbox(items, label) {
  const box = el('input', '', { type: 'checkbox' })
  const state = stateOf(items)
  box.checked = state === 'on'
  box.indeterminate = state === 'some'
  box.setAttribute('aria-label', label)
  box.addEventListener('click', (e) => {
    e.stopPropagation()
    toggle(items)
  })
  return box
}

function twisty(id, hasChildren) {
  const button = el('button', `twisty ${expanded.has(id) ? 'open' : ''} ${hasChildren ? '' : 'blank'}`)
  button.innerHTML = ICONS.chevron
  button.setAttribute('aria-label', expanded.has(id) ? 'Collapse' : 'Expand')
  button.addEventListener('click', (e) => {
    e.stopPropagation()
    expanded.has(id) ? expanded.delete(id) : expanded.add(id)
    render()
  })
  return button
}

function favicon(url) {
  const wrap = el('span', 'icon')
  let src = null
  try {
    const u = new URL(url)
    if (/^https?:$/.test(u.protocol)) src = `${u.origin}/favicon.ico`
  } catch {}
  if (!src || failedIcons.has(src)) {
    wrap.innerHTML = ICONS.globe
    return wrap
  }
  const img = el('img', '', { src, alt: '', draggable: false })
  img.addEventListener('error', () => {
    failedIcons.add(src)
    wrap.innerHTML = ICONS.globe
  })
  wrap.append(img)
  return wrap
}

function host(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function bookmarkRow(node, depth) {
  const row = el('li', `item ${excluded.has(node.id) ? 'off' : ''}`)
  row.style.setProperty('--depth', depth)
  row.append(el('span', 'twisty blank'), checkbox([node], node.title), favicon(node.url), el('span', 'title', { textContent: node.title }), el('span', 'host', { textContent: host(node.url) }))
  row.title = node.url
  row.addEventListener('click', () => toggle([node]))
  return row
}

function folderRows(node, depth) {
  const items = leaves(node)
  const row = el('li', `item ${stateOf(items) === 'off' ? 'off' : ''}`)
  row.style.setProperty('--depth', depth)
  const iconEl = el('span', 'icon')
  iconEl.innerHTML = ICONS.folder
  const tabs = items.filter((n) => n.type === 'bookmark').length
  row.append(twisty(node.id, node.children.length > 0), checkbox(items, node.name), iconEl, el('span', 'title', { textContent: node.name }), el('span', 'count', { textContent: tabs ? `${tabs} ${tabs === 1 ? 'tab' : 'tabs'}` : 'empty' }))
  row.addEventListener('click', () => {
    expanded.has(node.id) ? expanded.delete(node.id) : expanded.add(node.id)
    render()
  })
  const rows = [row]
  if (expanded.has(node.id)) for (const child of node.children) rows.push(...nodeRows(child, depth + 1))
  return rows
}

function nodeRows(node, depth) {
  return node.type === 'folder' ? folderRows(node, depth) : [bookmarkRow(node, depth)]
}

function spaceCard(space) {
  const key = `space-${space.index}`
  const items = spaceLeaves(space)
  const card = el('section', `space ${stateOf(items) === 'off' ? 'excluded' : ''}`)

  const head = el('div', 'space-head')
  const tabs = space.pinned.flatMap(leaves).filter((n) => n.type === 'bookmark').length
  const folders = (function count(nodes) {
    return nodes.reduce((n, x) => n + (x.type === 'folder' ? 1 + count(x.children) : 0), 0)
  })(space.pinned)
  const meta = [`${space.favorites.length} favorites`, `${folders} folders`, `${tabs} pinned tabs`].join(' · ')
  head.append(twisty(key, items.length > 0), checkbox(items, space.name), el('span', 'space-name', { textContent: space.name }), el('span', 'space-meta', { textContent: meta }))
  head.addEventListener('click', () => {
    expanded.has(key) ? expanded.delete(key) : expanded.add(key)
    render()
  })
  card.append(head)

  if (expanded.has(key)) {
    const body = el('div', 'space-body')
    if (space.favorites.length) {
      body.append(el('div', 'section', { textContent: 'Favorites' }))
      const list = el('ul', 'tree')
      for (const fav of space.favorites) list.append(bookmarkRow(fav, 1))
      body.append(list)
    }
    if (space.pinned.length) {
      body.append(el('div', 'section', { textContent: 'Pinned' }))
      const list = el('ul', 'tree')
      for (const node of space.pinned) list.append(...nodeRows(node, 1))
      body.append(list)
    }
    if (!items.length) body.append(el('div', 'empty', { textContent: 'This space has no favorites or pinned tabs.' }))
    card.append(body)
  }
  return card
}

function selection() {
  return spaces
    .map((space) => {
      const items = spaceLeaves(space)
      return { space, items, on: items.filter((n) => !excluded.has(n.id)) }
    })
    .filter((s) => s.on.length > 0)
}

function render() {
  const list = $('#spaces')
  const scroll = list.scrollTop
  list.replaceChildren(...spaces.map(spaceCard))
  list.scrollTop = scroll

  const picked = selection()
  const tabs = picked.reduce((n, s) => n + s.on.filter((x) => x.type === 'bookmark').length, 0)
  $('#summary').textContent = picked.length
    ? `${picked.length} ${picked.length === 1 ? 'space' : 'spaces'} · ${tabs} ${tabs === 1 ? 'tab' : 'tabs'} selected`
    : 'Nothing selected'
  $('#import').disabled = picked.length === 0
}

// ---- actions ----------------------------------------------------------------

function close() {
  api.dispatch({ type: 'arc-import-close' })
}

$('#cancel').addEventListener('click', close)

$('#import').addEventListener('click', () => {
  const picked = selection().map(({ space }) => ({
    index: space.index,
    excluded: spaceLeaves(space).filter((n) => excluded.has(n.id)).map((n) => n.id),
  }))
  if (picked.length) api.dispatch({ type: 'arc-import-run', spaces: picked })
})

$('#select-all').addEventListener('click', () => {
  excluded.clear()
  render()
})

$('#select-none').addEventListener('click', () => {
  for (const space of spaces) for (const n of spaceLeaves(space)) excluded.add(n.id)
  render()
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') close()
})

document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.dialog')) close()
})

api.onCommand((command) => {
  if (command.type !== 'arc-import-open') return
  spaces = command.spaces
  excluded.clear()
  expanded.clear()
  if (spaces[0]) expanded.add(`space-${spaces[0].index}`) // show what's inside the first one
  render()
  $('#spaces').scrollTop = 0
  $('#import').focus()
})
