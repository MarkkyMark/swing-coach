import React, { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  deleteLibraryEntry, fetchLibrary,
  updateLibraryEntry, uploadLibraryReference,
} from '../api/client'

const ANGLE_OPTIONS  = [['dtl', '↙ Down the Line'], ['face_on', '→ Face On']]
const HAND_OPTIONS   = [['right', 'Right-handed'], ['left', 'Left-handed']]
const GENDER_OPTIONS = [['male', 'Male'], ['female', 'Female']]
const CLUB_OPTIONS   = [
  ['driver',  '🏌️ Driver'],
  ['irons',   '⛳ Irons'],
  ['wedges',  '🔧 Wedges'],
  ['putter',  '🎯 Putter'],
  ['other',   '📐 Other'],
]

export default function LibraryPage() {
  const navigate = useNavigate()
  const [entries,     setEntries]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [showAdd,     setShowAdd]     = useState(false)
  const [sourceTab,   setSourceTab]   = useState('all')  // 'all'|'preloaded'|'user'

  const load = (src = sourceTab) => {
    setLoading(true)
    const params = src !== 'all' ? `?source=${src}` : ''
    fetchLibrary(params)
      .then(setEntries)
      .catch(e => setError(e?.response?.data?.detail || 'Could not load library.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleTabChange = (tab) => {
    setSourceTab(tab)
    load(tab)
  }

  const handleUpdated = (updated) => {
    setEntries(prev => prev.map(e => e.id === updated.id ? updated : e))
  }

  const handleDeleted = (id) => {
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  const handleAdded = (entry) => {
    setEntries(prev => [...prev, entry])
    setShowAdd(false)
  }

  return (
    <div className="min-h-screen bg-surface-900">
      {/* Header */}
      <header className="border-b border-surface-700 bg-surface-900/90 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2 text-white hover:text-brand-400 transition-colors">
              <span className="text-2xl">⛳</span>
              <span className="font-bold">Swing Coach</span>
            </Link>
            <span className="text-gray-600">/</span>
            <span className="text-gray-300 font-medium">Reference Library</span>
          </div>
          <button
            onClick={() => setShowAdd(v => !v)}
            className={`text-sm font-semibold px-4 py-2 rounded-xl transition-colors ${
              showAdd
                ? 'bg-surface-700 text-white'
                : 'bg-brand-500 hover:bg-brand-600 text-black'
            }`}
          >
            {showAdd ? '✕ Cancel' : '+ Add Reference'}
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">

        {/* Add form */}
        {showAdd && (
          <AddEntryForm onAdded={handleAdded} onCancel={() => setShowAdd(false)} />
        )}

        {/* ── Source filter tabs ── */}
        <div className="flex gap-1 bg-surface-800 rounded-xl p-1 self-start">
          {[
            { id: 'all',        label: 'All' },
            { id: 'preloaded',  label: '🏆 Pro Library' },
            { id: 'user',       label: '📤 Your Uploads' },
          ].map(tab => (
            <button key={tab.id} onClick={() => handleTabChange(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                sourceTab === tab.id
                  ? 'bg-surface-700 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* State */}
        {loading && (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="text-red-400 bg-red-900/20 border border-red-800 rounded-xl p-4">{error}</div>
        )}

        {!loading && entries.length === 0 && !error && (
          <div className="text-center py-24 space-y-3">
            <div className="text-6xl">📹</div>
            <p className="text-gray-400 text-lg">No reference swings yet.</p>
            <button onClick={() => setShowAdd(true)} className="text-brand-400 hover:underline text-sm">
              Add your first reference →
            </button>
          </div>
        )}

        {/* Entry list */}
        {!loading && entries.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-4 font-medium">
              {entries.length} reference swing{entries.length !== 1 ? 's' : ''}
            </p>
            <div className="space-y-3">
              {entries.map(entry => (
                <LibraryEntryCard
                  key={entry.id}
                  entry={entry}
                  onUpdated={handleUpdated}
                  onDeleted={() => handleDeleted(entry.id)}
                />
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

// ── Individual entry card with inline edit ────────────────────────────────

function LibraryEntryCard({ entry, onUpdated, onDeleted }) {
  const [editing,       setEditing]       = useState(false)
  const [saving,        setSaving]        = useState(false)
  const [deleting,      setDeleting]      = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error,         setError]         = useState(null)

  // Edit form state
  const [name,        setName]        = useState(entry.name)
  const [cameraAngle, setCameraAngle] = useState(entry.camera_angle)
  const [handedness,  setHandedness]  = useState(entry.handedness)
  const [gender,      setGender]      = useState(entry.gender ?? 'male')
  const [clubType,    setClubType]    = useState(entry.club_type ?? 'driver')
  const [description, setDescription] = useState(entry.description ?? '')

  const resetForm = () => {
    setName(entry.name); setCameraAngle(entry.camera_angle)
    setHandedness(entry.handedness); setGender(entry.gender ?? 'male')
    setClubType(entry.club_type ?? 'driver'); setDescription(entry.description ?? '')
  }

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required.'); return }
    setSaving(true); setError(null)
    try {
      const updated = await updateLibraryEntry(entry.id, {
        name: name.trim(), camera_angle: cameraAngle, handedness,
        gender, club_type: clubType, description,
      })
      onUpdated(updated)
      setEditing(false)
    } catch (e) {
      setError(e?.response?.data?.detail || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await deleteLibraryEntry(entry.id)
      onDeleted()
    } catch (e) {
      setError(e?.response?.data?.detail || 'Delete failed.')
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  return (
    <div className="bg-surface-800 border border-surface-700 rounded-2xl overflow-hidden">
      {/* ── Card row ── */}
      <div className="flex items-start gap-4 p-4">
        {/* Thumbnail */}
        <div className="w-24 h-32 bg-surface-700 rounded-xl overflow-hidden flex-shrink-0">
          {entry.thumbnail_url ? (
            <img src={entry.thumbnail_url} alt={entry.name}
              className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-2xl">🏌️</div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 space-y-2">
          <h3 className="text-white font-bold text-lg leading-tight">{entry.name}</h3>

          <div className="flex flex-wrap gap-2">
            {[
              entry.camera_angle === 'dtl' ? 'Down the Line' : 'Face On',
              entry.handedness === 'right' ? 'Right-handed' : 'Left-handed',
              entry.gender === 'male' ? 'Male' : 'Female',
              CLUB_OPTIONS.find(([v]) => v === entry.club_type)?.[1] ?? entry.club_type,
            ].filter(Boolean).map(tag => (
              <span key={tag}
                className="text-xs bg-surface-700 text-gray-300 px-2.5 py-1 rounded-full">
                {tag}
              </span>
            ))}
          </div>

          {entry.description && (
            <p className="text-gray-400 text-sm">{entry.description}</p>
          )}

          <div className="flex items-center gap-3 text-xs text-gray-500">
            {entry.duration && <span>{entry.duration.toFixed(1)}s</span>}
            {entry.fps && <span>{entry.fps.toFixed(0)} fps</span>}
            {entry.phase_times && (
              <span className={Object.keys(entry.phase_times).length >= 8 ? 'text-green-400' : 'text-yellow-500'}>
                {Object.keys(entry.phase_times).length}/8 phase points saved
              </span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-2 flex-shrink-0">
          <button
            onClick={() => { setEditing(v => !v); if (editing) resetForm(); setError(null) }}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors font-medium ${
              editing
                ? 'border-surface-500 text-white bg-surface-700'
                : 'border-surface-600 text-gray-400 hover:text-white hover:border-gray-500'
            }`}
          >
            {editing ? '✕ Cancel' : '✏ Edit'}
          </button>

          {confirmDelete ? (
            <div className="flex gap-1.5 items-center">
              <button onClick={handleDelete} disabled={deleting}
                className="text-xs bg-red-900/40 hover:bg-red-900/70 text-red-400
                           border border-red-800 px-2.5 py-1.5 rounded-lg transition-colors">
                {deleting ? '…' : 'Delete'}
              </button>
              <button onClick={() => setConfirmDelete(false)}
                className="text-xs text-gray-500 hover:text-white px-1.5">
                No
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs px-3 py-1.5 rounded-lg border border-surface-600
                         text-gray-500 hover:text-red-400 hover:border-red-800 transition-colors"
            >
              🗑 Delete
            </button>
          )}
        </div>
      </div>

      {/* ── Inline edit form ── */}
      {editing && (
        <div className="border-t border-surface-700 bg-surface-900/50 p-5 space-y-4">
          {error && (
            <p className="text-red-400 text-xs bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {/* Name */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-surface-800 border border-surface-600 rounded-xl px-4 py-2.5
                         text-white placeholder-gray-600 focus:outline-none focus:border-brand-500 text-sm"
              placeholder="e.g. Tiger Woods — Driver DTL"
            />
          </div>

          {/* Camera angle */}
          <EditToggleRow label="Camera angle" options={ANGLE_OPTIONS}  value={cameraAngle}  onChange={setCameraAngle} />
          <EditToggleRow label="Handedness"   options={HAND_OPTIONS}   value={handedness}   onChange={setHandedness} />
          <EditToggleRow label="Gender"       options={GENDER_OPTIONS} value={gender}       onChange={setGender} />

          {/* Club type */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Club type</label>
            <div className="flex flex-wrap gap-2">
              {CLUB_OPTIONS.map(([val, label]) => (
                <button key={val} type="button" onClick={() => setClubType(val)}
                  className={`text-xs px-3 py-1.5 rounded-xl border font-medium transition-all ${
                    clubType === val
                      ? 'border-brand-500 bg-brand-500/10 text-white'
                      : 'border-surface-600 text-gray-400 hover:text-white'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Description (optional)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="w-full bg-surface-800 border border-surface-600 rounded-xl px-4 py-2.5
                         text-white placeholder-gray-600 focus:outline-none focus:border-brand-500 text-sm resize-none"
              placeholder="Notes about this swing…"
            />
          </div>

          {/* Save */}
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="px-5 py-2 bg-brand-500 hover:bg-brand-600 text-black font-semibold
                         text-sm rounded-xl transition-colors disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button
              onClick={() => { setEditing(false); resetForm(); setError(null) }}
              className="px-4 py-2 text-gray-400 hover:text-white text-sm border border-surface-600
                         rounded-xl transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Reusable toggle row for edit form ─────────────────────────────────────

function EditToggleRow({ label, options, value, onChange }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1.5">{label}</label>
      <div className="flex gap-2">
        {options.map(([val, lbl]) => (
          <button key={val} type="button" onClick={() => onChange(val)}
            className={`px-3 py-1.5 rounded-xl border text-xs font-medium transition-all ${
              value === val
                ? 'border-brand-500 bg-brand-500/10 text-white'
                : 'border-surface-600 text-gray-400 hover:text-white'
            }`}>
            {lbl}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Add new entry form ─────────────────────────────────────────────────────

function AddEntryForm({ onAdded, onCancel }) {
  const [name,        setName]        = useState('')
  const [cameraAngle, setCameraAngle] = useState('dtl')
  const [handedness,  setHandedness]  = useState('right')
  const [gender,      setGender]      = useState('male')
  const [clubType,    setClubType]    = useState('driver')
  const [description, setDescription] = useState('')
  const [file,        setFile]        = useState(null)
  const [uploading,   setUploading]   = useState(false)
  const [error,       setError]       = useState(null)
  const fileRef = useRef(null)

  const handleUpload = async (e) => {
    e.preventDefault()
    if (!file || !name.trim()) { setError('Name and video are required.'); return }
    setUploading(true); setError(null)
    try {
      const entry = await uploadLibraryReference(
        file, name.trim(), cameraAngle, handedness, description, gender, clubType
      )
      onAdded(entry)
    } catch (err) {
      setError(err?.response?.data?.detail || 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <form onSubmit={handleUpload}
      className="bg-surface-800 border border-brand-500/30 rounded-2xl p-6 space-y-5">
      <h2 className="text-white font-bold text-lg">Add Reference Swing</h2>

      {error && (
        <p className="text-red-400 text-xs bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{error}</p>
      )}

      <div>
        <label className="block text-xs text-gray-400 mb-1">Name *</label>
        <input value={name} onChange={e => setName(e.target.value)} required
          placeholder="e.g. Tiger Woods — Driver DTL"
          className="w-full bg-surface-700 border border-surface-600 rounded-xl px-4 py-2.5
                     text-white placeholder-gray-600 focus:outline-none focus:border-brand-500 text-sm" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <EditToggleRow label="Camera angle" options={ANGLE_OPTIONS}  value={cameraAngle}  onChange={setCameraAngle} />
        <EditToggleRow label="Handedness"   options={HAND_OPTIONS}   value={handedness}   onChange={setHandedness} />
        <EditToggleRow label="Gender"       options={GENDER_OPTIONS} value={gender}       onChange={setGender} />
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Club type</label>
          <div className="flex flex-wrap gap-1.5">
            {CLUB_OPTIONS.map(([val, lbl]) => (
              <button key={val} type="button" onClick={() => setClubType(val)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
                  clubType === val ? 'border-brand-500 bg-brand-500/10 text-white' : 'border-surface-600 text-gray-400'
                }`}>{lbl}</button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1">Description (optional)</label>
        <input value={description} onChange={e => setDescription(e.target.value)}
          placeholder="Notes about this reference swing…"
          className="w-full bg-surface-700 border border-surface-600 rounded-xl px-4 py-2.5
                     text-white placeholder-gray-600 focus:outline-none focus:border-brand-500 text-sm" />
      </div>

      <div onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed border-surface-600 hover:border-gray-500 rounded-xl p-5
                   text-center cursor-pointer transition-colors">
        <input ref={fileRef} type="file" accept="video/*" className="hidden"
          onChange={e => setFile(e.target.files[0])} />
        {file ? (
          <div>
            <p className="text-white font-medium text-sm">{file.name}</p>
            <p className="text-gray-500 text-xs">{(file.size / 1e6).toFixed(1)} MB</p>
          </div>
        ) : (
          <div>
            <p className="text-2xl mb-1">🎥</p>
            <p className="text-gray-400 text-sm">Click to select video</p>
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <button type="submit" disabled={!file || !name.trim() || uploading}
          className="px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-black font-semibold
                     text-sm rounded-xl transition-colors disabled:opacity-40">
          {uploading ? 'Uploading & converting…' : 'Add to Library'}
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-2.5 text-gray-400 hover:text-white text-sm border border-surface-600
                     rounded-xl transition-colors">
          Cancel
        </button>
      </div>
    </form>
  )
}
