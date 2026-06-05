import React, { useState } from 'react'
import SkeletonOverlay from './SkeletonOverlay'
import { PHASE_NAMES, PHASE_COLORS } from './VideoFramePlayer'

const ANGLE_DISPLAY = [
  { key: 'spine_angle',         label: 'Spine Angle',      unit: '°' },
  { key: 'hip_rotation',        label: 'Hip Rotation',     unit: '°' },
  { key: 'shoulder_rotation',   label: 'Shoulder Rot.',    unit: '°' },
  { key: 'left_elbow_angle',    label: 'Lead Elbow',       unit: '°' },
  { key: 'right_elbow_angle',   label: 'Trail Elbow',      unit: '°' },
  { key: 'left_knee_angle',     label: 'Lead Knee',        unit: '°' },
]

/**
 * Phase-aligned comparison view.
 * Shows user frame (left) vs reference frame (right) for each swing phase.
 *
 * Props:
 *   comparison  — SwingComparisonResult object from backend
 */
export default function ComparisonPhaseView({ comparison }) {
  const [activePhase,  setActivePhase]  = useState(PHASE_NAMES[0])
  const [showSkeleton, setShowSkeleton] = useState(true)
  const [imgDimsUser,  setImgDimsUser]  = useState({ w: 0, h: 0 })
  const [imgDimsRef,   setImgDimsRef]   = useState({ w: 0, h: 0 })

  const phaseData = comparison?.phases?.[activePhase]
  const user      = phaseData?.user
  const ref       = phaseData?.reference
  const deviation = phaseData?.deviation ?? {}
  const score     = phaseData?.score ?? 0
  const rms       = phaseData?.rms_deviation ?? 0
  const phaseColor = PHASE_COLORS[activePhase] ?? '#22c55e'

  const completedPhases = Object.keys(comparison?.phases ?? {})

  return (
    <div className="space-y-6">
      {/* ── Warnings ── */}
      {comparison?.angle_mismatch && (
        <div className="bg-yellow-900/20 border border-yellow-700/40 text-yellow-400 rounded-xl px-4 py-3 text-sm">
          ⚠ Camera angles differ between your swing and the reference.
          Comparisons may be less accurate.
        </div>
      )}
      {comparison?.requires_mirror && (
        <div className="bg-blue-900/20 border border-blue-700/40 text-blue-400 rounded-xl px-4 py-3 text-sm">
          ↔ Handedness differs. The reference has been mirrored for comparison.
        </div>
      )}

      {/* ── Phase selector ── */}
      <div className="flex flex-wrap gap-2">
        {PHASE_NAMES.map(phase => {
          const pd       = comparison?.phases?.[phase]
          const hasData  = !!pd
          const phaseRms = pd?.rms_deviation ?? 0
          const active   = phase === activePhase
          return (
            <button
              key={phase}
              onClick={() => { if (hasData) setActivePhase(phase) }}
              disabled={!hasData}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all
                          disabled:opacity-30 disabled:cursor-not-allowed`}
              style={active ? {
                background:  `${PHASE_COLORS[phase]}22`,
                borderColor: PHASE_COLORS[phase],
                color:        PHASE_COLORS[phase],
              } : hasData ? {
                background:  '#1a1a1a',
                borderColor: '#333',
                color:        '#aaa',
              } : {}}
            >
              {phase}
              {hasData && (
                <span className={`ml-1.5 text-[10px] font-bold ${
                  phaseRms < 8 ? 'text-green-400' : phaseRms < 15 ? 'text-yellow-400' : 'text-red-400'
                }`}>
                  {phaseRms.toFixed(0)}°
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Side-by-side frames ── */}
      {phaseData ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            {/* User frame */}
            <FramePanel
              label="Your Swing"
              frameUrl={user?.frame_url}
              keypoints={user?.keypoints ?? {}}
              showSkeleton={showSkeleton}
              skeletonColor="#ffffff"
              score={score}
              time={user?.time}
              onDimsChange={setImgDimsUser}
              isUser
            />

            {/* Reference frame */}
            <FramePanel
              label={comparison?.reference_name ?? 'Reference'}
              frameUrl={ref?.frame_url}
              keypoints={ref?.keypoints ?? {}}
              showSkeleton={showSkeleton}
              skeletonColor="#22c55e"
              time={ref?.time}
              onDimsChange={setImgDimsRef}
            />
          </div>

          {/* Skeleton toggle */}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
              <div
                onClick={() => setShowSkeleton(v => !v)}
                className={`w-10 h-5 rounded-full transition-colors relative ${
                  showSkeleton ? 'bg-brand-500' : 'bg-surface-600'
                }`}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${
                  showSkeleton ? 'left-5' : 'left-0.5'
                }`} />
              </div>
              Show skeleton overlay
            </label>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-white inline-block" /> You
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-green-400 inline-block" /> Reference
              </span>
            </div>
          </div>

          {/* ── Metrics comparison ── */}
          <div className="bg-surface-800 border border-surface-700 rounded-2xl overflow-hidden">
            <div className="grid grid-cols-4 text-xs font-medium text-gray-500 uppercase tracking-wider
                            px-4 py-2 border-b border-surface-700 bg-surface-900/50">
              <div>Metric</div>
              <div className="text-center">You</div>
              <div className="text-center">Reference</div>
              <div className="text-center">Δ Delta</div>
            </div>

            {ANGLE_DISPLAY.map(({ key, label, unit }, i) => {
              const uv  = user?.angles?.[key]
              const rv  = ref?.angles?.[key]
              const dv  = deviation[key]
              return (
                <div key={key} className={`grid grid-cols-4 px-4 py-3 text-sm ${
                  i % 2 === 0 ? 'bg-surface-800' : 'bg-surface-800/50'
                }`}>
                  <div className="text-gray-400 text-xs">{label}</div>
                  <div className="text-center font-mono text-white text-xs">
                    {uv != null ? `${uv.toFixed(1)}${unit}` : '—'}
                  </div>
                  <div className="text-center font-mono text-green-400/80 text-xs">
                    {rv != null ? `${rv.toFixed(1)}${unit}` : '—'}
                  </div>
                  <div className={`text-center font-mono font-medium text-xs ${deltaColor(dv)}`}>
                    {dv != null ? `${dv > 0 ? '+' : ''}${dv.toFixed(1)}${unit}` : '—'}
                  </div>
                </div>
              )
            })}

            {/* RMS row */}
            <div className="px-4 py-2 border-t border-surface-700 flex justify-between text-xs">
              <span className="text-gray-500">Overall deviation (RMS)</span>
              <span className={`font-mono font-bold ${
                rms < 8 ? 'text-green-400' : rms < 15 ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {rms.toFixed(1)}°
              </span>
            </div>
          </div>

          {/* ── Deviation bars ── */}
          <DeviationBars deviation={deviation} />
        </>
      ) : (
        <div className="text-center py-12 text-gray-500">
          No data for this phase. Select phases in the Frame Selection tool first.
        </div>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function FramePanel({ label, frameUrl, keypoints, showSkeleton, skeletonColor, score, time, onDimsChange, isUser }) {
  const [dims, setDims] = useState({ w: 0, h: 0 })

  const handleLoad = (e) => {
    const d = { w: e.target.offsetWidth, h: e.target.offsetHeight }
    setDims(d)
    onDimsChange?.(d)
  }

  return (
    <div className="bg-surface-800 border border-surface-700 rounded-2xl overflow-hidden">
      <div className="relative bg-black flex items-center justify-center" style={{ minHeight: 240 }}>
        {frameUrl ? (
          <>
            <img
              src={frameUrl}
              alt={label}
              className="max-w-full max-h-80 object-contain"
              onLoad={handleLoad}
            />
            {showSkeleton && dims.w > 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div style={{ position: 'relative', width: dims.w, height: dims.h }}>
                  <SkeletonOverlayColored
                    keypoints={keypoints}
                    width={dims.w}
                    height={dims.h}
                    color={skeletonColor}
                  />
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-gray-600 text-sm text-center p-6">
            <p className="text-3xl mb-2">{isUser ? '🏌️' : '📹'}</p>
            <p>Frame not available</p>
          </div>
        )}
      </div>

      <div className="px-4 py-3 flex items-center justify-between">
        <div>
          <p className="font-semibold text-white text-sm">{label}</p>
          {time != null && (
            <p className="text-xs text-gray-500 font-mono">{time.toFixed(3)}s</p>
          )}
        </div>
        {score > 0 && (
          <div className={`text-2xl font-bold font-mono ${
            score >= 8 ? 'text-green-400' : score >= 6 ? 'text-yellow-400' : 'text-red-400'
          }`}>
            {score.toFixed(1)}
          </div>
        )}
      </div>
    </div>
  )
}

function SkeletonOverlayColored({ keypoints, width, height, color }) {
  const canvasRef = React.useRef(null)

  const EDGES = [
    ['left_shoulder', 'right_shoulder'], ['left_shoulder', 'left_elbow'],
    ['left_elbow', 'left_wrist'],        ['right_shoulder', 'right_elbow'],
    ['right_elbow', 'right_wrist'],      ['left_shoulder', 'left_hip'],
    ['right_shoulder', 'right_hip'],     ['left_hip', 'right_hip'],
    ['left_hip', 'left_knee'],           ['left_knee', 'left_ankle'],
    ['right_hip', 'right_knee'],         ['right_knee', 'right_ankle'],
  ]

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !keypoints || !width || !height) return
    canvas.width  = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, width, height)

    const pt = (name) => {
      const kp = keypoints[name]
      return kp ? { x: kp.x * width, y: kp.y * height } : null
    }

    ctx.strokeStyle = color
    ctx.lineWidth   = 2.5
    ctx.lineCap     = 'round'

    for (const [a, b] of EDGES) {
      const pA = pt(a), pB = pt(b)
      if (!pA || !pB) continue
      ctx.beginPath(); ctx.moveTo(pA.x, pA.y); ctx.lineTo(pB.x, pB.y); ctx.stroke()
    }

    ctx.fillStyle   = color
    ctx.shadowColor = color
    ctx.shadowBlur  = 6
    for (const kp of Object.values(keypoints)) {
      ctx.beginPath()
      ctx.arc(kp.x * width, kp.y * height, 4, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [keypoints, width, height, color])

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" style={{ width, height }} />
}

function DeviationBars({ deviation }) {
  const bars = ANGLE_DISPLAY
    .map(({ key, label }) => ({ label, delta: deviation[key] }))
    .filter(b => b.delta != null)

  if (!bars.length) return null

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 uppercase tracking-wider">Deviation from reference</p>
      {bars.map(({ label, delta }) => {
        const abs  = Math.abs(delta)
        const pct  = Math.min(100, (abs / 30) * 100)
        const side = delta >= 0 ? 'right' : 'left'
        return (
          <div key={label} className="flex items-center gap-3">
            <div className="w-24 text-xs text-gray-400 text-right flex-shrink-0">{label}</div>
            <div className="flex-1 h-3 bg-surface-700 rounded-full overflow-hidden relative">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-px h-full bg-surface-500" />
              </div>
              <div
                className={`absolute top-0 h-full rounded-full ${
                  abs < 5 ? 'bg-green-500' : abs < 15 ? 'bg-yellow-500' : 'bg-red-500'
                }`}
                style={{
                  width: `${pct / 2}%`,
                  left:  side === 'right' ? '50%' : `${50 - pct / 2}%`,
                }}
              />
            </div>
            <div className={`w-14 text-right text-xs font-mono flex-shrink-0 ${deltaColor(delta)}`}>
              {delta > 0 ? '+' : ''}{delta.toFixed(1)}°
            </div>
          </div>
        )
      })}
    </div>
  )
}

function deltaColor(d) {
  if (d == null) return 'text-gray-500'
  const a = Math.abs(d)
  if (a < 5)  return 'text-green-400'
  if (a < 15) return 'text-yellow-400'
  return 'text-red-400'
}
