import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { uploadVideo } from '../api/client'
import LibraryBrowser from '../components/LibraryBrowser'
import useAnalysisStore from '../store/analysisStore'
import useAuthStore from '../store/authStore'

/**
 * Upload page — primary entry point for the manual comparison flow.
 *
 * Flow:
 *   1. User uploads their swing video
 *   2. User selects a reference swing from the library (optional)
 *   3. User sets handedness + camera angle + video rotation
 *   4. Click "Continue to Frame Selection" → /frame-selection/:sessionId?ref=...
 */
export default function UploadPage() {
  const navigate = useNavigate()
  const { user, clearAuth } = useAuthStore()
  const { uploadProgress, setUploaded, setUploadProgress, reset } = useAnalysisStore()

  const [file,          setFile]         = useState(null)
  const [preview,       setPreview]      = useState(null)
  const [error,         setError]        = useState(null)
  const [dragOver,      setDragOver]     = useState(false)
  const [uploading,     setUploading]    = useState(false)

  // Metadata
  const [handedness,    setHandedness]   = useState('right')
  const [cameraAngle,   setCameraAngle]  = useState('dtl')
  const [gender,        setGender]       = useState('male')
  const [clubType,      setClubType]     = useState('driver')
  const [videoRotation, setRotation]     = useState(0)

  // Reference selection from library
  const [selectedRef, setSelectedRef]    = useState(null)   // LibraryEntry | null

  const inputRef = useRef(null)

  useEffect(() => {
    reset()
  }, [])

  useEffect(() => {
    if (!file) { setPreview(null); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f?.type.startsWith('video/')) setFile(f)
    else setError('Please drop a valid video file.')
  }, [])

  const handleContinue = async () => {
    if (!file) return
    setError(null); setUploading(true)

    try {
      const { session_id, video_url } = await uploadVideo(
        file,
        selectedRef?.id ?? 'none',   // pro_id still needed for schema
        handedness,
        cameraAngle,
        videoRotation,
        (evt) => setUploadProgress(Math.round((evt.loaded / evt.total) * 100)),
      )
      setUploaded(session_id, null)

      const params = new URLSearchParams({
        hand:      handedness,
        cam:       cameraAngle,
        gender,
        club:      clubType,
        videoUrl:  video_url,
        ...(selectedRef ? { ref: selectedRef.id } : {}),
      })
      navigate(`/frame-selection/${session_id}?${params}`)
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  const isUploading = uploading || (uploadProgress > 0 && uploadProgress < 100)

  return (
    <div className="min-h-screen bg-surface-900 pb-16">
      {/* ── Auth nav ── */}
      <div className="fixed top-4 right-4 flex items-center gap-2 z-10">
        {user ? (
          <>
            <Link to="/library" className="text-xs text-gray-400 hover:text-white border border-surface-600 px-3 py-1.5 rounded-lg">Library</Link>
            <Link to="/swings"  className="text-xs text-gray-400 hover:text-white border border-surface-600 px-3 py-1.5 rounded-lg">My Swings</Link>
            <button onClick={clearAuth} className="text-xs text-gray-500 hover:text-red-400 border border-surface-600 px-3 py-1.5 rounded-lg">Sign out</button>
          </>
        ) : (
          <>
            <Link to="/login"  className="text-xs text-gray-400 hover:text-white border border-surface-600 px-3 py-1.5 rounded-lg">Sign in</Link>
            <Link to="/signup" className="text-xs bg-brand-500 hover:bg-brand-600 text-black font-semibold px-3 py-1.5 rounded-lg">Sign up</Link>
          </>
        )}
      </div>

      <div className="max-w-5xl mx-auto px-4 pt-12">
        {/* ── Header ── */}
        <div className="text-center mb-10">
          <div className="text-5xl mb-3">⛳</div>
          <h1 className="text-4xl font-bold tracking-tight mb-2">Swing Coach</h1>
          <p className="text-gray-400">Frame-accurate golf swing comparison</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── LEFT: Your Swing ── */}
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
              1. Your Swing Video
            </h2>

            {/* Drop zone */}
            <div
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => !file && inputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer ${
                dragOver ? 'border-brand-500 bg-brand-500/10' :
                file      ? 'border-surface-600 bg-surface-800' :
                            'border-surface-600 bg-surface-800 hover:border-gray-500'
              }`}
            >
              <input ref={inputRef} type="file" accept="video/*" className="hidden"
                onChange={e => { setFile(e.target.files[0]); setRotation(0) }} />

              {file ? (
                <div className="space-y-3">
                  {preview && (
                    <div className="flex justify-center overflow-hidden" style={{ maxHeight: 200 }}>
                      <video src={preview} muted
                        style={{
                          transform: `rotate(${videoRotation}deg)`,
                          maxHeight: videoRotation % 180 === 0 ? '190px' : '130px',
                          transition: 'transform 0.25s ease',
                        }}
                        className="rounded-lg object-contain"
                      />
                    </div>
                  )}
                  {/* Rotation controls */}
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500">Sideways?</span>
                    <button onClick={e => { e.stopPropagation(); setRotation(r => (r + 90) % 360) }}
                      className="text-xs bg-surface-700 hover:bg-surface-600 text-white px-2 py-1 rounded">↻ CW</button>
                    <button onClick={e => { e.stopPropagation(); setRotation(r => (r + 270) % 360) }}
                      className="text-xs bg-surface-700 hover:bg-surface-600 text-white px-2 py-1 rounded">↺ CCW</button>
                    {videoRotation !== 0 && (
                      <button onClick={e => { e.stopPropagation(); setRotation(0) }}
                        className="text-xs text-gray-500 hover:text-white underline">
                        Reset ({videoRotation}°)
                      </button>
                    )}
                  </div>
                  <p className="text-white text-sm font-medium">{file.name}</p>
                  <p className="text-gray-500 text-xs">{(file.size/1e6).toFixed(1)} MB{videoRotation ? ` · +${videoRotation}°` : ''}</p>
                  <button onClick={e => { e.stopPropagation(); setFile(null); setRotation(0) }}
                    className="text-xs text-gray-500 hover:text-red-400 underline">Remove</button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-3xl">🎥</div>
                  <p className="text-white text-sm font-medium">Drop your swing video here</p>
                  <p className="text-gray-500 text-xs">MP4, MOV, up to 90s</p>
                </div>
              )}
            </div>

            {/* Metadata */}
            <div className="space-y-3">
              <h3 className="text-xs text-gray-500 uppercase tracking-wider">Your Details</h3>

              {/* Handedness */}
              <MetaRow label="Handedness"
                options={[['right','Right-handed'],['left','Left-handed']]}
                value={handedness} onChange={setHandedness} />

              {/* Gender */}
              <MetaRow label="Gender"
                options={[['male','Male'],['female','Female']]}
                value={gender} onChange={setGender} />

              {/* Camera angle */}
              <MetaRow label="Camera angle"
                options={[['dtl','↙ Down the Line'],['face_on','→ Face On']]}
                value={cameraAngle} onChange={setCameraAngle} />

              {/* Club type */}
              <div>
                <p className="text-xs text-gray-500 mb-1.5">Club</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    ['driver','🏌️ Driver'],
                    ['irons','⛳ Irons'],
                    ['wedges','🔧 Wedges'],
                    ['putter','🎯 Putter'],
                  ].map(([v, l]) => (
                    <button key={v} onClick={() => setClubType(v)}
                      className={`px-3 py-1.5 rounded-xl border text-xs font-medium transition-all ${
                        clubType === v
                          ? 'border-brand-500 bg-brand-500/10 text-white'
                          : 'border-surface-600 bg-surface-800 text-gray-400'
                      }`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT: Reference Library ── */}
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
              2. Reference Swing (optional)
            </h2>

            {selectedRef && (
              <div className="flex items-center gap-3 bg-brand-500/10 border border-brand-500/30 rounded-xl px-4 py-2.5">
                <span className="text-brand-400 text-lg">✓</span>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{selectedRef.name}</p>
                  <p className="text-gray-400 text-xs">{selectedRef.camera_angle?.toUpperCase()} · {selectedRef.handedness}</p>
                </div>
                <button onClick={() => setSelectedRef(null)} className="text-gray-500 hover:text-red-400 text-sm">✕</button>
              </div>
            )}

            <LibraryBrowser
              selectedId={selectedRef?.id}
              onSelect={(entry) => setSelectedRef(entry)}
              filterAngle={cameraAngle}
              filterGender={gender}
            />

            {!selectedRef && (
              <p className="text-xs text-gray-600 text-center">
                No reference required — you can still analyze your swing solo.
              </p>
            )}
          </div>
        </div>

        {/* ── Upload progress ── */}
        {isUploading && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>Uploading…</span><span>{uploadProgress}%</span>
            </div>
            <div className="h-1.5 bg-surface-600 rounded-full overflow-hidden">
              <div className="h-full bg-brand-500 transition-all" style={{ width: `${uploadProgress}%` }} />
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="mt-4 bg-red-900/30 border border-red-700 text-red-400 rounded-xl px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {/* ── CTA ── */}
        <div className="mt-6 space-y-3">
          <button
            onClick={handleContinue}
            disabled={!file || isUploading}
            className={`w-full py-4 rounded-2xl font-bold text-lg transition-all ${
              file && !isUploading
                ? 'bg-brand-500 hover:bg-brand-600 text-black'
                : 'bg-surface-700 text-gray-600 cursor-not-allowed'
            }`}
          >
            {isUploading
              ? 'Uploading…'
              : `Continue to Frame Selection ${selectedRef ? '(with reference)' : ''} →`
            }
          </button>

          <p className="text-center text-xs text-gray-600">
            You'll manually assign frames to each swing phase for precise comparison
          </p>
        </div>
      </div>
    </div>
  )
}

function MetaRow({ label, options, value, onChange }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1.5">{label}</p>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
        {options.map(([v, l]) => (
          <button key={v} onClick={() => onChange(v)}
            className={`py-2 rounded-xl border text-sm font-medium transition-all ${
              value === v ? 'border-brand-500 bg-brand-500/10 text-white' : 'border-surface-600 bg-surface-800 text-gray-400'
            }`}>
            {l}
          </button>
        ))}
      </div>
    </div>
  )
}
