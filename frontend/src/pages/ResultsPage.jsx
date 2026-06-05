import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { fetchResults } from '../api/client'
import FeedbackPanel from '../components/FeedbackPanel'
import FrameGallery from '../components/FrameGallery'
import PhaseBreakdown from '../components/PhaseBreakdown'
import ProComparison from '../components/ProComparison'
import ScoreCard, { scoreColor } from '../components/ScoreCard'
import useAnalysisStore from '../store/analysisStore'
import useAuthStore from '../store/authStore'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'frames',   label: 'Frames'   },
  { id: 'compare',  label: 'Compare'  },
  { id: 'feedback', label: 'Feedback' },
]

export default function ResultsPage() {
  const { sessionId } = useParams()
  const navigate      = useNavigate()
  const { user }      = useAuthStore()
  const { analysis, setAnalysis, activeTab, setActiveTab } = useAnalysisStore()
  const [loading, setLoading] = useState(!analysis)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    if (analysis?.session_id === sessionId) return
    setLoading(true)
    fetchResults(sessionId)
      .then((data) => { setAnalysis(data); setLoading(false) })
      .catch((e)   => {
        setError(e?.response?.data?.detail || 'Could not load results.')
        setLoading(false)
      })
  }, [sessionId])

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-900 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-gray-400">Loading results…</p>
        </div>
      </div>
    )
  }

  if (error || !analysis) {
    return (
      <div className="min-h-screen bg-surface-900 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-red-400">{error || 'No results found.'}</p>
          <button onClick={() => navigate('/')} className="text-brand-400 underline">Start over</button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface-900">
      {/* ── Sticky header ── */}
      <header className="sticky top-0 z-20 bg-surface-900/90 backdrop-blur border-b border-surface-700">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-2xl hover:opacity-80 transition-opacity">⛳</Link>
            <div>
              <h1 className="font-bold text-white leading-none text-sm">Swing Analysis</h1>
              <p className="text-xs text-gray-500">vs {analysis.compared_pro_name}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Score badge */}
            <div className="text-right">
              <div className={`text-2xl font-bold font-mono ${scoreColor(analysis.overall_score)}`}>
                {analysis.overall_score?.toFixed(1)}
              </div>
              <div className="text-[10px] text-gray-500">overall</div>
            </div>

            {/* My swings / new */}
            <div className="flex gap-2">
              {user && (
                <Link
                  to="/swings"
                  className="text-xs text-gray-400 hover:text-white border border-surface-600
                             px-3 py-1.5 rounded-lg transition-colors"
                >
                  My Swings
                </Link>
              )}
              <button
                onClick={() => navigate('/')}
                className="text-xs text-gray-400 hover:text-white border border-surface-600
                           px-3 py-1.5 rounded-lg transition-colors"
              >
                New Swing
              </button>
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="max-w-6xl mx-auto px-4 flex gap-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-brand-500 text-brand-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* ── Tab content ── */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        {activeTab === 'overview' && <OverviewTab analysis={analysis} />}
        {activeTab === 'frames'   && <FrameGallery keyFrames={analysis.key_frames ?? []} />}
        {activeTab === 'compare'  && <ProComparison analysis={analysis} />}
        {activeTab === 'feedback' && <FeedbackPanel analysis={analysis} />}
      </main>
    </div>
  )
}

// ── Overview tab ─────────────────────────────────────────────────────────

function OverviewTab({ analysis }) {
  return (
    <div className="space-y-8">
      {/* Summary */}
      {analysis.summary && (
        <div className="bg-surface-800 rounded-2xl p-6 border border-surface-700">
          <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
            Coach Summary
          </h2>
          <p className="text-white leading-relaxed">{analysis.summary}</p>
        </div>
      )}

      {/* Strengths + improvements */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <InsightCard title="Strengths"    items={analysis.top_strengths}    color="green"  icon="✓" />
        <InsightCard title="Focus Areas"  items={analysis.top_improvements} color="yellow" icon="!" />
      </div>

      {/* Phase score grid */}
      <div>
        <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-4">
          Phase Scores
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {analysis.phases?.map((phase) => (
            <ScoreCard key={phase.name} phase={phase} />
          ))}
        </div>
      </div>

      {/* Drills */}
      {analysis.recommended_drills?.length > 0 && (
        <div className="bg-brand-500/5 border border-brand-500/20 rounded-2xl p-6">
          <h2 className="text-xs font-medium text-brand-400 uppercase tracking-wider mb-4">
            Recommended Drills
          </h2>
          <ol className="space-y-3">
            {analysis.recommended_drills.map((drill, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-6 h-6 bg-brand-500 text-black text-xs font-bold rounded-full
                                 flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <span className="text-white/85 text-sm leading-relaxed">{drill}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <PhaseBreakdown phases={analysis.phases ?? []} />
    </div>
  )
}

function InsightCard({ title, items, color, icon }) {
  const cls = {
    green:  'text-green-400 bg-green-400/10 border-green-400/20',
    yellow: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
  }
  return (
    <div className={`rounded-2xl p-5 border ${cls[color]}`}>
      <h3 className="font-semibold mb-3 text-sm">{title}</h3>
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
