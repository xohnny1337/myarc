// Runs in every web page tab before the page's own scripts.
const { contextBridge } = require('electron')

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
