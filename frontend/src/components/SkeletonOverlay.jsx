import React, { useEffect, useRef } from 'react'

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
 * Canvas-based skeleton overlay.
 * Renders on top of a frame image; keypoints are normalized [0,1].
 * Edges are color-coded by deviation severity (green/yellow/red).
 *
 * Props:
 *   keypoints  — { joint_name: { x, y, confidence } }
 *   deviation  — { spine_angle_delta, hip_rotation_delta, ... }
 *   width, height — canvas dimensions in px
 */
export default function SkeletonOverlay({ keypoints = {}, deviation = null, width, height }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !width || !height) return

    canvas.width  = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, width, height)

    if (!keypoints || Object.keys(keypoints).length === 0) return

    const reliable = (name) => {
      const kp = keypoints[name]
      return kp && kp.confidence > 0.5
    }

    const pt = (name) => {
      const kp = keypoints[name]
      if (!kp) return null
      return { x: kp.x * width, y: kp.y * height }
    }

    // Draw edges
    for (const [a, b] of SKELETON_EDGES) {
      if (!reliable(a) || !reliable(b)) continue
      const pA = pt(a), pB = pt(b)
      if (!pA || !pB) continue

      ctx.beginPath()
      ctx.moveTo(pA.x, pA.y)
      ctx.lineTo(pB.x, pB.y)
      ctx.strokeStyle = edgeColor(a, b, deviation)
      ctx.lineWidth   = 2.5
      ctx.lineCap     = 'round'
      ctx.stroke()
    }

    // Draw joints
    for (const [name, kp] of Object.entries(keypoints)) {
      if (!kp || kp.confidence <= 0.5) continue
      const x = kp.x * width
      const y = kp.y * height
      const r = name.includes('shoulder') || name.includes('hip') ? 5 : 4

      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle   = '#ffffff'
      ctx.shadowColor = 'rgba(0,0,0,0.8)'
      ctx.shadowBlur  = 4
      ctx.fill()
      ctx.shadowBlur  = 0
    }

    // Deviation label
    if (deviation) {
      const rms = computeRMS(deviation)
      if (rms > 8) {
        ctx.font      = 'bold 11px monospace'
        ctx.fillStyle = rms > 15 ? '#f87171' : '#facc15'
        ctx.fillText(`Δ ${rms.toFixed(0)}°`, 8, 16)
      }
    }
  }, [keypoints, deviation, width, height])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ width, height }}
    />
  )
}

// ── Helpers ────────────────────────────────────────────────────

function edgeColor(a, b, dev) {
  if (!dev) return '#22c55e'

  const joints = [a, b]
  let delta = null

  if (joints.some(j => j.includes('hip')))
    delta = dev.hip_rotation_delta
  else if (joints.some(j => j.includes('shoulder') && !j.includes('mid')))
    delta = dev.shoulder_rotation_delta ?? dev.spine_angle_delta
  else if (joints.some(j => j.includes('elbow')))
    delta = dev.left_elbow_angle_delta ?? dev.right_elbow_angle_delta

  if (delta == null) return '#22c55e'
  const severity = Math.abs(delta)
  if (severity < 5)  return '#22c55e'   // green
  if (severity < 15) return '#facc15'   // yellow
  return '#f87171'                       // red
}

function computeRMS(dev) {
  const vals = [
    dev.spine_angle_delta, dev.hip_rotation_delta,
    dev.shoulder_rotation_delta, dev.left_elbow_angle_delta,
  ].filter(v => v != null)
  if (!vals.length) return 0
  return Math.sqrt(vals.reduce((s, v) => s + v * v, 0) / vals.length)
}
