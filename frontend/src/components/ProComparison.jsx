import React, { useEffect, useRef, useState } from 'react'
import { fetchPhaseSummary, fetchPro } from '../api/client'
import { useParams } from 'react-router-dom'
import SkeletonOverlay from './SkeletonOverlay'

const PHASE_ORDER = [
  'Address', 'Takeaway', 'Backswing', 'Top of Swing',
  'Downswing', 'Impact', 'Follow Through', 'Finish',
]

/**
 * Side-by-side comparison: user's real frame (with skeleton) vs pro synthetic pose.
 *
 * Data sources:
 *   - User phase data: GET /api/frames/{sessionId}/phase-summary
 *   - Pro pose data:   GET /api/pro/{proId}  (includes synthetic_keypoints)
 */
export default function ProComparison({ analysis }) {
  const { sessionId }         = useParams()
  const [selectedPhase, setSelectedPhase] = useState('Address')
  const [phaseSummary,  setPhaseSummary]  = useState(null)   // from /phase-summary
  const [proData,       setProData]       = useState(null)   // from /pro/{id}
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState(null)

  const proId = analysis?.compared_pro_id ?? 'tiger_2000'

  useEffect(() => {
    if (!sessionId || !proId) return
    setLoading(true)

    Promise.all([
      fetchPhaseSummary(sessionId),
      fetchPro(proId),
    ])
      .then(([summary, pro]) => {
        setPhaseSummary(summary)
        setProData(pro)
        setLoading(false)
      })
      .catch((e) => {
        setError(e?.response?.data?.detail || 'Could not load comparison data.')
        setLoading(false)
      })
  }, [sessionId, proId])

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return <div className="text-center py-16 text-red-400">{error}</div>
  }

  const userPhase = phaseSummary?.phases?.find((p) => p.phase === selectedPhase)
  const proPhase  = proData?.phases?.[selectedPhase]

  return (
    <div className="space-y-6">
      {/* Phase selector */}
      <div className="flex flex-wrap gap-2">
        {PHASE_ORDER.map((name) => {
          const ud  = phaseSummary?.phases?.find((p) => p.phase === name)
          const rms = ud?.avg_deviation_rms
          return (
            <button
              key={name}
              onClick={() => setSelectedPhase(name)}
              className={`relative px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                selectedPhase === name
                  ? 'bg-brand-500 text-black'
                  : 'bg-surface-700 text-gray-400 hover:text-white'
              }`}
            >
              {name}
              {rms != null && selectedPhase !== name && (
                <span className={`ml-1 text-[10px] font-bold ${
                  rms < 8 ? 'text-green-400' : rms < 15 ? 'text-yellow-400' : 'text-red-400'
                }`}>
                  {rms.toFixed(0)}°
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Honest disclaimer about the nature of the comparison */}
      <div className="text-xs text-gray-500 bg-surface-800 border border-surface-700 rounded-lg px-3 py-2">
        <span className="text-yellow-500 font-medium">Note:</span>{' '}
        The reference pose (right panel) is a <strong>biomechanical model</strong> computed from
        published joint-angle data for {proData?.name ?? 'the selected pro'} — it is not
        extracted from real footage. Angle comparisons are valid; visual resemblance is approximate.
      </div>

      {/* Side-by-side */}
      <div className="grid grid-cols-2 gap-3">
        {/* User panel */}
        <PosePanel
          title="You"
          subtitle={`Phase score: ${userPhase?.score?.overall?.toFixed(1) ?? '—'}/10`}
          frame={userPhase?.key_frame}
          isReal
        />

        {/* Pro panel */}
        <PosePanel
          title={`${proData?.name ?? 'Pro'} — Expected`}
          subtitle={proPhase?.notes?.[0] ?? proData?.bio ?? ''}
          syntheticKeypoints={proPhase?.synthetic_keypoints}
          proNotes={proPhase?.notes ?? []}
        />
      </div>

      {/* Metrics comparison table */}
      {userPhase && proPhase && (
        <MetricsTable
          userAngles={userPhase.avg_angles}
          proAngles={proPhase}
          proName={proData?.name}
          deviationRms={userPhase.avg_deviation_rms}
        />
      )}

      {/* Deviation bars */}
      {userPhase && proPhase && (
        <DeviationBars userAngles={userPhase.avg_angles} proPhase={proPhase} />
      )}
    </div>
  )
}

// ── User panel (real photo + skeleton) ───────────────────────────────────

function PosePanel({ title, subtitle, frame, isReal, syntheticKeypoints, proNotes = [] }) {
  const imgRef  = useRef(null)
  const [dims, setDims] = useState({ w: 0, h: 0 })

  const CANVAS_W = 300
  const CANVAS_H = 400

  return (
    <div className="bg-surface-800 border border-surface-700 rounded-2xl overflow-hidden">
      {/* Image / canvas area */}
      <div
        className="relative bg-black flex items-center justify-center"
        style={{ height: 280 }}
      >
        {isReal && frame ? (
          <>
            <img
              ref={imgRef}
              src={frame.image_url}
              alt={title}
              className="max-h-full max-w-full object-contain"
              onLoad={(e) => setDims({ w: e.target.offsetWidth, h: e.target.offsetHeight })}
            />
            {dims.w > 0 && (
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
              >
                <div style={{ position: 'relative', width: dims.w, height: dims.h }}>
                  <SkeletonOverlay
                    keypoints={frame.keypoints ?? {}}
                    deviation={frame.deviation_from_pro}
                    width={dims.w}
                    height={dims.h}
                  />
                </div>
              </div>
            )}
          </>
        ) : isReal ? (
          <div className="text-gray-600 text-sm">No frame available</div>
        ) : (
          /* Pro: render synthetic skeleton on a dark canvas */
          <SyntheticPoseCanvas
            keypoints={syntheticKeypoints}
            notes={proNotes}
            width={CANVAS_W}
            height={CANVAS_H}
          />
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3">
        <div className="font-semibold text-white text-sm">{title}</div>
        {subtitle && <div className="text-xs text-gray-400 mt-0.5 line-clamp-2">{subtitle}</div>}
      </div>
    </div>
  )
}

// ── Synthetic pose canvas (pro reference) ────────────────────────────────

function SyntheticPoseCanvas({ keypoints, notes = [], width, height }) {
  const canvasRef = useRef(null)

  const EDGES = [
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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !keypoints) return

    canvas.width  = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, width, height)

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, 0, height)
    grad.addColorStop(0, '#0f1a0f')
    grad.addColorStop(1, '#0a0a0a')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, width, height)

    const pt = (name) => {
      const kp = keypoints[name]
      if (!kp) return null
      return { x: kp.x * width, y: kp.y * height }
    }

    // Draw bones
    ctx.lineWidth   = 3
    ctx.lineCap     = 'round'
    for (const [a, b] of EDGES) {
      const pA = pt(a), pB = pt(b)
      if (!pA || !pB) continue
      ctx.beginPath()
      ctx.moveTo(pA.x, pA.y)
      ctx.lineTo(pB.x, pB.y)
      ctx.strokeStyle = '#4ade80cc'
      ctx.stroke()
    }

    // Draw joints
    for (const [name, kp] of Object.entries(keypoints)) {
      const x = kp.x * width
      const y = kp.y * height
      const r = name.includes('shoulder') || name.includes('hip') ? 6 : 5

      // Glow
      ctx.shadowColor = '#22c55e'
      ctx.shadowBlur  = 8
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = '#22c55e'
      ctx.fill()
      ctx.shadowBlur = 0
    }

    // "PRO REFERENCE" watermark
    ctx.font      = 'bold 11px monospace'
    ctx.fillStyle = '#22c55e55'
    ctx.fillText('PRO REFERENCE', 8, height - 8)
  }, [keypoints, width, height])

  if (!keypoints) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-sm">
        No pose data
      </div>
    )
  }

  return (
    <div className="relative">
      <canvas ref={canvasRef} style={{ width, height, maxWidth: '100%' }} />
      {/* Coaching notes overlay */}
      {notes.length > 0 && (
        <div className="absolute bottom-2 left-2 right-2 space-y-1">
          {notes.slice(0, 2).map((note, i) => (
            <div key={i} className="text-[10px] text-green-400 bg-black/60 px-2 py-0.5 rounded">
              ✓ {note}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Metrics comparison table ─────────────────────────────────────────────

function MetricsTable({ userAngles, proAngles, proName, deviationRms }) {
  const rows = [
    { label: 'Spine Angle',   user: userAngles?.spine_angle,       pro: proAngles?.spine_angle },
    { label: 'Hip Rotation',  user: userAngles?.hip_rotation,      pro: proAngles?.hip_rotation },
    { label: 'Shoulder Rot.', user: userAngles?.shoulder_rotation, pro: proAngles?.shoulder_rotation },
    { label: 'Left Elbow',    user: userAngles?.left_elbow_angle,  pro: proAngles?.left_elbow_angle },
    { label: 'Right Elbow',   user: userAngles?.right_elbow_angle, pro: proAngles?.right_elbow_angle },
  ].filter((r) => r.user != null || r.pro != null)

  return (
    <div className="bg-surface-800 border border-surface-700 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-4 text-xs font-medium text-gray-500 uppercase tracking-wider
                      px-4 py-2 border-b border-surface-700 bg-surface-900/60">
        <div>Metric</div>
        <div className="text-center">You</div>
        <div className="text-center">{proName?.split('(')[0].trim() ?? 'Pro'}</div>
        <div className="text-center">Δ</div>
      </div>

      {rows.map(({ label, user, pro }, i) => {
        const delta = user != null && pro != null ? user - pro : null
        return (
          <div
            key={label}
            className={`grid grid-cols-4 px-4 py-3 text-sm items-center ${
              i % 2 === 0 ? 'bg-surface-800' : 'bg-surface-800/50'
            }`}
          >
            <div className="text-gray-400 text-xs">{label}</div>

            <div className="text-center font-mono text-white">
              {user != null ? `${user.toFixed(1)}°` : '—'}
            </div>

            <div className="text-center font-mono text-green-400/80">
              {pro != null ? `${pro.toFixed(1)}°` : '—'}
            </div>

            <div className={`text-center font-mono font-medium text-xs ${deltaTextColor(delta)}`}>
              {delta != null
                ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}°`
                : '—'}
            </div>
          </div>
        )
      })}

      {deviationRms != null && (
        <div className="px-4 py-2 border-t border-surface-700 flex justify-between text-xs">
          <span className="text-gray-500">RMS deviation this phase</span>
          <span className={`font-mono font-bold ${
            deviationRms < 8 ? 'text-green-400' : deviationRms < 15 ? 'text-yellow-400' : 'text-red-400'
          }`}>
            {deviationRms.toFixed(1)}°
          </span>
        </div>
      )}
    </div>
  )
}

// ── Deviation bar chart ───────────────────────────────────────────────────

function DeviationBars({ userAngles, proPhase }) {
  const bars = [
    { label: 'Spine',    delta: (userAngles?.spine_angle       ?? null) !== null ? userAngles.spine_angle       - proPhase.spine_angle       : null },
    { label: 'Hips',     delta: (userAngles?.hip_rotation      ?? null) !== null ? userAngles.hip_rotation      - proPhase.hip_rotation      : null },
    { label: 'Shoulder', delta: (userAngles?.shoulder_rotation ?? null) !== null ? userAngles.shoulder_rotation - proPhase.shoulder_rotation : null },
    { label: 'L.Elbow',  delta: (userAngles?.left_elbow_angle  ?? null) !== null ? userAngles.left_elbow_angle  - proPhase.left_elbow_angle  : null },
  ].filter((b) => b.delta != null)

  if (!bars.length) return null

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 uppercase tracking-wider">Deviation from pro</p>
      {bars.map(({ label, delta }) => {
        const abs  = Math.abs(delta)
        const pct  = Math.min(100, (abs / 30) * 100)
        const side = delta >= 0 ? 'right' : 'left'
        return (
          <div key={label} className="flex items-center gap-3">
            <div className="w-20 text-xs text-gray-400 text-right flex-shrink-0">{label}</div>
            {/* Symmetric bar — center = 0 */}
            <div className="flex-1 h-3 bg-surface-700 rounded-full overflow-hidden relative">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-px h-full bg-surface-500" />
              </div>
              <div
                className={`absolute top-0 h-full rounded-full transition-all ${
                  abs < 5 ? 'bg-green-500' : abs < 15 ? 'bg-yellow-500' : 'bg-red-500'
                }`}
                style={{
                  width:  `${pct / 2}%`,
                  left:   side === 'right' ? '50%' : `${50 - pct / 2}%`,
                }}
              />
            </div>
            <div className={`w-12 text-right text-xs font-mono flex-shrink-0 ${deltaTextColor(delta)}`}>
              {delta > 0 ? '+' : ''}{delta.toFixed(1)}°
            </div>
          </div>
        )
      })}
    </div>
  )
}

function deltaTextColor(delta) {
  if (delta == null) return 'text-gray-500'
  const abs = Math.abs(delta)
  if (abs < 5)  return 'text-green-400'
  if (abs < 15) return 'text-yellow-400'
  return 'text-red-400'
}
