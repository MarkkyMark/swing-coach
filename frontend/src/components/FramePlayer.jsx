import React, { useCallback, useEffect, useRef, useState } from 'react'
import SkeletonOverlay from './SkeletonOverlay'

const PHASE_COLORS = {
  'Address':       '#22c55e',
  'Takeaway':      '#84cc16',
  'Backswing':     '#eab308',
  'Top of Swing':  '#f97316',
  'Downswing':     '#ef4444',
  'Impact':        '#ec4899',
  'Follow Through':'#a855f7',
  'Finish':        '#3b82f6',
}

/**
 * Reusable frame-by-frame player.
 *
 * Props:
 *   frames       — array of frame objects { frame_index, timestamp, image_url, keypoints,
 *                  angles, phase, is_key_frame, deviation_from_pro }
 *   label        — optional string displayed in top-left corner
 *   showSkeleton — whether to render the SkeletonOverlay canvas
 *   syncIndex    — externally controlled frame index (for side-by-side sync)
 *   onIndexChange— callback when the index changes (for sync)
 *   compact      — smaller layout for embedded use
 */
export default function FramePlayer({
  frames = [],
  label = '',
  showSkeleton = true,
  syncIndex = null,
  onIndexChange = null,
  compact = false,
}) {
  const [internalIdx, setInternalIdx] = useState(0)
  const [isPlaying,   setIsPlaying]   = useState(false)
  const [imgDims,     setImgDims]     = useState({ w: 0, h: 0 })
  const [playbackFps, setPlaybackFps] = useState(12)
  const imgRef     = useRef(null)
  const intervalRef = useRef(null)
  const containerRef = useRef(null)

  // Use external index if provided (sync mode), else internal
  const currentIdx = syncIndex !== null ? syncIndex : internalIdx
  const setIdx = useCallback((idx) => {
    const clamped = Math.max(0, Math.min(frames.length - 1, idx))
    setInternalIdx(clamped)
    onIndexChange?.(clamped)
  }, [frames.length, onIndexChange])

  const frame = frames[currentIdx] ?? null

  // Playback loop
  useEffect(() => {
    clearInterval(intervalRef.current)
    if (!isPlaying) return
    intervalRef.current = setInterval(() => {
      setIdx((prev) => {
        const next = (prev ?? 0) + 1
        if (next >= frames.length) { setIsPlaying(false); return prev }
        return next
      })
    }, 1000 / playbackFps)
    return () => clearInterval(intervalRef.current)
  }, [isPlaying, playbackFps, frames.length])

  // Stop on external sync reset
  useEffect(() => {
    if (syncIndex !== null) setIsPlaying(false)
  }, [syncIndex])

  const togglePlay = () => {
    if (currentIdx >= frames.length - 1) setIdx(0)
    setIsPlaying((p) => !p)
  }

  const handleImgLoad = (e) => {
    setImgDims({ w: e.target.offsetWidth, h: e.target.offsetHeight })
  }

  if (!frames.length) {
    return (
      <div className="bg-surface-800 rounded-2xl flex items-center justify-center h-48 text-gray-500 text-sm">
        No frames available
      </div>
    )
  }

  const phaseColor = frame?.phase ? (PHASE_COLORS[frame.phase] ?? '#ffffff') : '#ffffff'
  const phasePct   = frames.length > 1 ? currentIdx / (frames.length - 1) : 0

  return (
    <div ref={containerRef} className="flex flex-col bg-surface-900 rounded-2xl overflow-hidden select-none">

      {/* ── Frame display ─────────────────────────────────────────── */}
      <div className="relative bg-black flex-1" style={{ minHeight: compact ? 180 : 280 }}>
        {frame ? (
          <>
            <img
              ref={imgRef}
              key={frame.image_url}
              src={frame.image_url}
              alt={`Frame ${frame.frame_index}`}
              className="w-full h-full object-contain"
              style={{ maxHeight: compact ? 240 : 420 }}
              onLoad={handleImgLoad}
              draggable={false}
            />

            {showSkeleton && imgDims.w > 0 && (
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
              >
                <div style={{ position: 'relative', width: imgDims.w, height: imgDims.h }}>
                  <SkeletonOverlay
                    keypoints={frame.keypoints ?? {}}
                    deviation={frame.deviation_from_pro}
                    width={imgDims.w}
                    height={imgDims.h}
                  />
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-600">
            Loading…
          </div>
        )}

        {/* Phase badge */}
        {frame?.phase && (
          <div
            className="absolute top-2 left-2 text-xs font-bold px-2 py-0.5 rounded-full"
            style={{ background: `${phaseColor}22`, color: phaseColor, border: `1px solid ${phaseColor}44` }}
          >
            {frame.phase}
          </div>
        )}

        {/* Label */}
        {label && (
          <div className="absolute top-2 right-2 text-[10px] text-white/60 bg-black/50 px-2 py-0.5 rounded">
            {label}
          </div>
        )}

        {/* Frame counter */}
        <div className="absolute bottom-2 right-2 text-[10px] font-mono text-white/40 bg-black/40 px-1.5 py-0.5 rounded">
          {currentIdx + 1} / {frames.length}
        </div>
      </div>

      {/* ── Phase timeline bar ────────────────────────────────────── */}
      <PhaseTimeline frames={frames} currentIdx={currentIdx} onSeek={setIdx} />

      {/* ── Controls ─────────────────────────────────────────────── */}
      <div className="px-3 py-2 space-y-2">
        {/* Scrubber */}
        <input
          type="range"
          min={0}
          max={frames.length - 1}
          value={currentIdx}
          onChange={(e) => { setIsPlaying(false); setIdx(Number(e.target.value)) }}
          className="w-full accent-green-500 cursor-pointer h-1.5"
        />

        <div className="flex items-center gap-3">
          {/* Step back */}
          <button
            onClick={() => { setIsPlaying(false); setIdx(currentIdx - 1) }}
            className="text-gray-400 hover:text-white text-lg"
            title="Previous frame"
          >
            ◁
          </button>

          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            className="w-9 h-9 rounded-full bg-brand-500 hover:bg-brand-600 text-black font-bold
                       flex items-center justify-center flex-shrink-0 transition-colors"
          >
            {isPlaying ? '⏸' : '▶'}
          </button>

          {/* Step forward */}
          <button
            onClick={() => { setIsPlaying(false); setIdx(currentIdx + 1) }}
            className="text-gray-400 hover:text-white text-lg"
            title="Next frame"
          >
            ▷
          </button>

          {/* Timestamp */}
          <span className="text-xs font-mono text-gray-500 ml-1">
            {frame?.timestamp?.toFixed(3) ?? '0.000'}s
          </span>

          <div className="flex-1" />

          {/* FPS control */}
          {!compact && (
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span>Speed</span>
              {[6, 12, 24].map((fps) => (
                <button
                  key={fps}
                  onClick={() => setPlaybackFps(fps)}
                  className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                    playbackFps === fps
                      ? 'bg-brand-500/20 text-brand-400'
                      : 'hover:text-white'
                  }`}
                >
                  {fps === 6 ? '0.5×' : fps === 12 ? '1×' : '2×'}
                </button>
              ))}
            </div>
          )}

          {/* Skeleton toggle (if not controlled externally) */}
        </div>
      </div>
    </div>
  )
}

// ── Phase timeline ──────────────────────────────────────────────────────

function PhaseTimeline({ frames, currentIdx, onSeek }) {
  // Build phase segments
  const segments = []
  let i = 0
  while (i < frames.length) {
    const phase = frames[i].phase ?? 'Unknown'
    let j = i
    while (j < frames.length && frames[j].phase === phase) j++
    segments.push({ phase, start: i, end: j - 1, color: PHASE_COLORS[phase] ?? '#555' })
    i = j
  }

  const handleClick = (e, seg) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const relX = (e.clientX - rect.left) / rect.width
    const idx  = Math.round(seg.start + relX * (seg.end - seg.start))
    onSeek(idx)
  }

  return (
    <div className="flex h-2 mx-0 cursor-pointer" title="Click to seek">
      {segments.map((seg) => {
        const width = ((seg.end - seg.start + 1) / frames.length) * 100
        const isActive = currentIdx >= seg.start && currentIdx <= seg.end
        return (
          <div
            key={seg.phase}
            style={{ width: `${width}%`, background: seg.color, opacity: isActive ? 1 : 0.35 }}
            className="transition-opacity"
            onClick={(e) => handleClick(e, seg)}
          />
        )
      })}
    </div>
  )
}
