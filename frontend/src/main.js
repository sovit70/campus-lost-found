import './style.css'

const API_BASE_URL = 'https://8pw0ka9a39.execute-api.ap-south-1.amazonaws.com'
const maxPhotoBytes = 5 * 1024 * 1024
const allowedPhotoTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
let reports = []
let activeFilter = 'all'
let searchTerm = ''

document.querySelector('#app').innerHTML = `
  <header class="site-header"><a class="brand" href="#top" aria-label="Campus Lost and Found home"><span class="brand-mark">LF</span><span><strong>Campus</strong> Lost &amp; Found</span></a><nav class="main-nav" aria-label="Main navigation"><a href="#browse">Browse items</a><a href="#report" class="nav-cta">Report an item <span aria-hidden="true">+</span></a></nav></header>
  <main id="top">
    <section class="hero" aria-labelledby="hero-title"><div class="hero-copy"><p class="eyebrow"><span class="eyebrow-dot"></span> Your campus, connected</p><h1 id="hero-title">Lost something?<br /><em>Found something?</em></h1><p class="hero-text">A simple, student-powered way to reunite belongings with the people who miss them.</p><a class="button button-light" href="#report">Report an item <span aria-hidden="true">&#8599;</span></a></div><div class="hero-art" aria-hidden="true"><div class="art-sun"></div><div class="art-card art-card-back"><span class="tiny-label">FOUND</span><span class="art-line"></span><span class="art-line short"></span></div><div class="art-card art-card-front"><span class="card-pin">+</span><span class="tiny-label">CAMPUS ID</span><strong>Take care<br />of each other.</strong><span class="art-line"></span></div><span class="art-note">Still looking</span></div></section>
    <section class="browse-section section-shell" id="browse" aria-labelledby="browse-title"><div class="section-heading"><div><p class="eyebrow">The community board</p><h2 id="browse-title">Browse reports</h2></div><p class="temporary-note" id="board-status" role="status" aria-live="polite"><span class="status-dot"></span> Loading items...</p></div><div class="controls"><label class="search-box"><span aria-hidden="true">⌕</span><input id="search-input" type="search" placeholder="Search by item, place or category..." aria-label="Search reports" /></label><div class="filter-group" aria-label="Filter reports by type"><button class="filter-button is-active" data-filter="all" type="button">All items</button><button class="filter-button" data-filter="lost" type="button"><span class="filter-dot lost-dot"></span>Lost</button><button class="filter-button" data-filter="found" type="button"><span class="filter-dot found-dot"></span>Found</button></div></div><div class="report-grid" id="report-grid"></div><p class="empty-state" id="empty-state" hidden>No reports match that search. Try a different word or filter.</p></section>
    <section class="report-section" id="report" aria-labelledby="report-title"><div class="section-shell report-layout"><div class="report-intro"><p class="eyebrow">Help make the connection</p><h2 id="report-title">Report an item</h2><p>Every detail helps. Add what you know and someone from campus may be looking for it right now.</p><div class="intro-rule"></div><span class="intro-caption" id="form-status" role="status" aria-live="polite">No account needed · Always free</span></div><form class="report-form" id="report-form"><div class="form-row two-col"><label>Item name <input name="name" required placeholder="e.g. Black leather wallet" /></label><label>Type <select name="type" required><option value="lost">I lost it</option><option value="found">I found it</option></select></label></div><div class="form-row two-col"><label>Category <select name="category" required><option value="Personal items">Personal items</option><option value="Electronics">Electronics</option><option value="Bags">Bags</option><option value="Clothing">Clothing</option><option value="Keys & cards">Keys &amp; cards</option><option value="Other">Other</option></select></label><label>Where? <input name="location" required placeholder="e.g. Science building, room 204" /></label></div><label>Description <textarea name="description" required rows="3" placeholder="Colour, brand, distinguishing details..."></textarea></label><div class="form-row two-col"><label>Contact email <input name="email" type="email" required placeholder="you@campus.edu" /></label><label class="file-label">Photo <span class="optional">(optional)</span><input id="photo-input" name="photo" type="file" accept="image/*" /><span class="file-picker"><span aria-hidden="true">+</span> Add a photo</span></label></div><div class="form-actions"><p>By submitting, you agree to share these details with the campus community.</p><button class="button button-dark" type="submit">Post report <span aria-hidden="true">&#8599;</span></button></div></form></div></section>
  </main><footer class="site-footer section-shell"><span class="brand-mark small">LF</span><span>Built for a more thoughtful campus.</span><span class="footer-reset">Data is temporary and resets when this page reloads.</span></footer>
`

const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
const formatDate = (createdAt) => {
  if (!createdAt) return 'Recently'
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(createdAt))
}

const toReport = (item) => ({
  ...item,
  email: item.contactEmail,
  photo: item.photoUrl,
  date: formatDate(item.createdAt),
})

const setBoardStatus = (message, isError = false) => {
  const status = document.querySelector('#board-status')
  status.innerHTML = `<span class="status-dot"></span> ${escapeHtml(message)}`
  status.dataset.error = isError ? 'true' : 'false'
}

const readPhoto = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.addEventListener('load', () => resolve(String(reader.result)))
  reader.addEventListener('error', () => reject(new Error('Unable to read the selected photo.')))
  reader.readAsDataURL(file)
})

