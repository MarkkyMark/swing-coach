import React, { useState } from 'react'
import { scoreColor } from './ScoreCard'

/**
 * Accordion list of all 8 phases with score + feedback.
 */
export default function PhaseBreakdown({ phases }) {
  const [openPhase, setOpenPhase] = useState(null)

  return (
    <div>
      <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">
        Phase-by-Phase Breakdown
      </h2>
      <div className="space-y-2">
        {phases.map((phase) => (
          <PhaseAccordion
            key={phase.name}
            phase={phase}
            isOpen={openPhase === phase.name}
            onToggle={() => setOpenPhase(openPhase === phase.name ? null : phase.name)}
          />
        ))}
      </div>
    </div>
  )
}

function PhaseAccordion({ phase, isOpen, onToggle }) {
  const score   = phase.score?.overall ?? 0
  const color   = scoreColor(score)
  const fb      = phase.feedback

  return (
    <div className={`border rounded-xl overflow-hidden transition-colors ${
      isOpen ? 'border-surface-500 bg-surface-800' : 'border-surface-700 bg-surface-800/50'
    }`}>
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 px-4 py-3 text-left"
      >
        {/* Score ring */}
        <div className={`w-11 h-11 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
          score >= 8 ? 'border-green-500 bg-green-500/10'  :
          score >= 6 ? 'border-yellow-500 bg-yellow-500/10' :
                       'border-red-500 bg-red-500/10'
        }`}>
          <span className={`text-sm font-bold font-mono ${color}`}>
            {score.toFixed(0)}
          </span>
        </div>

        {/* Phase info */}
        <div className="flex-1">
          <div className="font-semibold text-white">{phase.name}</div>
          {fb?.summary
            ? <div className="text-xs text-gray-400 mt-0.5 line-clamp-1">{fb.summary}</div>
            : <div className="text-xs text-gray-600 mt-0.5">Tap to expand</div>
          }
        </div>

        {/* Deviation badge */}
        {phase.avg_deviation_rms != null && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${
            phase.avg_deviation_rms < 8  ? 'bg-green-500/10 text-green-400'  :
            phase.avg_deviation_rms < 15 ? 'bg-yellow-500/10 text-yellow-400' :
                                           'bg-red-500/10 text-red-400'
          }`}>
            Δ {phase.avg_deviation_rms.toFixed(1)}°
          </span>
        )}

        <span className="text-gray-500 text-sm ml-1">{isOpen ? '▲' : '▼'}</span>
      </button>

      {/* Body */}
      {isOpen && (
        <div className="px-4 pb-4 space-y-4 border-t border-surface-700">
          {/* Sub-scores */}
          {phase.score && (
            <div className="pt-4 grid grid-cols-3 gap-2">
              {[
                { label: 'Spine',     val: phase.score.spine_angle    },
                { label: 'Hips',      val: phase.score.hip_rotation   },
                { label: 'Arms',      val: phase.score.arm_position   },
              ].map(({ label, val }) => val != null && (
                <div key={label} className="bg-surface-700 rounded-lg p-2 text-center">
                  <div className={`text-lg font-bold font-mono ${scoreColor(val)}`}>
                    {val.toFixed(1)}
                  </div>
                  <div className="text-[10px] text-gray-500">{label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Avg angles */}
          {phase.avg_angles && (
            <AngleTable angles={phase.avg_angles} />
          )}

          {/* Feedback */}
          {fb && (
            <div className="space-y-3">
              {fb.strengths?.length > 0 && (
                <BulletSection title="Strengths" items={fb.strengths} color="green" prefix="✓" />
              )}
              {fb.improvements?.length > 0 && (
                <BulletSection title="Improve" items={fb.improvements} color="yellow" prefix="!" />
              )}
              {fb.drills?.length > 0 && (
                <BulletSection title="Drills" items={fb.drills} color="blue" prefix="→" />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AngleTable({ angles }) {
  const rows = [
    ['Spine Angle',   angles.spine_angle,       '°'],
    ['Hip Rotation',  angles.hip_rotation,      '°'],
    ['Shoulder Rot.', angles.shoulder_rotation, '°'],
    ['Left Elbow',    angles.left_elbow_angle,  '°'],
    ['Right Elbow',   angles.right_elbow_angle, '°'],
    ['Left Knee',     angles.left_knee_angle,   '°'],
  ].filter(([, v]) => v != null)

  if (!rows.length) return null
  return (
    <div>
      <div className="text-xs text-gray-500 mb-2">Avg. Angles</div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        {rows.map(([label, val, unit]) => (
          <div key={label} className="flex justify-between text-xs">
            <span className="text-gray-400">{label}</span>
            <span className="font-mono text-white">{val.toFixed(1)}{unit}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function BulletSection({ title, items, color, prefix }) {
  const colors = {
    green:  'text-green-400',
    yellow: 'text-yellow-400',
    blue:   'text-blue-400',
  }
  return (
    <div>
      <div className={`text-xs font-medium mb-1 ${colors[color]}`}>{title}</div>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm text-white/80">
            <span className={`font-bold flex-shrink-0 ${colors[color]}`}>{prefix}</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}
