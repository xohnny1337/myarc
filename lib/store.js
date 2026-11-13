const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const bookmark = (title, url, favicon = null) => ({ id: randomUUID(), type: 'bookmark', title, url, favicon })
const folder = (name, children = []) => ({ id: randomUUID(), type: 'folder', name, open: true, children })

// A space is a profile: its own favorites, folders and tabs, and its own
// cookies/sign-ins (`partition`; null = Electron's default session, which the
// first space keeps so existing sign-ins carry over).
const space = (name, { partition, favorites = [], pinned = [] } = {}) => {
  const id = randomUUID()
  return { id, name, partition: partition === undefined ? `persist:space-${id}` : partition, favorites, pinned }
}

function seed() {
  return withSpaces({
    favorites: [
      bookmark('GitHub', 'https://github.com/'),
      bookmark('Gmail', 'https://mail.google.com/'),
      bookmark('Calendar', 'https://calendar.google.com/'),
      bookmark('YouTube', 'https://www.youtube.com/'),
    ],
    pinned: [
      folder('Electron', [
        bookmark('Building your First App', 'https://www.electronjs.org/docs/latest/tutorial/tutorial-first-app'),
        bookmark('WebContentsView', 'https://www.electronjs.org/docs/latest/api/web-contents-view'),
      ]),
    ],
  })
}

// Files from before spaces had one top-level favorites/pinned pair: that
// becomes the first space.
function withSpaces(data) {
  if (Array.isArray(data.spaces) && data.spaces.length) return data
  const { favorites = [], pinned = [], ...rest } = data
  const first = space('Personal', { partition: null, favorites, pinned })
  return { ...rest, spaces: [first], activeSpaceId: first.id }
}

// Each space keeps its bookmarks in two lists: `favorites` (flat, bookmarks
// only) and `pinned` (a tree of folders and bookmarks).
class Store {
  constructor(file) {
    this.file = file
    this.data = this.load()
    // Incognito: a space that only lives in memory, never in the file.
    this.temporary = null
    this.returnSpaceId = null // the space to come back to when it closes
  }

  load() {
    if (!fs.existsSync(this.file)) return seed()
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (Array.isArray(data.spaces) || (Array.isArray(data.favorites) && Array.isArray(data.pinned))) {
        return withSpaces(data)
      }
    } catch {}
    // Keep an unreadable file around instead of silently overwriting it.
    fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}`)
    return seed()
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    const onTemporary = this.temporary && this.data.activeSpaceId === this.temporary.id
    const data = onTemporary ? { ...this.data, activeSpaceId: this.returnSpaceId ?? this.data.spaces[0].id } : this.data
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
    fs.renameSync(tmp, this.file)
  }

  // ---- spaces -------------------------------------------------------------

  get space() {
    if (this.temporary && this.data.activeSpaceId === this.temporary.id) return this.temporary
    return this.data.spaces.find((s) => s.id === this.data.activeSpaceId) ?? this.data.spaces[0]
  }

  spaceById(id) {
    if (this.temporary?.id === id) return this.temporary
    return this.data.spaces.find((s) => s.id === id) ?? null
  }

  addSpace(name) {
    const created = space(name)
    this.data.spaces.push(created)
    return created
  }

  removeSpace(id) {
    if (this.data.spaces.length <= 1) return null
    const index = this.data.spaces.findIndex((s) => s.id === id)
    if (index === -1) return null
    const [removed] = this.data.spaces.splice(index, 1)
    if (this.data.activeSpaceId === id) this.data.activeSpaceId = this.data.spaces[Math.max(0, index - 1)].id
    return removed
  }

  // Which space a bookmark belongs to.
  spaceOf(id) {
    return this.data.spaces.find((s) => [...s.favorites, ...s.pinned].some(function has(n) {
      return n.id === id || (n.type === 'folder' && n.children.some(has))
    })) ?? null
  }

  // ---- bookmarks ----------------------------------------------------------

  // Returns { node, list, index } for a node in any space's favorites or pinned tree.
  locate(id) {
    const walk = (list) => {
      for (let index = 0; index < list.length; index++) {
        const node = list[index]
        if (node.id === id) return { node, list, index }
        if (node.type === 'folder') {
          const hit = walk(node.children)
          if (hit) return hit
        }
      }
      return null
    }
    for (const s of this.data.spaces) {
      const hit = walk(s.favorites) || walk(s.pinned)
      if (hit) return hit
    }
    return null
  }

  get(id) {
    return this.locate(id)?.node ?? null
  }

  isFavorite(id) {
    return this.space.favorites.some((n) => n.id === id)
  }

  // target: { zone: 'favorites' | 'pinned', parentId?: folderId, beforeId?: siblingId }
  listFor(target) {
    if (target.zone === 'favorites') return this.space.favorites
    if (!target.parentId) return this.space.pinned
    const parent = this.get(target.parentId)
    return parent?.type === 'folder' ? parent.children : null
  }

  insert(node, target) {
    const list = this.listFor(target)
    if (!list || (target.zone === 'favorites' && node.type === 'folder')) return false
    const at = target.beforeId ? list.findIndex((n) => n.id === target.beforeId) : -1
    list.splice(at === -1 ? list.length : at, 0, node)
    return true
  }

  move(id, target) {
    const hit = this.locate(id)
    if (!hit || id === target.beforeId) return false
    const { node } = hit
    if (node.type === 'folder' && target.parentId && (target.parentId === id || contains(node, target.parentId))) {
      return false
    }
    hit.list.splice(hit.index, 1)
    if (this.insert(node, target)) return true
    hit.list.splice(hit.index, 0, node)
    return false
  }

  remove(id) {
    const hit = this.locate(id)
    if (!hit) return null
    hit.list.splice(hit.index, 1)
    return hit.node
  }
}

function contains(folderNode, id) {
  return folderNode.children.some((c) => c.id === id || (c.type === 'folder' && contains(c, id)))
}

// Ids of every bookmark at or under `node`.
function bookmarkIds(node) {
  if (node.type === 'bookmark') return [node.id]
  return node.children.flatMap(bookmarkIds)
}

module.exports = { Store, bookmark, folder, bookmarkIds }