const uploadPhoto = async (file) => {
  if (!allowedPhotoTypes.has(file.type)) throw new Error('Please choose a JPG, PNG, WEBP, or GIF photo.')
  if (file.size > maxPhotoBytes) throw new Error('Photo must be 5 MB or smaller.')
  const dataUrl = await readPhoto(file)
  const response = await fetch(`${API_BASE_URL}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType: file.type, fileName: file.name, data: dataUrl.split(',')[1] }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Unable to upload the photo.')
  return data
}

const photoInput = document.querySelector('#photo-input')
const photoPicker = document.querySelector('.file-picker')
photoInput.addEventListener('change', async () => {
  const file = photoInput.files?.[0]
  if (!file) {
    photoPicker.innerHTML = '<span aria-hidden="true">+</span> Add a photo'
    return
  }
  try {
    if (!allowedPhotoTypes.has(file.type)) throw new Error('Please choose a JPG, PNG, WEBP, or GIF photo.')
    if (file.size > maxPhotoBytes) throw new Error('Photo must be 5 MB or smaller.')
    const preview = await readPhoto(file)
    photoPicker.innerHTML = `<img src="${preview}" alt="Selected photo preview" style="max-width: 100%; max-height: 90px; object-fit: contain;" />`
  } catch (error) {
    photoInput.value = ''
    photoPicker.textContent = error.message
    document.querySelector('#form-status').textContent = error.message
  }
})

function renderReports() {
  const query = searchTerm.trim().toLowerCase()
  const visibleReports = reports.filter((report) => { const matchesFilter = activeFilter === 'all' || report.type === activeFilter; const searchable = `${report.name} ${report.category} ${report.location} ${report.description}`.toLowerCase(); return matchesFilter && searchable.includes(query) })
  document.querySelector('#report-grid').innerHTML = visibleReports.map((report) => `<article class="report-card ${report.type}">${report.photo ? `<img class="report-photo" src="${report.photo}" alt="Photo of ${escapeHtml(report.name)}" />` : '<div class="report-placeholder" aria-hidden="true"><span>LF</span></div>'}<div class="card-body"><div class="card-topline"><span class="type-label"><span class="type-dot"></span>${report.type === 'lost' ? 'Lost item' : 'Found item'}</span><span class="card-date">${escapeHtml(report.date)}</span></div><h3>${escapeHtml(report.name)}</h3><p class="card-location"><span aria-hidden="true">&#9678;</span> ${escapeHtml(report.location)}</p><p class="card-description">${escapeHtml(report.description)}</p><div class="card-footer"><span>${escapeHtml(report.category)}</span><a href="mailto:${escapeHtml(report.email)}">Contact <span aria-hidden="true">&#8599;</span></a></div></div></article>`).join('')
  document.querySelectorAll('.report-photo').forEach((image) => image.addEventListener('error', () => {
    const placeholder = document.createElement('div')
    placeholder.className = 'report-placeholder'
    placeholder.setAttribute('aria-hidden', 'true')
    placeholder.innerHTML = '<span>LF</span>'
    image.replaceWith(placeholder)
  }, { once: true }))
  document.querySelector('#empty-state').hidden = visibleReports.length > 0
}

async function loadReports() {
  setBoardStatus('Loading items...')
  try {
    const response = await fetch(`${API_BASE_URL}/items`)
    if (!response.ok) throw new Error(`Request failed with status ${response.status}`)
    const data = await response.json()
    reports = Array.isArray(data.items) ? data.items.map(toReport) : []
    setBoardStatus(`${reports.length} item${reports.length === 1 ? '' : 's'} on the board`)
    renderReports()
  } catch (error) {
    console.error('Unable to load reports', error)
    setBoardStatus('Unable to load items. Please refresh and try again.', true)
    document.querySelector('#report-grid').innerHTML = ''
    document.querySelector('#empty-state').hidden = false
    document.querySelector('#empty-state').textContent = 'The board is temporarily unavailable. Please try again shortly.'
  }
}

document.querySelector('#search-input').addEventListener('input', (event) => { searchTerm = event.target.value; renderReports() })
document.querySelectorAll('.filter-button').forEach((button) => button.addEventListener('click', () => { activeFilter = button.dataset.filter; document.querySelectorAll('.filter-button').forEach((item) => item.classList.toggle('is-active', item === button)); renderReports() }))
document.querySelector('#report-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const form = event.currentTarget
  const submitButton = form.querySelector('button[type="submit"]')
  const formStatus = document.querySelector('#form-status')
  const formData = new FormData(form)
  const file = formData.get('photo')
  let photoUrl = ''

  submitButton.disabled = true
  submitButton.textContent = 'Posting...'
  formStatus.textContent = 'Sending your report...'
  try {
    if (file && file.size) {
      formStatus.textContent = 'Uploading your photo...'
      const upload = await uploadPhoto(file)
      photoUrl = upload.key || upload.photoUrl || ''
    }
    const payload = { type: formData.get('type'), name: formData.get('name'), category: formData.get('category'), location: formData.get('location'), description: formData.get('description'), contactEmail: formData.get('email'), photoUrl }
    formStatus.textContent = 'Saving your report...'
    const response = await fetch(`${API_BASE_URL}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.message || 'The report could not be submitted.')
    form.reset()
    photoPicker.innerHTML = '<span aria-hidden="true">+</span> Add a photo'
    activeFilter = 'all'; searchTerm = ''; document.querySelector('#search-input').value = ''
    document.querySelectorAll('.filter-button').forEach((item) => item.classList.toggle('is-active', item.dataset.filter === 'all'))
    formStatus.textContent = 'Your report is now on the board.'
    document.querySelector('#report-grid').scrollIntoView({ behavior: 'smooth', block: 'start' })
    await loadReports()
  } catch (error) {
    console.error('Unable to submit report', error)
    formStatus.textContent = error.message || 'Unable to submit your report. Please try again.'
  } finally {
    submitButton.disabled = false
    submitButton.innerHTML = 'Post report <span aria-hidden="true">&#8599;</span>'
  }
})

renderReports()
loadReports()
