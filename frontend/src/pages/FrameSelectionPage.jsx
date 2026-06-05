import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getLibraryEntry, getSessionInfo,
  saveFrameSelection, startComparison, getFrameSelection,
  getLibraryPhaseTimes, fetchComparison,
} from '../api/client'
import VideoFramePlayer, { PHASE_NAMES, PHASE_COLORS } from '../components/VideoFramePlayer'

/**
 * Frame Selection Page
 *
 * Two side-by-side video players.
 * User scrubs to each swing phase in both videos and clicks "Set as [Phase]".
 * Once all 8 phases are assigned for both videos, "Generate Comparison" is enabled.
 *
 * AI suggestions: auto-suggested times from DTW (if available) are shown
 * as hints — the user can accept or override.
 */
export default function FrameSelectionPage() {
  const { sessionId } = useParams()
  const navigate      = useNavigate()

  // Session metadata
  const [handedness,    setHandedness]    = useState('right')
  const [cameraAngle,   setCameraAngle]   = useState('dtl')
  const [gender,        setGender]        = useState('male')
  const [clubType,      setClubType]      = useState('driver')
  const [referenceId,   setReferenceId]   = useState(null)
  const [referenceEntry, setRefEntry]     = useState(null)
  const [userVideoUrl,  setUserVideoUrl]  = useState(null)
  const [refVideoUrl,   setRefVideoUrl]   = useState(null)

  // Frame assignments
  const [activePhase,   setActivePhase]   = useState(PHASE_NAMES[0])
  const [userTimes,     setUserTimes]     = useState({})  // { phase: seconds }
  const [refTimes,      setRefTimes]      = useState({})

  // AI suggestions (from DTW — non-authoritative hints)
  const [suggestions,   setSuggestions]   = useState({})  // { user: {...}, ref: {...} }

  // Status
  const [saveStatus,      setSaveStatus]       = useState(null)
  const [error,           setError]            = useState(null)
  const [refPhasesLoaded, setRefPhasesLoaded]  = useState(false)
  // Polling state — shown as a full-screen overlay while comparison runs
  const [comparisonStage, setComparisonStage] = useState(null)  // null | 'saving' | 'analyzing' | 'done'
  const [comparisonDots,  setComparisonDots]  = useState('')

  // Video player refs
  const userPlayerRef = useRef(null)
  const refPlayerRef  = useRef(null)
  const [userCurrentTime, setUserCurrentTime] = useState(0)
  const [refCurrentTime,  setRefCurrentTime]  = useState(0)

  // ── Bootstrap ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!sessionId) { navigate('/'); return }

    const qp = new URLSearchParams(window.location.search)

    // ── 1. Resolve user video URL ────────────────────────────────────────
    // Priority: videoUrl query param (set by UploadPage with real extension)
    //   → API fallback (scans disk for real extension — works after page refresh)
    const qpVideoUrl = qp.get('videoUrl')
    if (qpVideoUrl) {
      setUserVideoUrl(qpVideoUrl)
    } else {
      // Page was refreshed — ask the backend which extension the file actually has
      getSessionInfo(sessionId)
        .then(info => {
          if (info.video_url) setUserVideoUrl(info.video_url)
        })
        .catch(() => {
          // Last resort: try .mp4 (most common)
          setUserVideoUrl(`/sessions/${sessionId}/video.mp4`)
        })
    }

    // ── 2. Metadata from query params ────────────────────────────────────
    setHandedness(qp.get('hand')   || 'right')
    setCameraAngle(qp.get('cam')   || 'dtl')
    setGender(qp.get('gender')     || 'male')
    setClubType(qp.get('club')     || 'driver')

    // ── 3. Reference swing ───────────────────────────────────────────────
    const refId = qp.get('ref')
    if (refId) {
      setReferenceId(refId)
      getLibraryEntry(refId)
        .then(entry => {
          setRefEntry(entry)
          // Always use the API endpoint (extension-agnostic, proxied)
          setRefVideoUrl(`/api/library/${entry.id}/video`)

          // Pre-load saved reference phase timestamps so user doesn't re-select
          const saved = entry.phase_times
          if (saved && Object.keys(saved).length > 0) {
            setRefTimes(saved)
            setRefPhasesLoaded(true)
            console.log('[FrameSelection] Pre-loaded reference phases:', saved)
          } else {
            // Fallback: try phases API endpoint directly
            getLibraryPhaseTimes(entry.id)
              .then(result => {
                if (result.count > 0) {
                  setRefTimes(result.phase_times)
                  setRefPhasesLoaded(true)
                }
              })
              .catch(() => {})
          }
        })
        .catch(() => setRefEntry(null))
    }

    // ── 4. Restore previously saved frame selection ──────────────────────
    getFrameSelection(sessionId)
      .then(sel => {
        if (sel?.user_times      && Object.keys(sel.user_times).length > 0)
          setUserTimes(sel.user_times)
        if (sel?.reference_times && Object.keys(sel.reference_times).length > 0)
          setRefTimes(sel.reference_times)
      })
      .catch(() => {})
  }, [sessionId])

  // ── Auto-save on change ────────────────────────────────────────────────

  const doSave = useCallback(async (uTimes, rTimes) => {
    try {
      await saveFrameSelection(sessionId, {
        reference_id:    referenceId,
        user_times:      uTimes,
        reference_times: rTimes,
        handedness,
        camera_angle:    cameraAngle,
      })
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(null), 1500)
    } catch { /* non-critical */ }
  }, [sessionId, referenceId, handedness, cameraAngle])

  // ── Phase assignment handlers ─────────────────────────────────────────

  const setUserFrame = useCallback(() => {
    const newTimes = { ...userTimes, [activePhase]: Number(userCurrentTime.toFixed(3)) }
    setUserTimes(newTimes)
    doSave(newTimes, refTimes)
    // Advance to next unset phase automatically
    const next = PHASE_NAMES.find(p => !newTimes[p])
    if (next) setActivePhase(next)
  }, [activePhase, userCurrentTime, userTimes, refTimes, doSave])

  const setRefFrame = useCallback(() => {
    const newTimes = { ...refTimes, [activePhase]: Number(refCurrentTime.toFixed(3)) }
    setRefTimes(newTimes)
    doSave(userTimes, newTimes)
    const next = PHASE_NAMES.find(p => !newTimes[p])
    if (next) setActivePhase(next)
  }, [activePhase, refCurrentTime, refTimes, userTimes, doSave])

  const clearPhase = useCallback((phase) => {
    const newU = { ...userTimes }; delete newU[phase]
    const newR = { ...refTimes };  delete newR[phase]
    setUserTimes(newU)
    setRefTimes(newR)
    doSave(newU, newR)
  }, [userTimes, refTimes, doSave])

  // Accept AI suggestion
  const acceptSuggestion = useCallback((side, phase) => {
    const t = suggestions[side]?.[phase]
    if (t == null) return
    if (side === 'user') {
      const v = userPlayerRef.current; if (v) { v.seekTo(t) }
      setUserTimes(prev => { const n = {...prev, [phase]: t}; doSave(n, refTimes); return n })
    } else {
      const v = refPlayerRef.current; if (v) { v.seekTo(t) }
      setRefTimes(prev => { const n = {...prev, [phase]: t}; doSave(userTimes, n); return n })
    }
  }, [suggestions, refTimes, userTimes, doSave])

  // ── Dot animation for comparison overlay ─────────────────────────────

  useEffect(() => {
    if (!comparisonStage) return
    const t = setInterval(() => setComparisonDots(d => d.length >= 3 ? '' : d + '.'), 400)
    return () => clearInterval(t)
  }, [comparisonStage])

  // ── Analyze — poll from THIS page, navigate only when result is ready ─
  //
  // Why: if we navigate immediately after startComparison(), ComparisonPage
  // mounts while the result isn't ready. A JavaScript error during the first
  // render (e.g. in ComparisonPhaseView) silently unmounts everything → blank.
  // By polling here and navigating only after fetchComparison() returns 200,
  // ComparisonPage always renders with complete, valid data on first load.

  const handleAnalyze = async () => {
    if (!canAnalyze) return
    setError(null)
    setComparisonStage('saving')

    try {
      // 1. Save frame selection
      await saveFrameSelection(sessionId, {
        reference_id:    referenceId,
        user_times:      userTimes,
        reference_times: refTimes,
        handedness,
        camera_angle:    cameraAngle,
        gender,
        club_type:       clubType,
      })

      // 2. Start background comparison
      setComparisonStage('analyzing')
      await startComparison(sessionId)

      // 3. Poll until the result is ready — max 60 attempts × 1.5s = 90s
      let attempts = 0
      while (attempts < 60) {
        try {
          await fetchComparison(sessionId)
          // fetchComparison returned 200 → result is ready
          setComparisonStage('done')
          navigate(`/comparison/${sessionId}`)
          return
        } catch (pollErr) {
          const status = pollErr?.response?.status
          if (status === 202) {
            // Still running — wait and retry
            attempts++
            await new Promise(r => setTimeout(r, 1500))
          } else if (status === 404 && attempts < 8) {
            // 404 in the first ~12 seconds is normal — the background task
            // may not have started yet or we just cleared the stale result.
            attempts++
            await new Promise(r => setTimeout(r, 1500))
          } else {
            throw pollErr
          }
        }
      }
      throw new Error('Comparison timed out after 90 seconds.')

    } catch (e) {
      setComparisonStage(null)
      const detail = e?.response?.data?.detail || e?.message || 'Analysis failed.'
      setError(detail)
    }
  }

  const userComplete = Object.keys(userTimes).length === 8
  const refComplete  = refVideoUrl
    ? Object.keys(refTimes).length === 8
    : true  // no reference = skip ref requirement
  const canAnalyze   = userComplete && refComplete

  const phaseColor = PHASE_COLORS[activePhase] ?? '#22c55e'

  // ── Full-screen processing overlay ────────────────────────────────────
  // Rendered ON TOP of the frame selection page while comparison runs.
  // Navigating away is deferred until the result is confirmed ready.

  if (comparisonStage && comparisonStage !== 'done') {
    const STAGES = [
      { key: 'saving',    label: 'Saving frame selections' },
      { key: 'analyzing', label: 'Extracting & analysing frames' },
    ]
    const currentIdx = STAGES.findIndex(s => s.key === comparisonStage)

    return (
      <div className="min-h-screen bg-surface-900 flex items-center justify-center px-4">
        <div className="w-full max-w-md space-y-8 text-center">
          <div className="text-5xl">⛳</div>
          <div>
            <h1 className="text-2xl font-bold text-white">Generating Comparison</h1>
            <p className="text-gray-400 text-sm mt-1">Analysing your selected swing frames</p>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full transition-all duration-700 ease-out"
              style={{ width: comparisonStage === 'saving' ? '25%' : '75%' }}
            />
          </div>

          {/* Stage list */}
          <div className="space-y-4 text-left">
            {STAGES.map((stage, i) => {
              const done    = i < currentIdx
              const current = i === currentIdx
              return (
                <div key={stage.key} className="flex items-center gap-4">
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
                  <span className={`text-sm font-medium ${
                    done ? 'text-brand-400' : current ? 'text-white' : 'text-gray-600'
                  }`}>
                    {stage.label}
                    {current && <span className="text-gray-400">{comparisonDots}</span>}
                  </span>
                </div>
              )
            })}
            {/* Pose & AI stages are shown as pending extras */}
            {[
              'Running pose detection on selected frames',
              'Computing angle deviations',
              'Generating AI coaching feedback',
            ].map((label, i) => (
              <div key={label} className="flex items-center gap-4 opacity-40">
                <div className="w-7 h-7 border-2 border-surface-600 rounded-full flex-shrink-0" />
                <span className="text-sm text-gray-600">{label}</span>
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-600">Usually takes 10–20 seconds</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface-900">
      {/* ── Header ── */}
      <header className="sticky top-0 z-20 bg-surface-900/95 backdrop-blur border-b border-surface-700">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">⛳</span>
            <div>
              <h1 className="font-bold text-white text-sm leading-none">Frame Selection</h1>
              <p className="text-xs text-gray-500">Assign a frame for each swing phase</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {saveStatus && (
              <span className="text-xs text-green-400">✓ Saved</span>
            )}
            <div className="text-xs text-gray-400">
              You: <span className={userComplete ? 'text-green-400 font-bold' : 'text-yellow-400'}>
                {Object.keys(userTimes).length}/8
              </span>
              {refVideoUrl && (
                <>
                  {' · '}Ref: <span className={refComplete ? 'text-green-400 font-bold' : 'text-yellow-400'}>
                    {Object.keys(refTimes).length}/8
                  </span>
                </>
              )}
            </div>
            <button
              onClick={handleAnalyze}
              disabled={!canAnalyze || !!comparisonStage}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                canAnalyze && !comparisonStage
                  ? 'bg-brand-500 hover:bg-brand-600 text-black'
                  : 'bg-surface-700 text-gray-500 cursor-not-allowed'
              }`}
            >
              {comparisonStage ? 'Processing…' : 'Generate Comparison →'}
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* ── Error ── */}
        {/* ── Reference phase points pre-loaded banner ── */}
        {refPhasesLoaded && (
          <div className="bg-blue-900/20 border border-blue-700/40 text-blue-300 rounded-xl px-4 py-2.5 text-sm flex items-center gap-3">
            <span className="text-lg">💾</span>
            <div>
              <span className="font-semibold">Reference phase points loaded</span>
              <span className="text-blue-400 ml-2">
                — {Object.keys(refTimes).length}/8 phases pre-filled from last session.
                You can still adjust any frame.
              </span>
            </div>
            <button
              onClick={() => { setRefTimes({}); setRefPhasesLoaded(false) }}
              className="ml-auto text-blue-400 hover:text-white text-xs underline flex-shrink-0"
            >
              Clear & start fresh
            </button>
          </div>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-700 text-red-400 rounded-xl px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {/* ── Phase Selector (top bar) ── */}
        <div className="bg-surface-800 rounded-2xl p-4 border border-surface-700">
          <p className="text-xs text-gray-400 mb-3 uppercase tracking-wider font-medium">
            Currently setting: <span className="font-bold" style={{ color: phaseColor }}>{activePhase}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {PHASE_NAMES.map((phase) => {
              const uDone = userTimes[phase] != null
              const rDone = !refVideoUrl || refTimes[phase] != null
              const both  = uDone && rDone
              const active = phase === activePhase
              return (
                <button
                  key={phase}
                  onClick={() => setActivePhase(phase)}
                  className={`group relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium
                               border transition-all ${active
                    ? 'border-white/30 text-white'
                    : both
                    ? 'border-surface-600 text-gray-300'
                    : 'border-surface-700 text-gray-500 hover:border-surface-500'
                  }`}
                  style={active ? {
                    background: `${PHASE_COLORS[phase]}22`,
                    borderColor: PHASE_COLORS[phase],
                    color: PHASE_COLORS[phase],
                  } : {}}
                >
                  {both ? '✓ ' : ''}{phase}
                  {/* Clear button */}
                  {(uDone || rDone) && (
                    <span
                      onClick={(e) => { e.stopPropagation(); clearPhase(phase) }}
                      className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 ml-1 text-xs"
                      title="Clear this phase"
                    >✕</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Dual Video Players ── */}
        <div className={`grid gap-4 ${refVideoUrl ? 'grid-cols-2' : 'grid-cols-1 max-w-2xl mx-auto w-full'}`}>

          {/* User swing */}
          <VideoFramePlayer
            ref={userPlayerRef}
            src={userVideoUrl}
            label="Your Swing"
            assignments={userTimes}
            activePhase={activePhase}
            onTimeChange={setUserCurrentTime}
            onSetPhase={setUserFrame}
          />

          {/* Reference swing */}
          {refVideoUrl ? (
            <VideoFramePlayer
              ref={refPlayerRef}
              src={refVideoUrl}
              label={referenceEntry?.name ?? 'Reference Swing'}
              assignments={refTimes}
              activePhase={activePhase}
              onTimeChange={setRefCurrentTime}
              onSetPhase={setRefFrame}
            />
          ) : (
            <div className="flex items-center justify-center bg-surface-800 border border-surface-700
                            border-dashed rounded-2xl text-gray-600 text-sm text-center p-8">
              <div>
                <p className="text-3xl mb-2">📹</p>
                <p>No reference selected</p>
                <p className="text-xs mt-1">Go back to add a reference from the library</p>
                <button
                  onClick={() => navigate('/')}
                  className="mt-3 text-xs text-brand-400 hover:underline"
                >
                  ← Select Reference
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Phase Status Summary ── */}
        <div className="bg-surface-800 border border-surface-700 rounded-2xl p-4">
          <h3 className="text-sm font-medium text-gray-400 mb-3 uppercase tracking-wider">Phase Assignment Progress</h3>
          <div className="grid grid-cols-4 gap-2">
            {PHASE_NAMES.map(phase => {
              const uT = userTimes[phase]
              const rT = refTimes[phase]
              return (
                <div
                  key={phase}
                  onClick={() => setActivePhase(phase)}
                  className={`rounded-xl p-2 text-center cursor-pointer transition-all border ${
                    phase === activePhase
                      ? 'border-white/20'
                      : 'border-surface-700 hover:border-surface-500'
                  }`}
                  style={phase === activePhase ? {
                    background: `${PHASE_COLORS[phase]}11`,
                    borderColor: PHASE_COLORS[phase],
                  } : {}}
                >
                  <p className="text-xs font-medium text-white truncate">{phase}</p>
                  <div className="mt-1 space-y-0.5">
                    <p className={`text-[10px] font-mono ${uT != null ? 'text-green-400' : 'text-gray-600'}`}>
                      You: {uT != null ? `${uT.toFixed(2)}s` : '—'}
                    </p>
                    {refVideoUrl && (
                      <p className={`text-[10px] font-mono ${rT != null ? 'text-blue-400' : 'text-gray-600'}`}>
                        Ref: {rT != null ? `${rT.toFixed(2)}s` : '—'}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Instructions ── */}
        <div className="bg-surface-800/50 rounded-xl p-4 text-xs text-gray-500 space-y-1">
          <p><span className="text-white font-medium">How to use:</span></p>
          <p>1. Click a phase button above (e.g. <em>Address</em>)</p>
          <p>2. Scrub the video player to the exact frame for that phase</p>
          <p>3. Click <strong className="text-white">"Set frame as [Phase]"</strong> in the player</p>
          <p>4. Repeat for all 8 phases — keyboard ← → steps frame-by-frame</p>
          <p>5. Click <strong className="text-brand-400">Generate Comparison</strong> when all phases are set</p>
        </div>

      </div>
    </div>
  )
}
