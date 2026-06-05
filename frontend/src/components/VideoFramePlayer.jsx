import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'

const PHASE_NAMES = [
  'Address', 'Takeaway', 'Backswing', 'Top of Swing',
  'Downswing', 'Impact', 'Follow Through', 'Finish',
]

const PHASE_COLORS = {
  'Address':        '#22c55e',
  'Takeaway':       '#84cc16',
  'Backswing':      '#eab308',
  'Top of Swing':   '#f97316',
  'Downswing':      '#ef4444',
  'Impact':         '#ec4899',
  'Follow Through': '#a855f7',
  'Finish':         '#3b82f6',
}

// Phases where zoom is most useful (fast motion, hard to see at 1×)
const ZOOM_PHASES = new Set(['Downswing', 'Impact'])

/**
 * Frame-accurate video player for swing phase selection.
 *
 * Changes vs original:
 *  1. Default playback speed is 0.5× (real-time footage at half speed gives
 *     slow-mo precision without needing slow-mo footage).
 *  2. Speed selector: 0.25× / 0.5× / 1×  (replaces the fps stepping buttons
 *     which are kept but moved to a secondary row).
 *  3. Impact/Downswing zoom: 2.5× magnification centred on the lower frame
 *     (hands/impact zone). Auto-prompts when a fast phase is active.
 */
