import axios from 'axios'

const api = axios.create({ baseURL: '/api', timeout: 30_000 })

// Attach JWT from localStorage on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('sc_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Upload ────────────────────────────────────────────────────────────────

/**
 * Upload a video file with swing metadata.
 * handedness   : 'right' | 'left'  — determines which wrist is tracked in phase detection
 * camera_angle : 'dtl' | 'face_on' — informational for future angle-aware comparison
 */
export async function uploadVideo(
  file,
  proId          = 'tiger_2000',
  handedness     = 'right',
  cameraAngle    = 'dtl',
  videoRotation  = 0,
  onUploadProgress,
) {
  const form = new FormData()
  form.append('video',          file)
  form.append('pro_id',         proId)
  form.append('handedness',     handedness)
  form.append('camera_angle',   cameraAngle)
  form.append('video_rotation', String(videoRotation))
  const { data } = await api.post('/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress,
  })
  return data
}

// ── Processing ────────────────────────────────────────────────────────────

export async function startProcessing(sessionId) {
  const { data } = await api.post(`/process/${sessionId}`)
  return data
}

export async function pollStatus(sessionId) {
  const { data } = await api.get(`/status/${sessionId}`)
  return data
}

// ── Results ───────────────────────────────────────────────────────────────

export async function fetchResults(sessionId) {
  const { data } = await api.get(`/results/${sessionId}`)
  return data
}

// ── Frames ────────────────────────────────────────────────────────────────

/** All frames for a session (keypoints + angles + deviation). */
export async function fetchFrames(sessionId, phase = null) {
  const params = phase ? { phase } : {}
  const { data } = await api.get(`/frames/${sessionId}`, { params })
  return data   // { frames: [...], total: N }
}

/** One key frame per phase — lightweight, used by Compare tab. */
export async function fetchPhaseSummary(sessionId) {
  const { data } = await api.get(`/frames/${sessionId}/phase-summary`)
  return data   // { phases: [...], pro_name }
}

// ── Pro library ───────────────────────────────────────────────────────────

export async function fetchPros() {
  const { data } = await api.get('/pros')
  return data
}

export async function fetchPro(proId) {
  const { data } = await api.get(`/pro/${proId}`)
  return data   // { id, name, phases: { Address: { angles, synthetic_keypoints, notes } } }
}

// ── Auth ──────────────────────────────────────────────────────────────────

export async function signup(email, password) {
  const { data } = await api.post('/auth/signup', { email, password })
  return data   // { token, user_id, email }
}

export async function login(email, password) {
  const { data } = await api.post('/auth/login', { email, password })
  return data
}

export async function fetchMe() {
  const { data } = await api.get('/auth/me')
  return data
}

export async function fetchMySessions() {
  const { data } = await api.get('/auth/sessions')
  return data   // UserSessionSummary[]
}

// ── Reference Library ─────────────────────────────────────────────────────

export async function fetchLibrary(queryString = '') {
  const { data } = await api.get(`/library${queryString}`)
  return data   // LibraryEntry[]
}

export async function getLibraryEntry(id) {
  const { data } = await api.get(`/library/${id}`)
  return data   // LibraryEntry
}

/** Upload a new reference video to the library. */
export async function uploadLibraryReference(
  file, name, cameraAngle, handedness, description = '',
  gender = 'male', clubType = 'driver',
) {
  const form = new FormData()
  form.append('video',        file)
  form.append('name',         name)
  form.append('camera_angle', cameraAngle)
  form.append('handedness',   handedness)
  form.append('gender',       gender)
  form.append('club_type',    clubType)
  form.append('description',  description)
  const { data } = await api.post('/library/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120_000,
  })
  return data   // LibraryEntry
}

export async function deleteLibraryEntry(id) {
  await api.delete(`/library/${id}`)
}

/** Update editable metadata fields for a library entry. */
export async function updateLibraryEntry(id, fields) {
  const { data } = await api.patch(`/library/${id}`, fields)
  return data   // updated LibraryEntry
}

/** Get saved phase timestamps for a library entry. */
export async function getLibraryPhaseTimes(entryId) {
  const { data } = await api.get(`/library/${entryId}/phases`)
  return data   // { entry_id, phase_times: {...}, count }
}

/** Persist phase timestamps for a library entry. */
export async function saveLibraryPhaseTimes(entryId, phaseTimes) {
  const { data } = await api.post(`/library/${entryId}/phases`, { phase_times: phaseTimes })
  return data
}

// ── Frame Selection ────────────────────────────────────────────────────────

/**
 * Get session info — returns video_url (with real extension), handedness, camera_angle.
 * Used by FrameSelectionPage on mount to recover video URL without guessing the extension.
 */
export async function getSessionInfo(sessionId) {
  const { data } = await api.get(`/sessions/${sessionId}/info`)
  return data   // { session_id, video_url, handedness, camera_angle, pro_id }
}

/** Save frame time assignments for a session. */
export async function saveFrameSelection(sessionId, selection) {
  const { data } = await api.post(`/sessions/${sessionId}/frame-selection`, selection)
  return data
}

/** Get current frame selection for a session. */
export async function getFrameSelection(sessionId) {
  const { data } = await api.get(`/sessions/${sessionId}/frame-selection`)
  return data
}

/** Remove a saved swing from the user's My Swings. */
export async function deleteSwingFromMySwings(sessionId) {
  const { data } = await api.delete(`/sessions/${sessionId}/save`)
  return data
}

/** Explicitly save a completed comparison to the logged-in user's My Swings. */
export async function saveSwingToMySwings(sessionId) {
  const { data } = await api.post(`/sessions/${sessionId}/save`)
  return data   // { status: "saved", session_id }
}

/** Trigger phase comparison analysis on selected frames. */
export async function startComparison(sessionId) {
  const { data } = await api.post(`/sessions/${sessionId}/compare`)
  return data
}

/** Retrieve comparison result (may return 202 while still analyzing). */
export async function fetchComparison(sessionId) {
  const { data } = await api.get(`/sessions/${sessionId}/comparison`)
  return data   // SwingComparisonResult
}

// ── SSE ───────────────────────────────────────────────────────────────────

export function subscribeToProgress(sessionId, onEvent, onError) {
  const es = new EventSource(`/api/progress/${sessionId}`)
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      onEvent(data)
      if (data.status === 'complete' || data.status === 'failed') es.close()
    } catch { /* ignore */ }
  }
  es.onerror = (err) => { es.close(); onError?.(err) }
  return () => es.close()
}
