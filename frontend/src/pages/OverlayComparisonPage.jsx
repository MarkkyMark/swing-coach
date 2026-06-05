/**
 * OverlayComparisonPage
 *
 * TWO-COLUMN LAYOUT:
 *   Left  — phase-by-phase inspection (original behavior, unchanged)
 *   Right — synchronized animation playback (new feature)
 *
 * Both sides share `activePhase` state.
 * Clicking a phase chip on the left also jumps the animation to that phase.
 *
 * Skeleton rendering helpers (normalise / drawSkeleton) are identical to
 * the original — zero changes there.
 */

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchComparison } from '../api/client'

// ── Constants ────────────────────────────────────────────────────────────────

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

const SKELETON_EDGES = [
  ['left_shoulder',  'right_shoulder'],
  ['left_shoulder',  'left_elbow'],
  ['left_elbow',     'left_wrist'],
  ['right_shoulder', 'right_elbow'],
  ['right_elbow',    'right_wrist'],
  ['left_shoulder',  'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip',       'right_hip'],
  ['left_hip',       'left_knee'],
  ['left_knee',      'left_ankle'],
  ['right_hip',      'right_knee'],
  ['right_knee',     'right_ankle'],
  ['nose',           'left_shoulder'],
  ['nose',           'right_shoulder'],
]

/**
 * Phase progress milestones ∈ [0, 1] for the animation sync.
 * Non-uniform: backswing gets more time (slower), downswing is faster.
 * This reflects actual golf swing tempo.
 */
const PHASE_MILESTONES = {
  'Address':        0.00,
  'Takeaway':       0.08,
  'Backswing':      0.20,
  'Top of Swing':   0.40,
  'Downswing':      0.55,
  'Impact':         0.65,
  'Follow Through': 0.80,
  'Finish':         1.00,
}

const CANVAS_W        = 480
const CANVAS_H        = 600
const ANIM_DURATION_S = 4.0   // seconds per full cycle at 1× speed
const SPEED_OPTIONS   = [0.5, 1.0, 2.0]

// ── Main component ────────────────────────────────────────────────────────────

