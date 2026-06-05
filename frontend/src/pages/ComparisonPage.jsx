import React, { Component, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  fetchComparison, fetchLibrary, fetchMySessions,
  getFrameSelection, saveFrameSelection, startComparison,
  saveSwingToMySwings,
} from '../api/client'
import ComparisonPhaseView from '../components/ComparisonPhaseView'
import { scoreColor } from '../components/ScoreCard'
import useAuthStore from '../store/authStore'

// ---------------------------------------------------------------------------
// Error Boundary — catches any render crash and shows a readable error instead
// of a black blank screen.
// ---------------------------------------------------------------------------
class ComparisonErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(err) { return { error: err } }
  componentDidCatch(err, info) { console.error('[ComparisonPage] Render error:', err, info) }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-surface-900 flex items-center justify-center px-4">
          <div className="max-w-md text-center space-y-4">
            <p className="text-red-400 text-xl font-semibold">Something went wrong rendering the results</p>
            <p className="text-gray-400 text-sm font-mono">{String(this.state.error)}</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => window.location.reload()}
                className="text-sm bg-surface-700 hover:bg-surface-600 text-white px-4 py-2 rounded-lg">
                Reload page
              </button>
              <button onClick={() => window.history.back()}
                className="text-sm text-gray-400 hover:text-white underline">
                Go back
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

const LOADING_STAGES = [
  { label: 'Extracting selected frames',    ms: 2500 },
  { label: 'Detecting pose landmarks',      ms: 5000 },
  { label: 'Computing angle deviations',   ms: 2500 },
  { label: 'Scoring your swing',           ms: 1500 },
]

