// Find bar: floats over the top-right of the page. The main process runs the
// search (webContents.findInPage) and reports "3 of 12" back.
const api = window.myarc
const $ = (selector) => document.querySelector(selector)

const ICONS = {
  prev: '<svg viewBox="0 0 16 16"><path d="m4 10 4-4 4 4"/></svg>',
  next: '<svg viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg>',
  close: '<svg viewBox="0 0 16 16"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg>',
}
$('#prev').innerHTML = ICONS.prev
$('#next').innerHTML = ICONS.next
$('#close').innerHTML = ICONS.close

const input = $('#q')

function search(forward = true, findNext = false) {
  api.dispatch({ type: 'find', text: input.value, forward, findNext })
}

function step(forward) {
  if (input.value) search(forward, true)
}

function showResult(active, matches) {
  const count = $('#count')
  count.textContent = input.value ? `${active} of ${matches}` : ''
  count.classList.toggle('none', !!input.value && matches === 0)
  $('#prev').disabled = $('#next').disabled = matches === 0
}

input.addEventListener('input', () => search())

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    step(!e.shiftKey)
  } else if (e.key === 'Escape') {
    api.dispatch({ type: 'find-close' })
  }
})

$('#bar').addEventListener('submit', (e) => e.preventDefault())
$('#prev').addEventListener('click', () => step(false))
$('#next').addEventListener('click', () => step(true))
$('#close').addEventListener('click', () => api.dispatch({ type: 'find-close' }))

api.onCommand((command) => {
  if (command.type === 'find-open') {
    if (command.text != null && command.text !== input.value) input.value = command.text
    input.focus()
    input.select()
    showResult(0, 0)
    if (input.value) search()
  }
  if (command.type === 'find-step') step(command.forward)
  if (command.type === 'find-result') showResult(command.active, command.matches)
})

showResult(0, 0)