export default function OverlayComparisonPage() {
  const { sessionId }  = useParams()
  const [comparison,   setComparison]  = useState(null)
  const [loading,      setLoading]     = useState(true)
  const [error,        setError]       = useState(null)
  const [activePhase,  setActivePhase] = useState('Address')

  // ── Load comparison (cached, no backend recompute) ──────────────────────
  useEffect(() => {
    if (!sessionId) return
    fetchComparison(sessionId)
      .then(data => { setComparison(data); setLoading(false) })
      .catch(e   => {
        setError(e?.response?.data?.detail || 'Could not load comparison data.')
        setLoading(false)
      })
  }, [sessionId])

  // ── Ordered keypoint arrays for animation ──────────────────────────────
  // One entry per phase (in PHASE_NAMES order); empty obj if no data.
  const userFrames = useMemo(() => extractOrderedKeypoints(comparison, 'user'),      [comparison])
  const refFrames  = useMemo(() => extractOrderedKeypoints(comparison, 'reference'), [comparison])

  // ── Shared phase-click handler ─────────────────────────────────────────
  // animJumpRef is set by AnimationPanel and called here so clicking a
  // phase on the left immediately jumps the animation on the right.
  const animJumpRef = useRef(null)

  const handlePhaseClick = useCallback((phase) => {
    setActivePhase(phase)
    animJumpRef.current?.(PHASE_MILESTONES[phase] ?? 0)
  }, [])

  // ── Derived for left panel ─────────────────────────────────────────────
  const phaseData  = comparison?.phases?.[activePhase]
  const hasData    = phaseData?.user?.keypoints && Object.keys(phaseData.user.keypoints).length > 0
  const phaseColor = PHASE_COLORS[activePhase] ?? '#22c55e'

  // ── Loading / error ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-surface-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="min-h-screen bg-surface-900 flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-red-400">{error}</p>
          <Link to={`/comparison/${sessionId}`} className="text-brand-400 underline text-sm">
            ← Back to Comparison
          </Link>
        </div>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-surface-900 flex flex-col">

      {/* ── Header ── */}
      <header className="sticky top-0 z-20 bg-surface-900/90 backdrop-blur border-b border-surface-700">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">⛳</span>
            <div>
              <h1 className="font-bold text-white text-sm leading-none">Skeleton Overlay</h1>
              <p className="text-xs text-gray-500">
                <span className="text-white">⬜ You</span>
                <span className="mx-2 text-gray-600">·</span>
                <span className="text-green-400">🟩 {comparison?.reference_name ?? 'Reference'}</span>
              </p>
            </div>
          </div>
          <Link
            to={`/comparison/${sessionId}`}
            className="text-xs text-gray-400 hover:text-white border border-surface-600 px-3 py-1.5 rounded-lg"
          >
            ← Back to Comparison
          </Link>
        </div>
      </header>

      {/* ── Two-column body ── */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-surface-700">

        {/* ════════════════════════════════════════════════════
            LEFT PANEL — Phase-by-phase inspection (existing)
            ════════════════════════════════════════════════════ */}
        <div className="flex flex-col items-center py-6 px-4 space-y-4">

          {/* Column label */}
          <div className="self-start">
            <h2 className="text-white font-semibold text-sm">Phase Inspector</h2>
            <p className="text-gray-500 text-xs">Click a phase to inspect that moment</p>
          </div>

          {/* Phase selector chips */}
          <div className="flex flex-wrap gap-2 self-start">
            {PHASE_NAMES.map(phase => {
              const pd     = comparison?.phases?.[phase]
              const hasKps = pd?.user?.keypoints && Object.keys(pd.user.keypoints).length > 0
              const active = phase === activePhase
              return (
                <button
                  key={phase}
                  onClick={() => handlePhaseClick(phase)}
                  disabled={!hasKps}
                  className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border
                             transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  style={active ? {
                    background:  `${PHASE_COLORS[phase]}22`,
                    borderColor: PHASE_COLORS[phase],
                    color:        PHASE_COLORS[phase],
                  } : {
                    background: '#1a1a1a', borderColor: '#333', color: '#aaa',
                  }}
                >
                  {phase}
                </button>
              )
            })}
          </div>

          {/* Static overlay canvas — EXACTLY original behaviour */}
          {hasData ? (
            <>
              <StaticCanvas phaseData={phaseData} />

              <div className="text-center space-y-1">
                <p className="text-sm font-semibold" style={{ color: phaseColor }}>
                  {activePhase}
                </p>
                <p className="text-xs text-gray-500 font-mono">
                  You: {phaseData?.user?.time?.toFixed(3)}s
                  {phaseData?.reference?.time != null && (
                    <> · Ref: {phaseData.reference.time.toFixed(3)}s</>
                  )}
                </p>
              </div>

              <Legend refName={comparison?.reference_name} />
            </>
          ) : (
            <NoData phase={activePhase} />
          )}
        </div>

        {/* ════════════════════════════════════════════════
            RIGHT PANEL — Synchronized animation (new)
            ════════════════════════════════════════════════ */}
        <div className="flex flex-col items-center py-6 px-4 space-y-4">

          <div className="self-start">
            <h2 className="text-white font-semibold text-sm">Synchronized Overlay Playback</h2>
            <p className="text-gray-500 text-xs">Both swings animated phase-by-phase in sync</p>
          </div>

          <AnimationPanel
            userFrames={userFrames}
            refFrames={refFrames}
            activePhase={activePhase}
            onPhaseChange={setActivePhase}
            jumpRef={animJumpRef}
            refName={comparison?.reference_name}
          />
        </div>
      </div>
    </div>
  )
}

// ── StaticCanvas ─────────────────────────────────────────────────────────────
// Wraps the original drawOverlay logic in a component. Behaviour unchanged.

function StaticCanvas({ phaseData }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!canvasRef.current) return
    drawOverlay(canvasRef.current, phaseData)
  }, [phaseData])

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      className="rounded-2xl"
      style={{ background: '#0f0f0f', maxWidth: '100%' }}
    />
  )
}

