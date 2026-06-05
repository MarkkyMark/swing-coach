import React, { useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchResults, startProcessing, subscribeToProgress } from '../api/client'
import useAnalysisStore from '../store/analysisStore'

const STAGES = [
  { key: 'extracting',       label: 'Extract Frames',   icon: '🎞️' },
  { key: 'pose_detection',   label: 'Detect Pose',      icon: '🦴' },
  { key: 'phase_detection',  label: 'Detect Phases',    icon: '〰️' },
  { key: 'comparison',       label: 'Compare to Pro',   icon: '⚖️' },
  { key: 'scoring',          label: 'Score',            icon: '⭐' },
  { key: 'feedback',         label: 'AI Feedback',      icon: '💬' },
]

const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.key, i]))

export default function ProcessingPage() {
  const { sessionId }  = useParams()
  const navigate       = useNavigate()
  const cleanupRef     = useRef(null)

  const { pipelineStatus, currentStage, overallProgress, progressMessage,
          pipelineError, setAnalysis, updateProgress } = useAnalysisStore()

  useEffect(() => {
    if (!sessionId) { navigate('/'); return }

    // If we navigated here fresh (e.g., page reload), re-subscribe
    const attach = () => {
      cleanupRef.current = subscribeToProgress(
        sessionId,
        async (data) => {
          updateProgress(data)
          if (data.status === 'complete') {
            try {
              const analysis = await fetchResults(sessionId)
              setAnalysis(analysis)
              navigate(`/results/${sessionId}`)
            } catch {
              navigate(`/results/${sessionId}`)
            }
          }
        },
        () => {} // SSE error — the poll will still work via status endpoint
      )
    }

    // If pipeline hasn't started yet, kick it off first
    if (pipelineStatus === 'uploaded' || pipelineStatus === 'idle') {
      startProcessing(sessionId)
        .then(attach)
        .catch(() => attach()) // kick off subscription regardless
    } else {
      attach()
    }

    return () => cleanupRef.current?.()
  }, [sessionId])

  const currentStageIdx = STAGE_INDEX[currentStage] ?? -1

  return (
    <div className="min-h-screen bg-surface-900 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-lg space-y-10">

        {/* Logo */}
        <div className="text-center">
          <div className="text-5xl mb-3">⛳</div>
          <h1 className="text-2xl font-bold">Analyzing Your Swing</h1>
          <p className="text-gray-400 text-sm mt-1">{progressMessage || 'Starting pipeline…'}</p>
        </div>

        {/* Big circular progress */}
        <div className="flex justify-center">
          <CircularProgress value={overallProgress} />
        </div>

        {/* Stage track */}
        <div className="space-y-2">
          {STAGES.map((stage, i) => {
            const isDone    = i < currentStageIdx
            const isActive  = i === currentStageIdx
            const isPending = i > currentStageIdx
            return (
              <div
                key={stage.key}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  isActive  ? 'bg-brand-500/10 border border-brand-500/30' :
                  isDone    ? 'bg-surface-800'  :
                              'bg-surface-800/50 opacity-40'
                }`}
              >
                <span className="text-xl">{stage.icon}</span>
                <span className={`flex-1 text-sm font-medium ${
                  isActive ? 'text-brand-400' : isDone ? 'text-white' : 'text-gray-500'
                }`}>
                  {stage.label}
                </span>
                {isDone   && <span className="text-brand-500 text-sm">✓</span>}
                {isActive && (
                  <span className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                )}
              </div>
            )
          })}
        </div>

        {/* Error state */}
        {pipelineError && (
          <div className="bg-red-900/30 border border-red-700 text-red-400 rounded-xl px-4 py-3 text-sm">
            <p className="font-semibold mb-1">Analysis failed</p>
            <p>{pipelineError}</p>
            <button
              onClick={() => navigate('/')}
              className="mt-3 text-white underline text-xs"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Circular progress ring
// ---------------------------------------------------------------------------

function CircularProgress({ value }) {
  const r          = 54
  const circ       = 2 * Math.PI * r
  const pct        = Math.min(1, Math.max(0, value))
  const dashOffset = circ * (1 - pct)

  return (
    <div className="relative w-36 h-36">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none"
          stroke="#242424" strokeWidth="8" />
        <circle cx="60" cy="60" r={r} fill="none"
          stroke="#22c55e" strokeWidth="8"
          strokeDasharray={circ}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.4s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-white font-mono">
          {Math.round(pct * 100)}%
        </span>
      </div>
    </div>
  )
}
