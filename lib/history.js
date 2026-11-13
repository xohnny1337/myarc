const fs = require('node:fs')
const path = require('node:path')

const MAX_ENTRIES = 5000
const SAVE_DELAY = 1000
const DAY = 24 * 60 * 60 * 1000

// Pages we never keep: sign-in flows are full of one-time tokens.
const SKIP_HOSTS = new Set(['accounts.google.com'])

function keyFor(url) {
  try {
    const u = new URL(url)
    if (!/^https?:$/.test(u.protocol) || SKIP_HOSTS.has(u.hostname)) return null
    u.hash = ''
    return u.href
  } catch {
    return null
  }
}

// Visited pages, one entry per URL: { url, title, favicon, visits, lastVisit }.
class History {
  constructor(file) {
    this.file = file
    this.entries = new Map()
    this.timer = null
    try {
      for (const entry of JSON.parse(fs.readFileSync(file, 'utf8'))) {
        if (entry?.url) this.entries.set(entry.url, entry)
      }
    } catch {}
  }

  visit(url, title) {
    const key = keyFor(url)
    if (!key) return
    const entry = this.entries.get(key) ?? { url: key, title: '', favicon: null, visits: 0, lastVisit: 0 }
    entry.visits += 1
    entry.lastVisit = Date.now()
    if (title) entry.title = title
    // Re-insert so the Map stays ordered oldest -> newest visit.
    this.entries.delete(key)
    this.entries.set(key, entry)
    this.prune()
    this.scheduleSave()
  }

  update(url, fields) {
    const entry = this.entries.get(keyFor(url))
    if (!entry) return
    Object.assign(entry, fields)
    this.scheduleSave()
  }

  // Frequently and recently visited first.
  ranked(limit = 2000) {
    const now = Date.now()
    const score = (e) => e.visits / (1 + (now - e.lastVisit) / (7 * DAY))
    return [...this.entries.values()].sort((a, b) => score(b) - score(a)).slice(0, limit)
  }

  clear() {
    this.entries.clear()
    this.saveNow()
  }

  // Forget pages last visited at or after `since` (ms). A page is one entry,
  // so a page visited today is removed entirely, older visits included.
  clearSince(since) {
    for (const [key, entry] of this.entries) if (entry.lastVisit >= since) this.entries.delete(key)
    this.saveNow()
  }

  prune() {
    for (const key of this.entries.keys()) {
      if (this.entries.size <= MAX_ENTRIES) break
      this.entries.delete(key)
    }
  }

  scheduleSave() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.saveNow(), SAVE_DELAY)
  }

  saveNow() {
    clearTimeout(this.timer)
    this.timer = null
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify([...this.entries.values()]))
    fs.renameSync(tmp, this.file)
  }
}

// One history per space, so spaces don't see each other's browsing. The
// first space (default session) keeps the original history.json.
class Histories {
  constructor(dir) {
    this.dir = dir
    this.loaded = new Map()
  }

  fileFor(space) {
    return path.join(this.dir, space.partition ? `history-${space.id}.json` : 'history.json')
  }

  for(space) {
    if (!this.loaded.has(space.id)) this.loaded.set(space.id, new History(this.fileFor(space)))
    return this.loaded.get(space.id)
  }

  // A deleted space's history goes with it.
  forget(space) {
    this.for(space).clear()
    this.loaded.delete(space.id)
    fs.rmSync(this.fileFor(space), { force: true })
  }

  saveAll() {
    for (const history of this.loaded.values()) if (history.timer) history.saveNow()
  }
}

module.exports = { History, Histories, historyKey: keyFor }