function ComparisonPageInner() {
  const { sessionId }   = useParams()
  const navigate        = useNavigate()
  const { user }        = useAuthStore()
  const [comparison,    setComparison]   = useState(null)
  const [loading,       setLoading]      = useState(true)
  const [error,         setError]        = useState(null)
  const [saveState,     setSaveState]    = useState('idle')
  // Reference switcher
  const [library,       setLibrary]      = useState([])
  const [switching,     setSwitching]    = useState(false)  // true = re-running comparison
  const [switchMsg,     setSwitchMsg]    = useState('')     // message during switching
  const [switchError,   setSwitchError]  = useState(null)

  useEffect(() => {
    if (!sessionId) return
    let active    = true
    let attempts  = 0
    const MAX     = 30

    const poll = async () => {
      try {
        const data = await fetchComparison(sessionId)
        if (!active) return

        // Guard: a result with 0 phases is a stale/failed run — keep polling
        const phaseCount = Object.keys(data?.phases ?? {}).length
        if (phaseCount === 0 && attempts < MAX) {
          attempts++
          setTimeout(poll, 2000)
          return
        }

        setComparison(data)
        setLoading(false)
      } catch (e) {
        if (!active) return
        const status = e?.response?.status
        if ((status === 202 || status === 404) && attempts < MAX) {
          // 202 = still running; early 404 = background task not started yet
          attempts++
          setTimeout(poll, 1500)
        } else {
          setError(e?.response?.data?.detail || 'Could not load comparison results.')
          setLoading(false)
        }
      }
    }
    poll()
    return () => { active = false }
  }, [sessionId])

  // Load library entries for the reference switcher
  useEffect(() => {
    fetchLibrary().then(setLibrary).catch(() => {})
  }, [])

  // Switch the active reference and re-run the comparison
  const handleSwitchReference = async (entry) => {
    setSwitchError(null)

    // Check if this reference has saved phase times
    const phaseTimes = entry.phase_times ?? {}
    const hasPhases  = Object.keys(phaseTimes).length >= 8

    if (!hasPhases) {
      // Redirect to frame selection with this reference pre-loaded
      const params = new URLSearchParams({
        ref:      entry.id,
        hand:     comparison?.handedness   ?? 'right',
        cam:      comparison?.camera_angle ?? 'dtl',
        videoUrl: comparison?.user_video_url ?? '',
      })
      navigate(`/frame-selection/${sessionId}?${params}`)
      return
    }

    // Has phase times → re-run comparison automatically
    setSwitching(true)
    setSwitchMsg(`Switching to ${entry.name}…`)
    try {
      // 1. Read current user frame times
      const currentSel = await getFrameSelection(sessionId)

      // 2. Update frame selection with new reference
      await saveFrameSelection(sessionId, {
        reference_id:    entry.id,
        user_times:      currentSel.user_times      ?? {},
        reference_times: phaseTimes,
        handedness:      currentSel.handedness      ?? 'right',
        camera_angle:    currentSel.camera_angle     ?? 'dtl',
        gender:          currentSel.gender           ?? 'male',
        club_type:       currentSel.club_type        ?? 'driver',
      })

      // 3. Re-run comparison
      setSwitchMsg('Running comparison…')
      await startComparison(sessionId)

      // 4. Poll until new result arrives (empty-phase guard included)
      let attempts = 0
      while (attempts < 60) {
        try {
          const data = await fetchComparison(sessionId)
          if (Object.keys(data?.phases ?? {}).length > 0) {
            setComparison(data)
            setSaveState('idle')   // score changed — reset save state
            break
          }
        } catch (e) {
          if (e?.response?.status !== 202 && e?.response?.status !== 404) throw e
        }
        attempts++
        await new Promise(r => setTimeout(r, 1500))
      }
      if (attempts >= 60) throw new Error('Comparison timed out.')

    } catch (e) {
      setSwitchError(e?.response?.data?.detail || e?.message || 'Switch failed.')
    } finally {
      setSwitching(false)
      setSwitchMsg('')
    }
  }

  // Once comparison is loaded AND user is logged in, check if already saved.
  // This keeps the "Saved to My Swings" state across page reloads.
  useEffect(() => {
    if (!comparison || !user || saveState === 'saved') return
    fetchMySessions()
      .then(sessions => {
        if (sessions.some(s => s.session_id === sessionId)) {
          setSaveState('saved')
        }
      })
      .catch(() => {})   // non-critical — ignore if request fails
  }, [comparison, user, sessionId])

  if (loading) return <LoadingScreen />

  if (error) {
    return (
      <div className="min-h-screen bg-surface-900 flex items-center justify-center">
        <div className="text-center space-y-4 max-w-sm px-4">
          <p className="text-red-400 text-lg font-semibold">Analysis failed</p>
          <p className="text-gray-400 text-sm">{error}</p>
          <button onClick={() => navigate(`/frame-selection/${sessionId}`)}
            className="text-brand-400 underline text-sm">
            ← Back to Frame Selection
          </button>
        </div>
      </div>
    )
  }

  if (!comparison) return null

  const overall = comparison.overall_score ?? 0

  return (
    <div className="min-h-screen bg-surface-900">
      {/* ── Header ── */}
      <header className="sticky top-0 z-20 bg-surface-900/90 backdrop-blur border-b border-surface-700">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⛳</span>
            <div>
              <h1 className="font-bold text-white text-sm leading-none">Phase Comparison</h1>
              <p className="text-xs text-gray-500">
                vs {comparison.reference_name ?? 'Reference Swing'}
                {comparison.camera_angle ? ` · ${comparison.camera_angle.toUpperCase()}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Score — with weighted breakdown tooltip */}
            <div
              className="text-right mr-1 group relative cursor-help"
              title="Weighted: Impact 40% · Downswing 25% · Top of Swing 20%"
            >
              <div className={`text-2xl font-bold font-mono ${scoreColor(overall)}`}>
                {overall.toFixed(1)}
              </div>
              <div className="text-[10px] text-gray-500">overall</div>
              {/* Rich tooltip on hover */}
              <div className="absolute right-0 top-full mt-2 z-30 hidden group-hover:block
                              bg-surface-700 border border-surface-600 rounded-xl px-3 py-2
                              text-left shadow-xl w-52 pointer-events-none">
                <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider mb-1.5">
                  Score weights
                </p>
                {[
                  ['Impact',        '40%'],
                  ['Downswing',     '25%'],
                  ['Top of Swing',  '20%'],
                  ['Other phases',  '15%'],
                ].map(([label, pct]) => (
                  <div key={label} className="flex justify-between text-xs py-0.5">
                    <span className="text-gray-300">{label}</span>
                    <span className="text-white font-mono">{pct}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Save Swing */}
            <SaveButton
              sessionId={sessionId}
              user={user}
              saveState={saveState}
              setSaveState={setSaveState}
            />

            {/* Overlay comparison */}
            <Link to={`/overlay/${sessionId}`}
              className="text-xs text-gray-400 hover:text-white border border-surface-600
                         px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap">
              View Overlay
            </Link>

            <Link to={`/frame-selection/${sessionId}`}
              className="text-xs text-gray-400 hover:text-white border border-surface-600 px-3 py-1.5 rounded-lg transition-colors">
              Edit Frames
            </Link>
            <Link to="/"
              className="text-xs text-gray-400 hover:text-white border border-surface-600 px-3 py-1.5 rounded-lg transition-colors">
              New Swing
            </Link>
          </div>
        </div>
      </header>

      {/* ── Switching overlay ── */}
      {switching && (
        <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-surface-800 border border-surface-600 rounded-2xl px-8 py-6 text-center space-y-4 max-w-sm w-full mx-4">
            <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-white font-semibold">{switchMsg}</p>
            <p className="text-gray-400 text-xs">Extracting frames and re-running analysis…</p>
          </div>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">

        {/* ── Reference Switcher ── */}
        <ReferenceSwitcher
          library={library}
          currentRefId={comparison.reference_id}
          currentRefName={comparison.reference_name}
          sessionId={sessionId}
          switching={switching}
          switchError={switchError}
          onSwitch={handleSwitchReference}
          navigate={navigate}
          filterCameraAngle={comparison.camera_angle}
          filterClubType={comparison.club_type}
        />

        <ComparisonPhaseView comparison={comparison} />

        {/* AI Swing Coach */}
        {comparison.ai_feedback && (
          <AICoachSection feedback={comparison.ai_feedback} phases={comparison.phases} />
        )}

        {/* Phase score grid */}
        {Object.keys(comparison?.phases ?? {}).length > 0 && (
          <div>
            <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-4">
              Phase Scores
            </h2>
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(comparison.phases).map(([phase, data]) => (
                <div key={phase} className="bg-surface-800 border border-surface-700 rounded-xl p-3">
                  <p className="text-xs text-gray-500 truncate">{phase}</p>
                  <p className={`text-xl font-bold font-mono mt-1 ${scoreColor(data.score)}`}>
                    {data.score.toFixed(1)}
                  </p>
                  <p className={`text-[10px] font-mono ${
                    data.rms_deviation < 8  ? 'text-green-400' :
                    data.rms_deviation < 15 ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                    Δ {data.rms_deviation.toFixed(1)}°
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Metadata strip */}
        <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-4
                        grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          {[
            ['Handedness', comparison.handedness === 'right' ? 'Right-handed' : 'Left-handed'],
            ['Camera',     comparison.camera_angle?.toUpperCase() ?? '—'],
            ['Reference',  comparison.reference_name ?? 'None'],
            ['Phases',     `${Object.keys(comparison?.phases ?? {}).length}/8 analyzed`],
          ].map(([label, val]) => (
            <div key={label}>
              <p className="text-gray-500 text-xs">{label}</p>
              <p className="text-white font-medium">{val}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Save Button — handles auth state, loading, and success/error feedback
// ---------------------------------------------------------------------------

function SaveButton({ sessionId, user, saveState, setSaveState }) {
  const navigate = useNavigate()

  const handleSave = async () => {
    if (!user) {
      // Not logged in — send to login, come back after
      navigate(`/login?next=/comparison/${sessionId}`)
      return
    }
    if (saveState === 'saved') return  // already saved

    setSaveState('saving')
    try {
      await saveSwingToMySwings(sessionId)
      setSaveState('saved')
    } catch (e) {
      console.error('Save failed:', e)
      setSaveState('error')
      // Reset to idle after 3s so user can retry
      setTimeout(() => setSaveState('idle'), 3000)
    }
  }

  if (!user) {
    return (
      <button
        onClick={handleSave}
        title="Sign in to save this swing to My Swings"
        className="flex items-center gap-1.5 text-xs border border-dashed border-gray-600
                   text-gray-400 hover:text-white hover:border-gray-400 px-3 py-1.5 rounded-lg
                   transition-colors"
      >
        <span>🔒</span> Sign in to Save
      </button>
    )
  }

  const styles = {
    idle:   'bg-brand-500 hover:bg-brand-600 text-black',
    saving: 'bg-brand-500/50 text-black/60 cursor-not-allowed',
    saved:  'bg-green-700/30 text-green-400 border border-green-700/50 cursor-default',
    error:  'bg-red-900/30 text-red-400 border border-red-700/50',
  }

  const labels = {
    idle:   '💾 Save Swing',
    saving: 'Saving…',
    saved:  '✓ Saved to My Swings',
    error:  '✕ Save failed — retry',
  }

  return (
    <button
      onClick={handleSave}
      disabled={saveState === 'saving' || saveState === 'saved'}
      className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg
                  transition-all ${styles[saveState]}`}
    >
      {saveState === 'saving' && (
        <span className="w-3 h-3 border border-black/40 border-t-transparent rounded-full animate-spin" />
      )}
      {labels[saveState]}
    </button>
  )
}


// Wrapped export with error boundary
export default function ComparisonPage() {
  return (
    <ComparisonErrorBoundary>
      <ComparisonPageInner />
    </ComparisonErrorBoundary>
  )
}

// ── Reference Switcher ────────────────────────────────────────────────────

const CLUB_LABELS = { driver:'🏌️ Driver', irons:'⛳ Irons', wedges:'🔧 Wedges', putter:'🎯 Putter', other:'📐 Other' }

function ReferenceSwitcher({ library, currentRefId, currentRefName, sessionId, switching, switchError, onSwitch, navigate, filterCameraAngle, filterClubType }) {
  // Filter by camera angle AND club type — gender intentionally excluded.
  const filtered = library.filter(e => {
    if (filterCameraAngle && e.camera_angle !== filterCameraAngle) return false
    if (filterClubType    && e.club_type    !== filterClubType)    return false
    return true
  })

  const hasLibrary = filtered.length > 0
  const hasAny     = library.length > 0

  return (
    <div className="bg-surface-800/60 border border-surface-700 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">
            Compare against
          </p>
          {!currentRefId && hasLibrary && (
            <p className="text-yellow-400 text-xs mt-0.5">
              No reference selected — pick one below to see your score
            </p>
          )}
          {/* Explain active filters */}
          {(filterCameraAngle || filterClubType) && (
            <p className="text-gray-600 text-[10px] mt-0.5">
              Showing {filterClubType ?? 'all clubs'} · {filterCameraAngle === 'dtl' ? 'Down the Line' : filterCameraAngle === 'face_on' ? 'Face On' : filterCameraAngle ?? 'any angle'} only
            </p>
          )}
        </div>
        <Link
          to="/library"
          className="text-xs text-gray-500 hover:text-brand-400 underline"
        >
          Manage library →
        </Link>
      </div>

      {/* Error */}
      {switchError && (
        <p className="text-red-400 text-xs bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
          {switchError}
        </p>
      )}

      {/* No matches message */}
      {hasAny && !hasLibrary && (
        <p className="text-gray-500 text-xs">
          No library entries match {filterClubType} / {filterCameraAngle === 'dtl' ? 'down-the-line' : 'face-on'}.
          {' '}<Link to="/library" className="text-brand-400 hover:underline">Add one →</Link>
        </p>
      )}

      {/* Reference pills — filtered list only */}
      {hasLibrary ? (
        <div className="flex flex-wrap gap-2">
          {filtered.map(entry => {
            const isActive    = entry.id === currentRefId
            const hasPhases   = Object.keys(entry.phase_times ?? {}).length >= 8
            return (
              <button
                key={entry.id}
                onClick={() => !switching && onSwitch(entry)}
                disabled={switching}
                title={hasPhases ? '' : 'No phase points saved — click to set them in Frame Selection'}
                className={`group flex items-center gap-2 px-3 py-2 rounded-xl border text-sm
                            font-medium transition-all disabled:cursor-wait ${
                  isActive
                    ? 'border-brand-500 bg-brand-500/10 text-white'
                    : 'border-surface-600 bg-surface-800 text-gray-400 hover:border-gray-500 hover:text-white'
                }`}
              >
                {/* Thumbnail */}
                {entry.thumbnail_url ? (
                  <img src={entry.thumbnail_url} alt=""
                    className="w-6 h-8 object-cover rounded flex-shrink-0" />
                ) : (
                  <span className="text-base">🏌️</span>
                )}

                <span className="truncate max-w-[120px]">{entry.name}</span>

                {/* Metadata pills */}
                <span className="text-[9px] text-gray-500 hidden group-hover:inline">
                  {entry.camera_angle?.toUpperCase()}
                </span>

                {isActive && (
                  <span className="text-brand-500 text-xs font-bold">✓</span>
                )}

                {/* No-phases warning dot */}
                {!hasPhases && !isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 flex-shrink-0"
                    title="No phase points — click to set" />
                )}
              </button>
            )
          })}
        </div>
      ) : !hasAny ? (
        <div className="flex items-center gap-3 text-sm text-gray-500 py-1">
          <span>No reference swings in library yet.</span>
          <Link to="/library" className="text-brand-400 hover:underline">
            Add one →
          </Link>
        </div>
      ) : null}

      {/* Active reference info */}
      {currentRefId && library.length > 0 && (() => {
        const active = library.find(e => e.id === currentRefId)
        if (!active) return null
        return (
          <div className="flex items-center gap-3 pt-1 border-t border-surface-700 text-xs text-gray-500">
            <span>Active: <span className="text-white font-medium">{active.name}</span></span>
            {active.gender && <span>· {active.gender === 'male' ? 'Male' : 'Female'}</span>}
            {active.club_type && <span>· {CLUB_LABELS[active.club_type] || active.club_type}</span>}
            {active.camera_angle && <span>· {active.camera_angle === 'dtl' ? 'Down the Line' : 'Face On'}</span>}
          </div>
        )
      })()}
    </div>
  )
}


// ── AI Swing Coach section ────────────────────────────────────────────────

function AICoachSection({ feedback, phases }) {
  const [expanded, setExpanded] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'phases',   label: 'Phase Tips' },
    { id: 'drills',   label: 'Drills' },
  ]

  return (
    <div className="border border-brand-500/30 rounded-2xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 bg-brand-500/5 hover:bg-brand-500/10 transition-colors text-left"
      >
        <span className="text-xl">🤖</span>
        <div className="flex-1">
          <span className="font-bold text-white">AI Swing Coach</span>
          {!feedback.generated && (
            <span className="ml-2 text-xs text-gray-500 font-normal">
              (set ANTHROPIC_API_KEY for personalised coaching)
            </span>
          )}
        </div>
        <span className="text-gray-400 text-sm">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="bg-surface-800/50 p-5 space-y-5">
          {/* Summary */}
          {feedback.summary && (
            <p className="text-white leading-relaxed">{feedback.summary}</p>
          )}

          {/* Tab bar */}
          <div className="flex gap-0 border-b border-surface-700">
            {TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-brand-500 text-brand-400'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'overview' && (
            <div className="grid md:grid-cols-2 gap-4">
              {feedback.top_strengths?.length > 0 && (
                <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4">
                  <h3 className="text-green-400 font-semibold text-sm mb-3">✓ Strengths</h3>
                  <ul className="space-y-2">
                    {feedback.top_strengths.map((s, i) => (
                      <li key={i} className="text-sm text-white/80 flex gap-2">
                        <span className="text-green-400 flex-shrink-0">•</span>{s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {feedback.top_improvements?.length > 0 && (
                <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4">
                  <h3 className="text-yellow-400 font-semibold text-sm mb-3">! Focus Areas</h3>
                  <ul className="space-y-2">
                    {feedback.top_improvements.map((s, i) => (
                      <li key={i} className="text-sm text-white/80 flex gap-2">
                        <span className="text-yellow-400 flex-shrink-0">•</span>{s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {activeTab === 'phases' && (
            <div className="space-y-3">
              {Object.entries(feedback.phase_tips ?? {}).map(([phase, tip]) => {
                const pd = phases[phase]
                const rms = pd?.rms_deviation ?? 0
                return (
                  <div key={phase} className="flex gap-4 items-start bg-surface-800 rounded-xl p-3">
                    <div className="flex-shrink-0 w-24">
                      <p className="text-white text-xs font-semibold">{phase}</p>
                      <p className={`text-[10px] font-mono mt-0.5 ${
                        rms < 8 ? 'text-green-400' : rms < 15 ? 'text-yellow-400' : 'text-red-400'
                      }`}>
                        Δ {rms.toFixed(1)}°
                      </p>
                    </div>
                    <p className="text-sm text-white/80 leading-relaxed">{tip}</p>
                  </div>
                )
              })}
            </div>
          )}

          {activeTab === 'drills' && (
            <div className="space-y-3">
              {(feedback.recommended_drills ?? []).map((drill, i) => (
                <div key={i} className="flex gap-4 items-start">
                  <div className="w-7 h-7 bg-brand-500 rounded-full flex items-center justify-center text-black text-xs font-bold flex-shrink-0 mt-0.5">
                    {i + 1}
                  </div>
                  <p className="text-sm text-white/85 leading-relaxed">{drill}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}


// ── Animated loading screen ────────────────────────────────────────────────

function LoadingScreen() {
  const [stageIdx, setStageIdx]   = useState(0)
  const [dots,     setDots]       = useState('')
  const [progress, setProgress]   = useState(4)   // start non-zero for visual pop

  // Advance through stages on a timer that matches real processing time
  useEffect(() => {
    let elapsed = 0
    const timers = LOADING_STAGES.map((stage, i) => {
      elapsed += stage.ms
      return setTimeout(() => {
        setStageIdx(i + 1)
        setProgress(Math.min(96, Math.round(((i + 1) / LOADING_STAGES.length) * 90 + 4)))
      }, elapsed)
    })
    return () => timers.forEach(clearTimeout)
  }, [])

  // Dot animation on current stage
  useEffect(() => {
    const t = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 380)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="min-h-screen bg-surface-900 flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-8">

        {/* Icon */}
        <div className="text-center">
          <div className="text-5xl mb-4">⛳</div>
          <h1 className="text-2xl font-bold text-white">Generating Comparison</h1>
          <p className="text-gray-400 text-sm mt-1">
            Analyzing your selected swing frames
          </p>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-brand-500 rounded-full transition-all duration-700 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Stages */}
        <div className="space-y-4">
          {LOADING_STAGES.map((stage, i) => {
            const done    = i < stageIdx
            const current = i === stageIdx
            const pending = i > stageIdx
            return (
              <div key={stage.label} className="flex items-center gap-4">
                {/* Status icon */}
                <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center">
                  {done ? (
                    <div className="w-7 h-7 bg-brand-500 rounded-full flex items-center justify-center">
                      <span className="text-black text-xs font-bold">✓</span>
                    </div>
                  ) : current ? (
                    <div className="w-7 h-7 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <div className="w-7 h-7 border-2 border-surface-600 rounded-full" />
                  )}
                </div>

                {/* Label */}
                <span className={`text-sm font-medium transition-colors ${
                  done    ? 'text-brand-400' :
                  current ? 'text-white'      :
                             'text-gray-600'
                }`}>
                  {stage.label}
                  {current && <span className="text-gray-400">{dots}</span>}
                </span>
              </div>
            )
          })}
        </div>

        <p className="text-center text-xs text-gray-600">
          Usually takes 5–15 seconds
        </p>
      </div>
    </div>
  )
}
