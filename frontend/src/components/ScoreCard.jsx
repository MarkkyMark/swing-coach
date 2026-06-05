import React from 'react'

/** Grade badge + numeric score for one swing phase. */
export default function ScoreCard({ phase }) {
  const score   = phase.score?.overall ?? 0
  const grade   = getGrade(score)
  const color   = scoreColor(score)
  const barPct  = (score / 10) * 100

  return (
    <div className="bg-surface-800 border border-surface-700 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider truncate">
          {phase.name}
        </span>
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${gradeClass(score)}`}>
          {grade}
        </span>
      </div>

      <div className={`text-3xl font-bold font-mono ${color}`}>
        {score.toFixed(1)}
      </div>

      {/* Bar */}
      <div className="h-1.5 bg-surface-600 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor(score)}`}
          style={{ width: `${barPct}%` }}
        />
      </div>

      {/* Sub-scores */}
      <div className="grid grid-cols-3 gap-1 text-center">
        {[
          { label: 'Spine', val: phase.score?.spine_angle },
          { label: 'Hips',  val: phase.score?.hip_rotation },
          { label: 'Arms',  val: phase.score?.arm_position },
        ].map(({ label, val }) => val != null && (
          <div key={label}>
            <div className={`text-xs font-mono font-bold ${scoreColor(val)}`}>
              {val.toFixed(1)}
            </div>
            <div className="text-[10px] text-gray-600">{label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function scoreColor(s) {
  if (s >= 8) return 'text-green-400'
  if (s >= 6) return 'text-yellow-400'
  if (s >= 4) return 'text-orange-400'
  return 'text-red-400'
}

function barColor(s) {
  if (s >= 8) return 'bg-green-500'
  if (s >= 6) return 'bg-yellow-500'
  if (s >= 4) return 'bg-orange-500'
  return 'bg-red-500'
}

function getGrade(s) {
  if (s >= 9) return 'A+'
  if (s >= 8) return 'A'
  if (s >= 7) return 'B'
  if (s >= 6) return 'C'
  if (s >= 5) return 'D'
  return 'F'
}

function gradeClass(s) {
  if (s >= 8) return 'bg-green-500/20 text-green-400'
  if (s >= 6) return 'bg-yellow-500/20 text-yellow-400'
  return 'bg-red-500/20 text-red-400'
}
