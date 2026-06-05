import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { fetchFrames } from '../api/client'
import FramePlayer from './FramePlayer'
import SkeletonOverlay from './SkeletonOverlay'

/**
 * Full-featured frame viewer for the Frames tab.
 *
 * Fetches ALL frames from /api/frames/{session_id}, then renders:
 *  - A full FramePlayer (scrubber + playback + skeleton overlay)
 *  - A scrollable key-frame strip at the bottom for quick navigation
 */
export default function FrameGallery({ keyFrames }) {
  const { sessionId } = useParams()
  const [frames,  setFrames]  = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [showSkeleton, setShowSkeleton] = useState(true)
  const [currentIdx,   setCurrentIdx]  = useState(0)

  useEffect(() => {
    if (!sessionId) return
    setLoading(true)
    setError(null)

    fetchFrames(sessionId)
      .then(({ frames: f, total }) => {
        if (!f || f.length === 0) {
          // No frames returned — fall back to key frames
          if (keyFrames?.length) {
            setFrames(keyFrames)
            setError('Full frame sequence unavailable — showing key frames only.')
          } else {
            setError('No frames were found for this session.')
          }
        } else {
          setFrames(f)
        }
        setLoading(false)
      })
      .catch((e) => {
        const status = e?.response?.status
        const detail = e?.response?.data?.detail

        if (status === 202) {
          // Pipeline still running — shouldn't happen on results page, but handle gracefully
          setError('Analysis is still processing. Refresh in a moment.')
        } else if (keyFrames?.length) {
          // Any other error — fall back to key frames
          setFrames(keyFrames)
          setError(`Note: Using key frames only (${detail || 'full frames unavailable'}).`)
        } else {
          setError(detail || `Could not load frames (HTTP ${status || 'network error'}).`)
        }
        setLoading(false)
      })
  }, [sessionId])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 text-sm">Loading {frames.length ? frames.length + ' frames' : 'frames'}…</p>
      </div>
    )
  }

  // If we have frames AND an error, show the error as a non-blocking banner
  // (e.g. "showing key frames only").
  // Only block render if there's an error AND no frames at all.
  if (error && !frames.length) {
    return (
      <div className="text-center py-16 space-y-3">
        <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-xl p-4 max-w-md mx-auto">
          {error}
        </div>
        <p className="text-gray-600 text-xs">
          Try re-running the analysis or check backend logs.
        </p>
      </div>
    )
  }

  if (!frames.length) {
    return (
      <div className="text-center py-16 text-gray-500">No frames found for this session.</div>
    )
  }

  const currentFrame = frames[currentIdx]

  return (
    <div className="space-y-4">
      {/* Non-blocking error banner (when frames are available but degraded) */}
      {error && frames.length > 0 && (
        <div className="text-yellow-400 text-xs bg-yellow-900/20 border border-yellow-800 rounded-lg px-3 py-2">
          ⚠ {error}
        </div>
      )}

      {/* Controls bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-white">Swing Playback</h2>
          <p className="text-xs text-gray-500">{frames.length} frames extracted</p>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
          <div
            onClick={() => setShowSkeleton((v) => !v)}
            className={`w-10 h-5 rounded-full transition-colors relative ${
              showSkeleton ? 'bg-brand-500' : 'bg-surface-600'
            }`}
          >
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${
              showSkeleton ? 'left-5' : 'left-0.5'
            }`} />
          </div>
          Skeleton
        </label>
      </div>

      {/* Main player */}
      <FramePlayer
        frames={frames}
        label="Your Swing"
        showSkeleton={showSkeleton}
        syncIndex={currentIdx}
        onIndexChange={setCurrentIdx}
      />

      {/* Current frame metrics */}
      {currentFrame && (
        <FrameMetricsBar frame={currentFrame} />
      )}

      {/* Key frame strip — click to jump */}
      <div>
        <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Key Frames</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {frames
            .filter((f) => f.is_key_frame)
            .map((f) => (
              <KeyFrameChip
                key={f.frame_index}
                frame={f}
                isActive={currentIdx === f.frame_index}
                onClick={() => setCurrentIdx(f.frame_index)}
              />
            ))}
        </div>
      </div>
    </div>
  )
}

// ── Current frame metric strip ──────────────────────────────────────────

function FrameMetricsBar({ frame }) {
  const a   = frame.angles ?? {}
  const dev = frame.deviation_from_pro

  const metrics = [
    { label: 'Spine',    val: a.spine_angle,       delta: dev?.spine_angle_delta },
    { label: 'Hips',     val: a.hip_rotation,      delta: dev?.hip_rotation_delta },
    { label: 'Shoulder', val: a.shoulder_rotation, delta: dev?.shoulder_rotation_delta },
    { label: 'L.Elbow',  val: a.left_elbow_angle,  delta: dev?.left_elbow_angle_delta },
    { label: 'R.Elbow',  val: a.right_elbow_angle, delta: dev?.right_elbow_angle_delta },
  ].filter((m) => m.val != null)

  if (!metrics.length) return null

  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      {metrics.map(({ label, val, delta }) => (
        <div
          key={label}
          className="flex-shrink-0 bg-surface-800 border border-surface-700 rounded-xl px-3 py-2 text-center min-w-[72px]"
        >
          <div className="text-xs text-gray-500 mb-0.5">{label}</div>
          <div className="text-sm font-mono font-bold text-white">{val.toFixed(1)}°</div>
          {delta != null && (
            <div className={`text-[10px] font-mono ${
              Math.abs(delta) < 5  ? 'text-green-400' :
              Math.abs(delta) < 15 ? 'text-yellow-400' : 'text-red-400'
            }`}>
              {delta > 0 ? '+' : ''}{delta.toFixed(1)}°
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Key frame thumbnail chip ────────────────────────────────────────────

function KeyFrameChip({ frame, isActive, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 rounded-xl overflow-hidden border-2 transition-all ${
        isActive ? 'border-brand-500' : 'border-surface-600 hover:border-gray-500'
      }`}
    >
      <div className="relative w-16 h-20">
        <img
          src={frame.image_url}
          alt={frame.phase}
          className="w-full h-full object-cover"
        />
      </div>
      <div className={`px-1 py-0.5 text-[9px] font-medium text-center truncate ${
        isActive ? 'bg-brand-500 text-black' : 'bg-surface-800 text-gray-400'
      }`}>
        {frame.phase ?? '—'}
      </div>
    </button>
  )
}