const VideoFramePlayer = forwardRef(function VideoFramePlayer(
  { src, label, assignments = {}, activePhase, onTimeChange, onSetPhase, readOnly = false },
  ref,
) {
  const videoRef    = useRef(null)
  const [currentTime,   setCurrentTime]  = useState(0)
  const [duration,      setDuration]     = useState(0)
  const [playing,       setPlaying]      = useState(false)
  const [fps,           setFps]          = useState(30)
  const [error,         setError]        = useState(null)
  const [loading,       setLoading]      = useState(true)
  // Feature 1: playback speed — default 0.5×
  const [playbackRate,  setPlaybackRate] = useState(0.5)
  // Feature 2: zoom
  const [zoomActive,    setZoomActive]   = useState(false)

  // ── Expose seekTo / pause for external callers ─────────────────────────
  useImperativeHandle(ref, () => ({
    seekTo: (t) => {
      if (videoRef.current) {
        videoRef.current.currentTime = t
        videoRef.current.pause()
        setPlaying(false)
      }
    },
    pause: () => { videoRef.current?.pause(); setPlaying(false) },
  }))

  // ── Sync playback rate to the <video> element ──────────────────────────
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate
  }, [playbackRate])

  // ── Auto-zoom suggestion: prompt when entering a fast phase ───────────
  // Does NOT force zoom on — user still clicks the button. Just makes it visible.
  const isZoomPhase = ZOOM_PHASES.has(activePhase)

  // ── Event handlers ─────────────────────────────────────────────────────
  const handleTimeUpdate = useCallback(() => {
    const t = videoRef.current?.currentTime ?? 0
    setCurrentTime(t)
    onTimeChange?.(t)
  }, [onTimeChange])

  const handleLoaded = useCallback((e) => {
    const v = e.target
    setDuration(v.duration)
    setLoading(false)
    // Apply default 0.5× immediately
    v.playbackRate = 0.5
    const track = v.videoTracks?.[0]
    if (track?.frameRate) setFps(track.frameRate)
  }, [])

  const handleChangeRate = useCallback((rate) => {
    setPlaybackRate(rate)
    if (videoRef.current) videoRef.current.playbackRate = rate
  }, [])

  const stepFrame = useCallback((dir) => {
    const v = videoRef.current
    if (!v) return
    v.pause(); setPlaying(false)
    v.currentTime = Math.max(0, Math.min(duration, v.currentTime + dir / fps))
  }, [duration, fps])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (playing) { v.pause(); setPlaying(false) }
    else         { v.play();  setPlaying(true)  }
  }, [playing])

  const handleEnded = () => setPlaying(false)

  const handleKey = useCallback((e) => {
    if (e.key === 'ArrowLeft')  { e.preventDefault(); stepFrame(-1) }
    if (e.key === 'ArrowRight') { e.preventDefault(); stepFrame(1) }
    if (e.key === ' ')          { e.preventDefault(); togglePlay() }
  }, [stepFrame, togglePlay])

  const seekToPhase = useCallback((phase) => {
    const t = assignments[phase]
    if (t != null && videoRef.current) {
      videoRef.current.currentTime = t
      videoRef.current.pause()
      setPlaying(false)
    }
  }, [assignments])

  const frameNumber   = Math.round(currentTime * fps)
  const totalFrames   = Math.round(duration * fps)
  const phaseAssigned = activePhase && assignments[activePhase] != null
  const assignedCount = Object.keys(assignments).length
  const phaseColor    = PHASE_COLORS[activePhase] ?? '#22c55e'

  return (
    <div className="flex flex-col bg-surface-900 rounded-2xl overflow-hidden border border-surface-700"
         tabIndex={0} onKeyDown={handleKey} style={{ outline: 'none' }}>

      {/* ── Label bar ── */}
      <div className="flex items-center justify-between px-3 py-2 bg-surface-800 border-b border-surface-700">
        <span className="text-sm font-semibold text-white">{label}</span>
        <div className="flex items-center gap-2">
          {/* Zoom prompt badge — appears automatically on fast phases */}
          {isZoomPhase && !zoomActive && (
            <button
              onClick={() => setZoomActive(true)}
              className="text-[9px] bg-pink-500/20 text-pink-400 border border-pink-500/40
                         px-2 py-0.5 rounded-full font-medium animate-pulse"
            >
              🔍 Zoom for {activePhase}
            </button>
          )}
          <span className="text-xs text-gray-500 font-mono">{assignedCount}/8 phases set</span>
        </div>
      </div>

      {/* ── Video container — overflow:hidden clips the zoomed video ── */}
      <div
        className="relative bg-black flex items-center justify-center overflow-hidden"
        style={{ minHeight: 240 }}
      >
        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error ? (
          <div className="text-red-400 text-sm text-center p-6">
            <p className="text-2xl mb-2">⚠</p>
            <p>{error}</p>
          </div>
        ) : src ? (
          <video
            ref={videoRef}
            src={src}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoaded}
            onEnded={handleEnded}
            onError={(e) => {
              const ERR = {1:'ABORTED',2:'NETWORK',3:'DECODE',4:'SRC_NOT_SUPPORTED'}
              const code = e.target?.error?.code
              const msg  = e.target?.error?.message || ''
              console.error(`[VideoPlayer] Load failed for: ${src}`, code ? `(${ERR[code]||code}) ${msg}` : '')
              setError(`Video failed to load — ${ERR[code] || 'network error'}. URL: ${src}`)
            }}
            playsInline
            preload="metadata"
            style={{
              maxWidth:        '100%',
              maxHeight:       '72',
              objectFit:       'contain',
              // Feature 2: Zoom — scale 2.5× centred 65% down the frame.
              // transformOrigin 'center 65%' keeps the hands/impact zone
              // in view rather than the head/sky.
              transform:       zoomActive ? 'scale(2.5)' : 'scale(1)',
              transformOrigin: 'center 65%',
              transition:      'transform 0.25s ease',
            }}
          />
        ) : (
          <div className="text-gray-600 text-sm text-center p-6">
            <p className="text-3xl mb-2">🎥</p>
            <p>No video loaded</p>
          </div>
        )}

        {/* Phase badge */}
        {activePhase && (
          <div className="absolute top-2 left-2 text-xs font-bold px-2 py-0.5 rounded-full z-20"
            style={{ background: `${phaseColor}22`, color: phaseColor, border: `1px solid ${phaseColor}55` }}>
            {activePhase}{phaseAssigned && ' ✓'}
          </div>
        )}

        {/* Zoom active indicator */}
        {zoomActive && (
          <div className="absolute top-2 right-2 z-20">
            <button
              onClick={() => setZoomActive(false)}
              className="text-[9px] bg-black/70 text-pink-400 border border-pink-500/50
                         px-2 py-0.5 rounded-full font-medium"
              title="Click to exit zoom"
            >
              🔍 2.5× · tap to exit
            </button>
          </div>
        )}

        {/* Frame counter */}
        <div className="absolute bottom-2 right-2 text-[10px] font-mono text-white/40 bg-black/50 px-2 py-0.5 rounded z-20">
          {frameNumber} / {totalFrames}
        </div>
      </div>

      {/* ── Scrubber ── */}
      {duration > 0 && (
        <div className="px-3 pt-2 space-y-1.5">
          <div className="relative h-2">
            <input
              type="range" min={0} max={duration} step={0.001} value={currentTime}
              onChange={(e) => {
                const t = Number(e.target.value)
                if (videoRef.current) videoRef.current.currentTime = t
              }}
              className="w-full accent-green-500 cursor-pointer h-2 absolute inset-0 z-10 opacity-0"
            />
            <div className="absolute inset-0 bg-surface-600 rounded-full overflow-hidden">
              <div className="h-full bg-brand-500 transition-none rounded-full"
                style={{ width: `${(currentTime / duration) * 100}%` }} />
            </div>
            {PHASE_NAMES.map(phase => {
              const t = assignments[phase]
              if (t == null) return null
              return (
                <div key={phase}
                  className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full border border-black z-20 cursor-pointer"
                  style={{ left: `${(t / duration) * 100}%`, background: PHASE_COLORS[phase], marginLeft: -4 }}
                  title={`${phase}: ${t.toFixed(2)}s`}
                  onClick={() => seekToPhase(phase)}
                />
              )
            })}
          </div>
          <div className="flex justify-between text-[10px] font-mono text-gray-500">
            <span>{currentTime.toFixed(3)}s</span>
            <span>{duration.toFixed(3)}s</span>
          </div>
        </div>
      )}

      {/* ── Controls row ── */}
      <div className="flex items-center gap-2 px-3 pb-1 pt-1">
        {/* Frame step back */}
        <button onClick={() => stepFrame(-1)}
          className="text-gray-400 hover:text-white text-lg px-1" title="Previous frame (←)">◁</button>

        {/* Play / Pause */}
        <button onClick={togglePlay} disabled={!src || !!error}
          className="w-9 h-9 rounded-full bg-brand-500 hover:bg-brand-600 disabled:opacity-40
                     text-black font-bold flex items-center justify-center flex-shrink-0">
          {playing ? '⏸' : '▶'}
        </button>

        {/* Frame step forward */}
        <button onClick={() => stepFrame(1)}
          className="text-gray-400 hover:text-white text-lg px-1" title="Next frame (→)">▷</button>

        <span className="text-[10px] text-gray-600 font-mono flex-1">{currentTime.toFixed(3)}s</span>

        {/* Feature 1: Playback speed — default 0.5× */}
        <div className="flex items-center gap-0.5 bg-surface-800 rounded-lg px-1.5 py-1">
          <span className="text-[8px] text-gray-600 mr-1">speed</span>
          {[0.25, 0.5, 1.0].map(r => (
            <button key={r} onClick={() => handleChangeRate(r)}
              className={`text-[9px] px-1.5 py-0.5 rounded transition-colors font-medium ${
                playbackRate === r
                  ? 'bg-brand-500/25 text-brand-400'
                  : 'text-gray-500 hover:text-white'
              }`}
              title={`Play at ${r}× speed`}
            >
              {r}×
            </button>
          ))}
        </div>

        {/* Feature 2: Zoom toggle */}
        <button
          onClick={() => setZoomActive(v => !v)}
          disabled={!src || !!error}
          title={zoomActive ? 'Exit zoom (shows hands/impact zone)' : 'Zoom in on impact zone'}
          className={`text-xs px-2 py-1 rounded-lg border transition-all disabled:opacity-30 ${
            zoomActive
              ? 'border-pink-500 bg-pink-500/15 text-pink-400'
              : isZoomPhase
              ? 'border-pink-500/40 text-pink-500/70 hover:border-pink-500 hover:text-pink-400'
              : 'border-surface-600 text-gray-500 hover:text-white hover:border-gray-500'
          }`}
        >
          🔍
        </button>
      </div>

      {/* ── Secondary: frame-step FPS setting ── */}
      <div className="flex items-center gap-1 px-3 pb-2">
        <span className="text-[8px] text-gray-600 mr-1">step</span>
        {[15, 30, 60].map(f => (
          <button key={f} onClick={() => setFps(f)}
            className={`text-[8px] px-1 py-0.5 rounded transition-colors ${
              fps === f ? 'bg-brand-500/20 text-brand-400' : 'text-gray-600 hover:text-gray-400'
            }`}
            title={`Frame step = 1/${f}s (${(1000/f).toFixed(0)}ms)`}
          >
            /{f}
          </button>
        ))}
        <span className="text-[8px] text-gray-600 ml-0.5">fps</span>
      </div>

      {/* ── Set Phase button ── */}
      {!readOnly && activePhase && (
        <div className="px-3 pb-3">
          <button
            onClick={onSetPhase}
            disabled={!src || !!error || duration === 0}
            className="w-full py-2.5 rounded-xl font-semibold text-sm transition-all
                       disabled:opacity-40 disabled:cursor-not-allowed"
            style={src && !error ? {
              background: `${phaseColor}22`,
              color:       phaseColor,
              border:      `1px solid ${phaseColor}55`,
            } : {
              background: '#2e2e2e', color: '#666',
            }}
          >
            {phaseAssigned
              ? `↻ Update ${label.split(' ')[0]} — "${activePhase}" (${currentTime.toFixed(2)}s)`
              : `✚ Set ${label.split(' ')[0]} frame as "${activePhase}"`
            }
          </button>
        </div>
      )}

      {/* ── Phase chip strip ── */}
      <div className="px-3 pb-3">
        <div className="flex gap-1 flex-wrap">
          {PHASE_NAMES.map(phase => {
            const t = assignments[phase]
            return (
              <button
                key={phase}
                onClick={() => seekToPhase(phase)}
                title={t != null ? `Seek to ${phase} (${t.toFixed(2)}s)` : phase}
                className={`text-[9px] px-1.5 py-0.5 rounded-full transition-all ${
                  t != null ? 'font-bold' : 'opacity-30 cursor-default'
                } ${activePhase === phase ? 'ring-1 ring-white/40' : ''}`}
                style={t != null ? {
                  background: `${PHASE_COLORS[phase]}22`,
                  color:       PHASE_COLORS[phase],
                  border:      `1px solid ${PHASE_COLORS[phase]}44`,
                } : {
                  background: '#2e2e2e', color: '#555', border: '1px solid #333',
                }}
              >
                {phase.split(' ')[0]}
                {t != null && ` ${t.toFixed(1)}s`}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
})

export default VideoFramePlayer
export { PHASE_NAMES, PHASE_COLORS }
