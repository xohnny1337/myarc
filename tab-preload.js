// Runs in every web page tab before the page's own scripts.
const { contextBridge, ipcRenderer } = require('electron')

if (location.hostname === 'accounts.google.com') {
  contextBridge.executeInMainWorld({
    func: () => {
      // The tab presents as Firefox here (see lib/google-signin.js): remove the
      // Chromium-only APIs Firefox doesn't have, so the page sees one browser.
      delete Navigator.prototype.userAgentData
      delete window.chrome

      // Electron has no passkey prompt, so a passkey request just hangs on
      // "Verifying it's you…". Report passkeys as unsupported and Google moves
      // on to password or phone confirmation instead.
      delete window.PublicKeyCredential
      const credentials = navigator.credentials
      if (credentials) {
        const unsupported = () => Promise.reject(new DOMException('Passkeys are not supported', 'NotSupportedError'))
        const get = credentials.get.bind(credentials)
        const create = credentials.create.bind(credentials)
        credentials.get = (options) => (options && 'publicKey' in options ? unsupported() : get(options))
        credentials.create = (options) => (options && 'publicKey' in options ? unsupported() : create(options))
      }
    },
  })
}

// ---- swipe back / forward ----------------------------------------------------
//
// Two-finger horizontal swipe on the page goes back (fingers right) or forward
// (fingers left), like Chrome and Safari. Electron doesn't do this itself.
// The page comes first: if what's under the cursor can still scroll that way,
// or the page handles the wheel event itself, it's a scroll, not a swipe.
// After a navigation, the trackpad's leftover momentum events are ignored; a
// new swipe (deltas growing again, or reversing) is let through.
const SWIPE = { threshold: 110, quiet: 150, cooldown: 300 }
const swipe = { dx: 0, locked: false, lockedAt: 0, lastAt: 0, lastAbs: 0, lastSign: 0 }

// If this page was reached by a swipe, the trackpad is probably still sending
// that swipe's momentum: start locked so it doesn't navigate a second time.
ipcRenderer
  .invoke('tab-swipe-recent')
  .then((recent) => {
    if (!recent || swipe.lastAt > 0) return
    const now = performance.now()
    Object.assign(swipe, { locked: true, lockedAt: now, lastAt: now, lastAbs: Infinity, lastSign: 0 })
  })
  .catch(() => {})

// Could something under the cursor scroll further in this direction?
function canScrollSideways(target, direction) {
  for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
    if (el.scrollWidth <= el.clientWidth + 1) continue
    const style = getComputedStyle(el)
    const scrollable = /(auto|scroll|overlay)/.test(style.overflowX) || el === document.scrollingElement
    if (!scrollable) continue
    if (direction < 0 && el.scrollLeft > 0) return true
    if (direction > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true
  }
  const page = document.scrollingElement
  if (page && page.scrollWidth > page.clientWidth + 1) {
    if (direction < 0 && page.scrollLeft > 0) return true
    if (direction > 0 && page.scrollLeft + page.clientWidth < page.scrollWidth - 1) return true
  }
  return false
}

window.addEventListener(
  'wheel',
  (event) => {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.5) return // mostly vertical: a scroll
    const now = performance.now()
    const abs = Math.abs(event.deltaX)
    const sign = Math.sign(event.deltaX)
    const quietGap = now - swipe.lastAt > SWIPE.quiet
    const newFingers =
      swipe.locked &&
      now - swipe.lockedAt > SWIPE.cooldown &&
      ((swipe.lastSign !== 0 && sign !== swipe.lastSign) || (abs > swipe.lastAbs * 1.5 && abs > 3))
    swipe.lastAt = now
    swipe.lastAbs = abs
    swipe.lastSign = sign
    if (quietGap || newFingers) {
      swipe.dx = 0
      swipe.locked = false
    }
    if (swipe.locked) return

    // Let the page's own handlers run first; only then decide.
    const target = event.target
    queueMicrotask(() => {
      if (event.defaultPrevented || canScrollSideways(target, sign)) {
        swipe.dx = 0
        return
      }
      swipe.dx += event.deltaX
      if (Math.abs(swipe.dx) < SWIPE.threshold) return
      swipe.locked = true
      swipe.lockedAt = performance.now()
      ipcRenderer.send('tab-swipe', swipe.dx < 0 ? 'back' : 'forward')
      swipe.dx = 0
    })
  },
  { passive: true },
)
