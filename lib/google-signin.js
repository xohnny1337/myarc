// Google refuses sign-in from Chromium builds it can't verify as Chrome
// ("This browser or app may not be secure"). Those checks are Chrome-specific,
// so on the sign-in host we present as Firefox instead, the same workaround
// other Electron browsers use. Everywhere else stays plain Chromium.

const SIGNIN_HOSTS = new Set(['accounts.google.com'])

// Firefox ships every four weeks; derive a current-looking version so the
// string doesn't go stale (145 shipped 2025-11-11).
function firefoxUserAgent(now = Date.now()) {
  const fourWeeks = 28 * 24 * 60 * 60 * 1000
  const version = 145 + Math.max(0, Math.floor((now - Date.UTC(2025, 10, 11)) / fourWeeks))
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:${version}.0) Gecko/20100101 Firefox/${version}.0`
}

function isSignin(url) {
  try {
    return SIGNIN_HOSTS.has(new URL(url).hostname)
  } catch {
    return false
  }
}

// Request headers decide per request, so the first request after leaving the
// sign-in host never carries the Firefox string (the tab's own user agent is
// only switched once that navigation has started).
function installSigninHeaders(session, normalUserAgent) {
  const firefox = firefoxUserAgent()
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const signin = isSignin(details.url)
    const requestHeaders = { ...details.requestHeaders, 'User-Agent': signin ? firefox : normalUserAgent }
    if (signin) {
      // Firefox never sends Chromium's client-hint headers.
      for (const name of Object.keys(requestHeaders)) {
        if (/^sec-ch-ua/i.test(name)) delete requestHeaders[name]
      }
    }
    callback({ requestHeaders })
  })
}

// navigator.userAgent comes from the tab's user agent, so switch it whenever
// the tab navigates onto or off the sign-in host. The rest of the page-side
// disguise lives in tab-preload.js.
function followSigninUserAgent(webContents, normalUserAgent) {
  const firefox = firefoxUserAgent()
  webContents.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return
    const wanted = isSignin(details.url) ? firefox : normalUserAgent
    if (webContents.getUserAgent() !== wanted) webContents.setUserAgent(wanted)
  })
}

module.exports = { installSigninHeaders, followSigninUserAgent, SIGNIN_HOSTS: [...SIGNIN_HOSTS] }