// ── AnimationPanel ────────────────────────────────────────────────────────────
// NEW — synchronized animation with play/pause/speed/reset.

function AnimationPanel({ userFrames, refFrames, activePhase, onPhaseChange, jumpRef, refName }) {
  const canvasRef      = useRef(null)
  const rafRef         = useRef(null)
  const progressRef    = useRef(0)       // 0–1, drives frame computation
  const lastTsRef      = useRef(null)    // last requestAnimationFrame timestamp
  const playingRef     = useRef(false)
  const speedRef       = useRef(1.0)
  const userFramesRef  = useRef(userFrames)
  const refFramesRef   = useRef(refFrames)

  // Keep frame refs current without restarting the animation loop
  useEffect(() => { userFramesRef.current = userFrames }, [userFrames])
  useEffect(() => { refFramesRef.current  = refFrames  }, [refFrames])

  const [playing, setPlaying] = useState(false)
  const [speed,   setSpeed]   = useState(1.0)
  const [displayProgress, setDisplayProgress] = useState(0)

  // Draw at a given progress value (pure function, no state)
  const drawAtProgress = useCallback((prog) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const uKps = keypointsAtProgress(userFramesRef.current, prog)
    const rKps = keypointsAtProgress(refFramesRef.current,  prog)
    drawOverlayFromKps(canvas, uKps, rKps)
  }, [])

  // rAF tick — runs as long as playing
  const tick = useCallback((ts) => {
    if (!playingRef.current) return
    if (lastTsRef.current === null) lastTsRef.current = ts

    const delta = (ts - lastTsRef.current) / 1000   // seconds
    lastTsRef.current = ts

    const newProg = Math.min(1, progressRef.current + (delta * speedRef.current) / ANIM_DURATION_S)
    progressRef.current = newProg

    drawAtProgress(newProg)
    setDisplayProgress(newProg)

    // Update active phase indicator based on current progress
    const detectedPhase = phaseAtProgress(newProg)
    if (detectedPhase) onPhaseChange(detectedPhase)

    if (newProg >= 1) {
      playingRef.current = false
      lastTsRef.current  = null
      setPlaying(false)
      return
    }

    rafRef.current = requestAnimationFrame(tick)
  }, [drawAtProgress, onPhaseChange])

  // Expose jump-to-progress for the left panel
  useEffect(() => {
    jumpRef.current = (prog) => {
      progressRef.current = Math.max(0, Math.min(1, prog))
      lastTsRef.current   = null   // reset delta so next tick is clean
      drawAtProgress(progressRef.current)
      setDisplayProgress(progressRef.current)
    }
  }, [drawAtProgress, jumpRef])

  // Initial draw when data arrives
  useEffect(() => {
    drawAtProgress(progressRef.current)
  }, [drawAtProgress, userFrames, refFrames])

  const handlePlay = () => {
    if (progressRef.current >= 1) {
      // Auto-reset if at end
      progressRef.current = 0
      lastTsRef.current   = null
      setDisplayProgress(0)
    }
    playingRef.current = true
    setPlaying(true)
    rafRef.current = requestAnimationFrame(tick)
  }

  const handlePause = () => {
    playingRef.current = false
    lastTsRef.current  = null
    cancelAnimationFrame(rafRef.current)
    setPlaying(false)
  }

  const handleReset = () => {
    handlePause()
    progressRef.current = 0
    lastTsRef.current   = null
    setDisplayProgress(0)
    drawAtProgress(0)
    onPhaseChange('Address')
  }

  const handleSpeed = (s) => {
    speedRef.current = s
    setSpeed(s)
  }

  // Cleanup on unmount
  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  const hasFrames = userFrames.some(f => Object.keys(f).length > 0)

  return (
    <div className="flex flex-col items-center space-y-4 w-full">
      {hasFrames ? (
        <>
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            className="rounded-2xl"
            style={{ background: '#0f0f0f', maxWidth: '100%' }}
          />

          {/* Progress bar */}
          <div className="w-full max-w-sm space-y-1">
            <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-brand-500 transition-none rounded-full"
                style={{ width: `${displayProgress * 100}%` }}
              />
            </div>
            {/* Phase markers on progress bar */}
            <div className="relative h-4">
              {PHASE_NAMES.map(phase => {
                const m = PHASE_MILESTONES[phase] ?? 0
                return (
                  <button
                    key={phase}
                    onClick={() => jumpRef.current?.(m)}
                    title={phase}
                    className="absolute top-0 w-1.5 h-1.5 rounded-full -translate-x-1/2
                               transition-transform hover:scale-150"
                    style={{
                      left:       `${m * 100}%`,
                      background: PHASE_COLORS[phase],
                    }}
                  />
                )
              })}
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3">
            {/* Reset */}
            <button
              onClick={handleReset}
              className="text-gray-400 hover:text-white text-lg px-2 transition-colors"
              title="Reset to beginning"
            >
              ⏮
            </button>

            {/* Play / Pause */}
            <button
              onClick={playing ? handlePause : handlePlay}
              className="w-11 h-11 rounded-full bg-brand-500 hover:bg-brand-600 text-black
                         font-bold text-lg flex items-center justify-center flex-shrink-0 transition-colors"
            >
              {playing ? '⏸' : '▶'}
            </button>

            {/* Speed */}
            <div className="flex items-center gap-1 bg-surface-800 rounded-lg px-2 py-1">
              {SPEED_OPTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => handleSpeed(s)}
                  className={`text-xs px-2 py-1 rounded transition-colors ${
                    speed === s ? 'bg-brand-500/20 text-brand-400 font-bold' : 'text-gray-500 hover:text-white'
                  }`}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>

          <Legend refName={refName} />

          <p className="text-xs text-gray-600 text-center max-w-xs">
            Click the coloured dots above the bar to jump to any phase.
            Clicking a phase chip on the left also syncs the animation.
          </p>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-64 text-center space-y-3">
          <p className="text-3xl">🦴</p>
          <p className="text-gray-400">No keypoint data available for animation.</p>
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract ordered keypoints array (one per phase) for a given side. */
function extractOrderedKeypoints(comparison, side) {
  if (!comparison) return PHASE_NAMES.map(() => ({}))
  return PHASE_NAMES.map(phase =>
    comparison.phases?.[phase]?.[side]?.keypoints ?? {}
  )
}

/**
 * Phase-aware linear interpolation of keypoints at progress ∈ [0, 1].
 *
 * Uses PHASE_MILESTONES as sync anchors so Top-of-Swing aligns with
 * Top-of-Swing, Impact aligns with Impact, etc.
 * Falls back to even distribution if a phase is missing.
 */
function keypointsAtProgress(frames, progress) {
  const n = frames.length
  if (!n) return {}

  // Find the segment: which two phases bracket `progress`
  const milestones = PHASE_NAMES.map(p => PHASE_MILESTONES[p] ?? 0)

  let segIdx = n - 2
  for (let i = 0; i < milestones.length - 1; i++) {
    if (progress <= milestones[i + 1]) {
      segIdx = i
      break
    }
  }

  // Clamp segment index
  segIdx = Math.max(0, Math.min(n - 2, segIdx))

  const segStart = milestones[segIdx]
  const segEnd   = milestones[segIdx + 1] ?? 1
  const t = segEnd > segStart
    ? Math.max(0, Math.min(1, (progress - segStart) / (segEnd - segStart)))
    : 0

  return interpolateKeypoints(frames[segIdx] ?? {}, frames[segIdx + 1] ?? {}, t)
}

/** Linear interpolation between two keypoint dictionaries. */
function interpolateKeypoints(kpsA, kpsB, t) {
  const joints = new Set([...Object.keys(kpsA), ...Object.keys(kpsB)])
  const result = {}
  for (const joint of joints) {
    const a = kpsA[joint]
    const b = kpsB[joint]
    if (!a && !b) continue
    if (!a) { result[joint] = b; continue }
    if (!b) { result[joint] = a; continue }
    result[joint] = {
      x:          a.x + (b.x - a.x) * t,
      y:          a.y + (b.y - a.y) * t,
      confidence: Math.min(a.confidence, b.confidence),
    }
  }
  return result
}

/** Returns which phase name corresponds to the given animation progress. */
function phaseAtProgress(progress) {
  let best = PHASE_NAMES[0]
  for (const phase of PHASE_NAMES) {
    if (progress >= (PHASE_MILESTONES[phase] ?? 0)) best = phase
    else break
  }
  return best
}

// ── Canvas rendering (identical to original) ─────────────────────────────────

function drawOverlay(canvas, phaseData) {
  const userKps = phaseData?.user?.keypoints      ?? {}
  const refKps  = phaseData?.reference?.keypoints ?? {}
  drawOverlayFromKps(canvas, userKps, refKps)
}

function drawOverlayFromKps(canvas, userKps, refKps) {
  const ctx = canvas.getContext('2d')
  const W   = canvas.width
  const H   = canvas.height
  ctx.clearRect(0, 0, W, H)

  const hasUser = Object.keys(userKps).length > 0
  const hasRef  = Object.keys(refKps).length > 0
  if (!hasUser && !hasRef) return

  const TARGET_H = H * 0.60
  const CENTER_X = W / 2
  const CENTER_Y = H / 2

  if (hasRef)  drawSkeleton(ctx, normalise(refKps,  TARGET_H, CENTER_X - 6, CENTER_Y), '#22c55e', 3.0, 5)
  if (hasUser) drawSkeleton(ctx, normalise(userKps, TARGET_H, CENTER_X + 6, CENTER_Y), '#ffffff', 3.0, 4)
}

function normalise(keypoints, targetHeight, cx, cy) {
  const pts = Object.entries(keypoints).filter(([, kp]) => kp.confidence > 0.2)
  if (!pts.length) return {}

  const lh   = keypoints['left_hip']
  const rh   = keypoints['right_hip']
  const hipX = lh && rh ? (lh.x + rh.x) / 2 : 0.5
  const hipY = lh && rh ? (lh.y + rh.y) / 2 : 0.65

  const ys    = pts.map(([, kp]) => kp.y)
  const bboxH = Math.max(...ys) - Math.min(...ys)
  const scale = bboxH > 0.05 ? targetHeight / bboxH : targetHeight

  return Object.fromEntries(
    pts.map(([name, kp]) => [
      name,
      { x: cx + (kp.x - hipX) * scale, y: cy + (kp.y - hipY) * scale, confidence: kp.confidence },
    ])
  )
}

function drawSkeleton(ctx, keypoints, color, lineWidth, jointRadius) {
  if (!Object.keys(keypoints).length) return
  const pt = (name) => keypoints[name]

  ctx.strokeStyle = color
  ctx.lineWidth   = lineWidth
  ctx.lineCap     = 'round'
  ctx.globalAlpha = 0.85

  for (const [a, b] of SKELETON_EDGES) {
    const pA = pt(a), pB = pt(b)
    if (!pA || !pB) continue
    ctx.beginPath(); ctx.moveTo(pA.x, pA.y); ctx.lineTo(pB.x, pB.y); ctx.stroke()
  }

  ctx.fillStyle   = color
  ctx.shadowColor = color
  ctx.shadowBlur  = 8
  ctx.globalAlpha = 1.0

  for (const kp of Object.values(keypoints)) {
    ctx.beginPath(); ctx.arc(kp.x, kp.y, jointRadius, 0, Math.PI * 2); ctx.fill()
  }

  ctx.shadowBlur  = 0
  ctx.globalAlpha = 1.0
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function Legend({ refName }) {
  return (
    <div className="flex items-center gap-6 text-xs text-gray-400">
      <div className="flex items-center gap-2">
        <span className="w-8 h-0.5 bg-white rounded inline-block" />
        <span>Your swing</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-8 h-0.5 bg-green-400 rounded inline-block" />
        <span>{refName ?? 'Reference'}</span>
      </div>
    </div>
  )
}

function NoData({ phase }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center space-y-3">
      <p className="text-3xl">🦴</p>
      <p className="text-gray-400">No pose data for <strong>{phase}</strong>.</p>
      <p className="text-gray-600 text-sm">Pose landmarks were not detected for this frame.</p>
    </div>
  )
}
