const api = window.myarc
const $ = (selector) => document.querySelector(selector)

const ICONS = {
  search: '<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>',
  globe: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c-2.2 2.2-2.2 8.8 0 11M8 2.5c2.2 2.2 2.2 8.8 0 11"/></svg>',
  arrow: '<svg viewBox="0 0 16 16"><path d="M3 8h10M9 4l4 4-4 4"/></svg>',
}

const input = $('#q')
const list = $('#results')
const failedIcons = new Set()

let mode = { newTab: true, url: '' } // url: the current page's address when editing it (⌘L)
let items = [] // open tabs, bookmarks, then history, from the main process
let rows = []
let selected = 0

$('#search-icon').innerHTML = ICONS.search

api.onCommand((command) => {
  if (command.type !== 'palette-open') return
  mode = { newTab: command.newTab, url: command.url }
  items = command.items
  input.value = command.url
  update()
  focusInput()
  // Opened by a click in the sidebar: that click can finish after this and
  // pull focus back, so take it again once it's done.
  setTimeout(focusInput, 50)
})

function focusInput() {
  window.focus()
  if (document.activeElement !== input) {
    input.focus()
    input.select()
  }
}

// ---- matching -------------------------------------------------------------

function host(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function looksLikeUrl(text) {
  if (/\s/.test(text)) return false
  return (
    /^[a-z][a-z\d+.-]*:\/\//i.test(text) ||
    /^(about|data|file|view-source):/i.test(text) ||
    /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(text) ||
    /^[^/]+\.[a-z]{2,}(:\d+)?(\/|$)/i.test(text)
  )
}

function update() {
  const query = input.value.trim()
  const unchanged = !mode.newTab && query === mode.url
  const terms = unchanged ? [] : query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = items.filter((item) => {
    const haystack = `${item.title} ${item.url} ${item.path ?? ''}`.toLowerCase()
    return terms.every((t) => haystack.includes(t))
  })

  if (terms.length === 0) {
    // Nothing typed: just tabs and bookmarks, like Arc.
    rows = matches.filter((item) => item.kind !== 'history')
    // Editing the current address: nothing is picked until the user acts.
    selected = unchanged ? -1 : 0
  } else {
    const url = looksLikeUrl(query)
    const typed = {
      kind: 'input',
      title: query,
      sub: url ? '' : 'Google Search',
      hint: url ? 'Open' : 'Search',
      icon: url ? 'globe' : 'search',
    }
    // A tab, bookmark or history page whose site or title starts with what
    // you typed goes above the plain search/open row.
    const q = query.toLowerCase()
    const best = matches.find((m) => host(m.url).startsWith(q) || m.title.toLowerCase().startsWith(q))
    rows = best ? [best, typed, ...matches.filter((m) => m !== best)] : [typed, ...matches]
    selected = 0
  }
  rows = rows.slice(0, 8)
  draw()
}

// ---- drawing --------------------------------------------------------------

function fallbackIcon(url) {
  try {
    const u = new URL(url)
    return /^https?:$/.test(u.protocol) ? `${u.origin}/favicon.ico` : null
  } catch {
    return null
  }
}

function iconFor(row) {
  const wrap = document.createElement('span')
  wrap.className = 'icon'
  if (row.kind === 'input') {
    wrap.innerHTML = ICONS[row.icon]
    return wrap
  }
  const src = [row.favicon, fallbackIcon(row.url)].find((s) => s && !failedIcons.has(s))
  if (!src) {
    wrap.innerHTML = ICONS.globe
    return wrap
  }
  const img = document.createElement('img')
  img.src = src
  img.alt = ''
  img.addEventListener('error', () => {
    failedIcons.add(src)
    wrap.replaceWith(iconFor(row))
  })
  wrap.append(img)
  return wrap
}

function hintFor(row) {
  if (row.kind === 'input') return row.hint
  if (row.kind === 'tab') return 'Switch to Tab'
  return 'Open'
}

function draw() {
  list.replaceChildren(
    ...rows.map((row, i) => {
      const li = document.createElement('li')
      li.className = 'result'
      li.classList.toggle('selected', i === selected)
      li.setAttribute('role', 'option')

      const text = document.createElement('span')
      text.className = 'text'
      const title = document.createElement('span')
      title.className = 'title'
      title.textContent = row.title
      text.append(title)
      const subText = row.kind === 'input' ? row.sub : row.path || host(row.url)
      if (subText) {
        const sub = document.createElement('span')
        sub.className = 'sub'
        sub.textContent = subText
        text.append(sub)
      }

      const hint = document.createElement('span')
      hint.className = 'hint'
      hint.textContent = hintFor(row)
      const arrow = document.createElement('span')
      arrow.className = 'arrow'
      arrow.innerHTML = ICONS.arrow
      hint.append(arrow)

      li.append(iconFor(row), text, hint)
      li.addEventListener('mousemove', () => select(i))
      li.addEventListener('mousedown', (e) => e.preventDefault())
      li.addEventListener('click', () => choose(row))
      return li
    }),
  )
}

function select(i) {
  if (i === selected) return
  selected = i
  for (const [index, li] of [...list.children].entries()) li.classList.toggle('selected', index === i)
}

// ---- actions --------------------------------------------------------------

function close() {
  api.dispatch({ type: 'palette-close' })
}

function choose(row) {
  if (!row) {
    const query = input.value.trim()
    if (query && query !== mode.url) api.dispatch({ type: 'open', input: query, newTab: mode.newTab })
    else close()
    return
  }
  if (row.kind === 'input') api.dispatch({ type: 'open', input: input.value, newTab: mode.newTab })
  else if (row.kind === 'history') api.dispatch({ type: 'open', input: row.url, newTab: mode.newTab })
  else api.dispatch({ type: 'palette-pick', kind: row.kind, id: row.id })
}

input.addEventListener('input', update)

input.addEventListener('keydown', (e) => {
  const down = e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')
  const up = e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')
  if (down || up) {
    e.preventDefault()
    if (rows.length === 0) return
    const next = selected + (down ? 1 : -1)
    select((next + rows.length) % rows.length)
    list.children[selected]?.scrollIntoView({ block: 'nearest' })
  } else if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
})

$('#form').addEventListener('submit', (e) => {
  e.preventDefault()
  choose(rows[selected])
})

// Clicking anywhere outside the panel dismisses it, like Arc.
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.panel')) close()
})
