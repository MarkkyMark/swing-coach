import React, { useEffect, useRef, useState } from 'react'
import { fetchLibrary, uploadLibraryReference } from '../api/client'

const ANGLE_LABELS  = { dtl: 'DTL', face_on: 'Face-on' }
const HAND_LABELS   = { right: 'Right', left: 'Left' }
const GENDER_LABELS = { male: 'Male', female: 'Female' }
const CLUB_LABELS   = {
  driver: '🏌️ Driver',
  irons:  '⛳ Irons',
  wedges: '🔧 Wedges',
  putter: '🎯 Putter',
  other:  '📐 Other',
}

/**
 * Reference library browser with upload form and filtering.
 * Props:
 *   selectedId   — currently selected entry id
 *   onSelect     — (entry | null) => void
 *   filterAngle  — "dtl" | "face_on" | null
 *   filterHand   — "right" | "left" | null
 *   filterGender — "male" | "female" | null
 *   filterClub   — "driver" | "irons" | ... | null
 */
export default function LibraryBrowser({
  selectedId, onSelect,
  filterAngle, filterHand, filterGender, filterClub,
}) {
  const [entries,   setEntries]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState(null)
  const [showUpload, setShowUpload] = useState(false)
  const fileRef = useRef(null)

  // Upload form state
  const [uName,   setUName]   = useState('')
  const [uAngle,  setUAngle]  = useState('dtl')
  const [uHand,   setUHand]   = useState('right')
  const [uGender, setUGender] = useState('male')
  const [uClub,   setUClub]   = useState('driver')
  const [uDesc,   setUDesc]   = useState('')
  const [uFile,   setUFile]   = useState(null)

  // Local filters (in addition to parent-controlled props)
  const [localClubFilter, setLocalClubFilter] = useState(null)

  const load = () => {
    setLoading(true)
    fetchLibrary()
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const filtered = entries.filter(e => {
    if (filterAngle  && e.camera_angle !== filterAngle)  return false
    if (filterHand   && e.handedness   !== filterHand)   return false
    if (filterGender && e.gender       !== filterGender) return false
    const clubF = localClubFilter || filterClub
    if (clubF        && e.club_type    !== clubF)        return false
    return true
  })

  const handleUpload = async (ev) => {
    ev.preventDefault()
    if (!uFile || !uName) return
    setUploading(true); setUploadErr(null)
    try {
      const entry = await uploadLibraryReference(
        uFile, uName, uAngle, uHand, uDesc, uGender, uClub
      )
      setEntries(prev => [...prev, entry])
      setShowUpload(false)
      setUName(''); setUDesc(''); setUFile(null)
      onSelect?.(entry)
    } catch (err) {
      setUploadErr(err?.response?.data?.detail || 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-white text-sm">Reference Library</h3>
          <p className="text-xs text-gray-500">{filtered.length} swing{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => setShowUpload(v => !v)}
          className="text-xs bg-surface-700 hover:bg-surface-600 text-white px-3 py-1.5 rounded-lg transition-colors">
          {showUpload ? '✕ Cancel' : '+ Add Reference'}
        </button>
      </div>

      {/* Club type filter chips */}
      {entries.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setLocalClubFilter(null)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
              !localClubFilter ? 'border-brand-500 bg-brand-500/10 text-brand-400' : 'border-surface-600 text-gray-500'
            }`}>
            All clubs
          </button>
          {Object.entries(CLUB_LABELS).map(([val, label]) => {
            const count = entries.filter(e => e.club_type === val).length
            if (!count) return null
            return (
              <button key={val}
                onClick={() => setLocalClubFilter(localClubFilter === val ? null : val)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                  localClubFilter === val
                    ? 'border-brand-500 bg-brand-500/10 text-brand-400'
                    : 'border-surface-600 text-gray-500 hover:text-gray-300'
                }`}>
                {label} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* Upload form */}
      {showUpload && (
        <form onSubmit={handleUpload}
          className="bg-surface-800 border border-surface-600 rounded-xl p-4 space-y-3">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">
            Add Reference Swing
          </p>

          <input value={uName} onChange={e => setUName(e.target.value)}
            placeholder="Name (e.g. Tiger Woods — Driver DTL)"
            required
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2
                       text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500" />

          {/* Camera angle */}
          <ToggleRow label="Camera angle" options={[['dtl','↙ Down the Line'],['face_on','→ Face On']]} value={uAngle} onChange={setUAngle} />

          {/* Handedness */}
          <ToggleRow label="Handedness" options={[['right','Right-handed'],['left','Left-handed']]} value={uHand} onChange={setUHand} />

          {/* Gender */}
          <ToggleRow label="Gender" options={[['male','Male'],['female','Female']]} value={uGender} onChange={setUGender} />

          {/* Club type */}
          <div>
            <p className="text-xs text-gray-500 mb-1">Club type</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(CLUB_LABELS).map(([val, label]) => (
                <button type="button" key={val} onClick={() => setUClub(val)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
                    uClub === val ? 'border-brand-500 bg-brand-500/10 text-white' : 'border-surface-600 text-gray-400'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* File drop */}
          <div onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-surface-600 rounded-lg p-4 text-center cursor-pointer hover:border-gray-500">
            <input ref={fileRef} type="file" accept="video/*" className="hidden"
              onChange={e => setUFile(e.target.files[0])} />
            {uFile
              ? <p className="text-sm text-white">{uFile.name} ({(uFile.size/1e6).toFixed(1)} MB)</p>
              : <p className="text-sm text-gray-500">Click to select video</p>
            }
          </div>

          {uploadErr && (
            <p className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2">{uploadErr}</p>
          )}

          <button type="submit" disabled={!uFile || !uName || uploading}
            className="w-full py-2.5 bg-brand-500 hover:bg-brand-600 text-black font-semibold
                       text-sm rounded-xl disabled:opacity-40 transition-colors">
            {uploading ? 'Uploading & converting…' : 'Add to Library'}
          </button>
        </form>
      )}

      {/* Library grid */}
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 bg-surface-800 rounded-xl border border-surface-700">
          <p className="text-2xl mb-2">📹</p>
          <p className="text-gray-400 text-sm">
            {entries.length === 0 ? 'No reference swings yet.' : 'No matches for current filters.'}
          </p>
          {entries.length === 0 && (
            <p className="text-gray-600 text-xs mt-1">Add one using the button above.</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
          {filtered.map(entry => (
            <LibraryCard
              key={entry.id}
              entry={entry}
              selected={selectedId === entry.id}
              onClick={() => onSelect?.(selectedId === entry.id ? null : entry)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ToggleRow({ label, options, value, onChange }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
        {options.map(([val, lbl]) => (
          <button type="button" key={val} onClick={() => onChange(val)}
            className={`py-2 rounded-lg text-xs font-medium border transition-all ${
              value === val ? 'border-brand-500 bg-brand-500/10 text-white' : 'border-surface-600 text-gray-400'
            }`}>
            {lbl}
          </button>
        ))}
      </div>
    </div>
  )
}

function LibraryCard({ entry, selected, onClick }) {
  return (
    <button onClick={onClick}
      className={`text-left rounded-xl overflow-hidden border transition-all ${
        selected
          ? 'border-brand-500 bg-brand-500/5'
          : 'border-surface-700 bg-surface-800 hover:border-surface-500'
      }`}>
      {/* Thumbnail */}
      <div className="relative bg-surface-700 h-24">
        {entry.thumbnail_url ? (
          <img src={entry.thumbnail_url} alt={entry.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-2xl">🏌️</div>
        )}
        {selected && (
          <div className="absolute top-1 right-1 w-5 h-5 bg-brand-500 rounded-full flex items-center justify-center">
            <span className="text-black text-[10px] font-bold">✓</span>
          </div>
        )}
        {/* Badges */}
        <div className="absolute bottom-1 left-1 flex gap-1">
          <span className="text-[8px] bg-black/70 text-white px-1.5 py-0.5 rounded">
            {ANGLE_LABELS[entry.camera_angle] || entry.camera_angle}
          </span>
          {entry.gender && (
            <span className="text-[8px] bg-black/70 text-white px-1.5 py-0.5 rounded capitalize">
              {entry.gender}
            </span>
          )}
        </div>
        {/* Source badge top-right */}
        {entry.source === 'preloaded' && (
          <div className="absolute top-1 right-1">
            <span className="text-[8px] bg-yellow-500/90 text-black font-bold px-1.5 py-0.5 rounded">
              PRO
            </span>
          </div>
        )}
      </div>
      {/* Info */}
      <div className="px-2 py-1.5">
        <p className="text-white text-xs font-medium truncate">{entry.name}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {entry.club_type && (
            <span className="text-[9px] text-gray-500">{CLUB_LABELS[entry.club_type] || entry.club_type}</span>
          )}
          <span className="text-[9px] text-gray-600">·</span>
          <span className="text-[9px] text-gray-500">{HAND_LABELS[entry.handedness] || entry.handedness}</span>
          {entry.duration && (
            <>
              <span className="text-[9px] text-gray-600">·</span>
              <span className="text-[9px] text-gray-500">{entry.duration.toFixed(1)}s</span>
            </>
          )}
        </div>
      </div>
    </button>
  )
}
