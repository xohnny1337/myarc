const { dialog } = require('electron')

// Electron grants every permission request by default (camera, microphone,
// location…). Here sites have to ask: you get a prompt and can have your
// answer remembered per site, separately in each space.

// Harmless, and expected to just work.
const ALWAYS = new Set(['fullscreen', 'pointerLock', 'keyboardLock', 'clipboard-sanitized-write'])

// What the prompt says the site wants, and the short name in the site menu.
const ASKABLE = {
  'media:video': { ask: 'use your camera', name: 'Camera' },
  'media:audio': { ask: 'use your microphone', name: 'Microphone' },
  geolocation: { ask: 'know your location', name: 'Location' },
  notifications: { ask: 'show notifications', name: 'Notifications' },
  'clipboard-read': { ask: 'see text and images you copy', name: 'Clipboard' },
  midi: { ask: 'use your MIDI devices', name: 'MIDI' },
  midiSysex: { ask: 'control and reprogram your MIDI devices', name: 'MIDI (full control)' },
  'idle-detection': { ask: 'know when you’re using this device', name: 'Idle detection' },
  'window-management': { ask: 'manage windows on all your displays', name: 'Window management' },
  'storage-access': { ask: 'use cookies and data it saved on other sites', name: 'Cross-site cookies' },
  'top-level-storage-access': { ask: 'use cookies and data it saved on other sites', name: 'Cross-site cookies' },
}

function originOf(url) {
  try {
    const { origin } = new URL(url)
    return origin === 'null' ? null : origin
  } catch {
    return null
  }
}

function hostOf(origin) {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

// The keys a request is about. Camera + microphone in one request are two
// keys, so each can be remembered on its own.
function keysFor(permission, details) {
  if (permission === 'media') {
    const types = (details.mediaTypes?.length ? details.mediaTypes : ['video', 'audio']).filter((t) => t === 'video' || t === 'audio')
    return types.map((t) => `media:${t}`)
  }
  if (permission === 'openExternal') {
    const scheme = (details.externalURL ?? '').split(':')[0].toLowerCase()
    return scheme ? [`openExternal:${scheme}`] : []
  }
  return ASKABLE[permission] ? [permission] : []
}

function describe(key) {
  if (key.startsWith('openExternal:')) {
    const scheme = key.slice('openExternal:'.length)
    return { ask: `open “${scheme}:” links in another app`, name: `Open ${scheme}: links` }
  }
  return ASKABLE[key]
}

// store.data.spaces[i].permissions = { [origin]: { [key]: true | false } }
class Permissions {
  constructor({ store, getWindow, isTab }) {
    this.store = store
    this.getWindow = getWindow
    this.isTab = isTab // only web page tabs (and their popups) may get asked-for permissions
    this.pending = new Map()
  }

  decisions(spaceId, origin) {
    return this.store.spaceById(spaceId)?.permissions?.[origin] ?? {}
  }

  remember(spaceId, origin, keys, allowed) {
    const space = this.store.spaceById(spaceId)
    if (!space) return
    space.permissions ??= {}
    space.permissions[origin] ??= {}
    for (const key of keys) space.permissions[origin][key] = allowed
    this.store.save()
  }

  // For the site menu: what this site was allowed or blocked in a space.
  list(spaceId, url) {
    const origin = originOf(url)
    if (!origin) return []
    return Object.entries(this.decisions(spaceId, origin)).map(([key, allowed]) => ({ key, name: describe(key)?.name ?? key, allowed }))
  }

  reset(spaceId, url) {
    const space = this.store.spaceById(spaceId)
    const origin = originOf(url)
    if (!space?.permissions || !origin) return
    delete space.permissions[origin]
    this.store.save()
  }

  install(ses, spaceId) {
    ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
      this.request(spaceId, webContents, permission, details).then(callback, () => callback(false))
    })
    ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
      if (ALWAYS.has(permission)) return true
      if (webContents && !this.isTab(webContents)) return false
      const origin = originOf(requestingOrigin) ?? originOf(details?.requestingUrl)
      if (!origin) return false
      const keys = permission === 'media' ? [`media:${details?.mediaType === 'audio' ? 'audio' : 'video'}`] : keysFor(permission, details ?? {})
      const saved = this.decisions(spaceId, origin)
      return keys.length > 0 && keys.every((k) => saved[k] === true)
    })
  }

  async request(spaceId, webContents, permission, details) {
    if (ALWAYS.has(permission)) return true
    // The browser's own UI never needs anything; unknown permissions are denied.
    if (!webContents || !this.isTab(webContents)) return false
    const origin = originOf(details.requestingUrl) ?? originOf(webContents.getURL())
    const keys = keysFor(permission, details)
    if (!origin || keys.length === 0) return false

    const saved = this.decisions(spaceId, origin)
    if (keys.some((k) => saved[k] === false)) return false
    if (keys.every((k) => saved[k] === true)) return true

    // One prompt at a time per site and permission, however often it asks.
    const id = `${spaceId} ${origin} ${keys.join(',')}`
    if (!this.pending.has(id)) {
      this.pending.set(id, this.prompt(spaceId, origin, keys).finally(() => this.pending.delete(id)))
    }
    return this.pending.get(id)
  }

  async prompt(spaceId, origin, keys) {
    const win = this.getWindow()
    if (!win) return false
    const both = keys.includes('media:video') && keys.includes('media:audio')
    const asks = both ? ['use your camera and microphone'] : keys.map((k) => describe(k).ask)
    const what = asks.length > 1 ? `${asks.slice(0, -1).join(', ')} and ${asks.at(-1)}` : asks[0]
    const space = this.store.spaceById(spaceId)
    const { response, checkboxChecked } = await dialog.showMessageBox(win, {
      type: 'question',
      message: `${hostOf(origin)} wants to ${what}`,
      detail: this.store.data.spaces.length > 1 && space ? `In the “${space.name}” space.` : undefined,
      buttons: ['Allow', 'Block'],
      defaultId: 1,
      cancelId: 1,
      checkboxLabel: 'Remember my choice for this site',
      checkboxChecked: true,
    })
    const allowed = response === 0
    if (checkboxChecked) this.remember(spaceId, origin, keys, allowed)
    return allowed
  }
}

module.exports = { Permissions }
