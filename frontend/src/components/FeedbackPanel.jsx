import React from 'react'

/**
 * Full AI coaching feedback display.
 * Summary + drills at the top, then per-phase detailed cards.
 */
export default function FeedbackPanel({ analysis }) {
  return (
    <div className="space-y-8">
      {/* Executive summary */}
      {analysis.summary && (
        <div className="bg-surface-800 border border-surface-700 rounded-2xl p-6">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">AI Coach Summary</div>
          <p className="text-white leading-relaxed text-lg">{analysis.summary}</p>
        </div>
      )}

      {/* Strengths + improvements */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FeedbackSection
          title="Top Strengths"
          items={analysis.top_strengths}
          icon="✓"
          colorClass="text-green-400 border-green-500/20 bg-green-500/5"
        />
        <FeedbackSection
          title="Focus Areas"
          items={analysis.top_improvements}
          icon="!"
          colorClass="text-yellow-400 border-yellow-500/20 bg-yellow-500/5"
        />
      </div>

      {/* Recommended drills */}
      {analysis.recommended_drills?.length > 0 && (
        <div className="bg-brand-500/5 border border-brand-500/20 rounded-2xl p-6">
          <div className="text-brand-400 font-semibold mb-4 flex items-center gap-2">
            🏌️ Recommended Practice Drills
          </div>
          <ol className="space-y-4">
            {analysis.recommended_drills.map((drill, i) => (
              <li key={i} className="flex gap-4">
                <div className="w-7 h-7 rounded-full bg-brand-500 text-black text-sm font-bold
                                flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i + 1}
                </div>
                <p className="text-white/85 text-sm leading-relaxed">{drill}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Per-phase detailed feedback */}
      <div>
        <div className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">
          Per-Phase Coaching
        </div>
        <div className="space-y-4">
          {analysis.phases?.map((phase) => phase.feedback && (
            <PhaseFeedbackCard key={phase.name} phase={phase} />
          ))}
        </div>
      </div>
    </div>
  )
}

function FeedbackSection({ title, items, icon, colorClass }) {
  return (
    <div className={`rounded-2xl border p-5 ${colorClass}`}>
      <h3 className="font-semibold mb-3">{title}</h3>
      <ul className="space-y-2">
        {items?.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm text-white/80">
            <span className="font-bold flex-shrink-0">{icon}</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

function PhaseFeedbackCard({ phase }) {
  const fb    = phase.feedback
  const score = phase.score?.overall ?? 0

  return (
    <div className="bg-surface-800 border border-surface-700 rounded-xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold font-mono ${
          score >= 8 ? 'bg-green-500/10 text-green-400 border border-green-500/30'  :
          score >= 6 ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/30' :
                       'bg-red-500/10 text-red-400 border border-red-500/30'
        }`}>
          {score.toFixed(0)}
        </div>
        <div>
          <div className="font-semibold text-white">{phase.name}</div>
          <div className="text-xs text-gray-400">{fb.summary}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {fb.strengths?.length > 0 && (
          <div>
            <div className="text-xs text-green-400 font-medium mb-2">✓ Strengths</div>
            <ul className="space-y-1">
              {fb.strengths.map((s, i) => (
                <li key={i} className="text-xs text-white/75 leading-relaxed">{s}</li>
              ))}
            </ul>
          </div>
        )}

        {fb.improvements?.length > 0 && (
          <div>
            <div className="text-xs text-yellow-400 font-medium mb-2">! Improve</div>
            <ul className="space-y-1">
              {fb.improvements.map((s, i) => (
                <li key={i} className="text-xs text-white/75 leading-relaxed">{s}</li>
              ))}
            </ul>
          </div>
        )}

        {fb.drills?.length > 0 && (
          <div>
            <div className="text-xs text-blue-400 font-medium mb-2">→ Drill</div>
            <ul className="space-y-1">
              {fb.drills.map((s, i) => (
                <li key={i} className="text-xs text-white/75 leading-relaxed">{s}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
