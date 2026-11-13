const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { bookmark, folder } = require('./store')

// Reads Arc's sidebar (StorableSidebar.json) into MyArc spaces:
//   Arc space title       -> space name
//   Arc "pinned" area     -> folders and bookmarks
//   Arc favorites         -> favorites (Arc keeps them per profile, so every
//                            space on that profile gets them)
// Arc's "unpinned" tabs are temporary, like MyArc's tab list, and aren't
// imported. Sign-ins can't be imported; each space starts signed out.

const ARC_SIDEBAR = path.join(os.homedir(), 'Library', 'Application Support', 'Arc', 'StorableSidebar.json')

// Arc stores several maps as flat [key, value, key, value, …] lists.
function pairs(list) {
  const out = []
  for (let i = 0; i + 1 < (list?.length ?? 0); i += 2) out.push([list[i], list[i + 1]])
  return out
}

function isWebUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url)
}

function readArcSidebar(file = ARC_SIDEBAR) {
  if (!fs.existsSync(file)) return null
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  const container = json?.sidebar?.containers?.find((c) => c && Array.isArray(c.spaces) && Array.isArray(c.items))
  if (!container) throw new Error('Unrecognized Arc sidebar format')

  const items = new Map()
  for (const [id, item] of pairs(container.items)) if (typeof id === 'string' && item) items.set(id, item)

  // Turn an Arc item into a MyArc bookmark or folder (or nothing).
  const convert = (id, depth = 0) => {
    const item = items.get(id)
    if (!item || depth > 20) return null
    const data = item.data ?? {}
    if (data.tab) {
      const url = data.tab.savedURL
      if (!isWebUrl(url)) return null
      return bookmark(item.title || data.tab.savedTitle || url, url)
    }
    if (data.list) {
      const node = folder(item.title || 'Folder', children(item, depth))
      node.open = false
      return node
    }
    return null
  }
  const children = (item, depth = 0) => (item?.childrenIds ?? []).map((id) => convert(id, depth + 1)).filter(Boolean)
  const favoritesOf = (containerId) => children(items.get(containerId)).filter((n) => n.type === 'bookmark')

  // Favorites per Arc profile, keyed by the profile's JSON.
  const favoritesByProfile = new Map()
  for (const [profile, containerId] of pairs(container.topAppsContainerIDs)) {
    favoritesByProfile.set(JSON.stringify(profile), containerId)
  }

  const spaces = []
  for (const [, space] of pairs(container.spaces)) {
    if (!space || typeof space !== 'object') continue
    const ids = space.containerIDs ?? []
    const pinnedId = ids[ids.indexOf('pinned') + 1]
    const pinned = ids.includes('pinned') ? children(items.get(pinnedId)) : []
    const favoritesId = favoritesByProfile.get(JSON.stringify(space.profile))
    spaces.push({
      name: space.title || `Arc Space ${spaces.length + 1}`,
      favorites: favoritesId ? favoritesOf(favoritesId).map((b) => bookmark(b.title, b.url)) : [],
      pinned,
    })
  }
  return spaces
}

function countBookmarks(nodes) {
  return nodes.reduce((n, node) => n + (node.type === 'folder' ? countBookmarks(node.children) : 1), 0)
}

function countFolders(nodes) {
  return nodes.reduce((n, node) => n + (node.type === 'folder' ? 1 + countFolders(node.children) : 0), 0)
}

module.exports = { readArcSidebar, countBookmarks, countFolders, ARC_SIDEBAR }
