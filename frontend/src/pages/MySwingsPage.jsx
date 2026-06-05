import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { deleteSwingFromMySwings, fetchMySessions } from '../api/client'
import useAuthStore from '../store/authStore'
import { scoreColor } from '../components/ScoreCard'

export default function MySwingsPage() {
  const { user, clearAuth } = useAuthStore()
  const navigate             = useNavigate()
  const [sessions, setSessions] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)

  const load = () => {
    setLoading(true)
    fetchMySessions()
      .then(setSessions)
      .catch((e) => setError(e?.response?.data?.detail || 'Could not load sessions.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!user) { navigate('/login'); return }
    load()
  }, [user])

  const handleDelete = async (sessionId) => {
    try {
      await deleteSwingFromMySwings(sessionId)
      setSessions(prev => prev.filter(s => s.session_id !== sessionId))
    } catch (e) {
      setError('Could not delete — try again.')
    }
  }

  return (
    <div className="min-h-screen bg-surface-900">
      {/* Header */}
      <header className="border-b border-surface-700 bg-surface-900/90 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-white hover:text-brand-400 transition-colors">
            <span className="text-2xl">⛳</span>
            <span className="font-bold">Swing Coach</span>
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">{user?.email}</span>
            <button
              onClick={() => { clearAuth(); navigate('/') }}
              className="text-xs text-gray-500 hover:text-red-400 border border-surface-600
                         px-3 py-1.5 rounded-lg transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">My Swings</h1>
            <p className="text-gray-400 text-sm mt-1">
              {sessions.length} swing{sessions.length !== 1 ? 's' : ''} saved
            </p>
          </div>
          <Link
            to="/"
            className="bg-brand-500 hover:bg-brand-600 text-black font-semibold
                       px-4 py-2 rounded-xl text-sm transition-colors"
          >
            + Analyze New Swing
          </Link>
        </div>

        {loading && (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="text-red-400 bg-red-900/20 border border-red-800 rounded-xl p-4 mb-4">
            {error}
          </div>
        )}

        {!loading && sessions.length === 0 && !error && (
          <div className="text-center py-24 space-y-4">
            <div className="text-6xl">🏌️</div>
            <p className="text-gray-400 text-lg">No swing analyses yet.</p>
            <Link to="/" className="text-brand-400 hover:underline text-sm">
              Upload your first swing →
            </Link>
          </div>
        )}

        <div className="space-y-3">
          {sessions.map((s) => (
            <SessionCard
              key={s.session_id}
              session={s}
              onDelete={() => handleDelete(s.session_id)}
            />
          ))}
        </div>
      </main>
    </div>
  )
}

function SessionCard({ session, onDelete }) {
  const score  = session.overall_score
  const status = session.status
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting,      setDeleting]      = useState(false)

  const formattedDate = (() => {
    try {
      return new Date(session.created_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    } catch { return session.created_at }
  })()

  const handleDelete = async () => {
    setDeleting(true)
    await onDelete()
    // onDelete removes the card from the list — no need to reset state
  }

  return (
    <div className="bg-surface-800 border border-surface-700 rounded-2xl p-4
                    flex items-center gap-4 hover:border-surface-600 transition-colors group">

      {/* Thumbnail */}
      <div className="w-20 h-24 bg-surface-700 rounded-xl overflow-hidden flex-shrink-0">
        {session.thumbnail_url ? (
          <img src={session.thumbnail_url} alt="Swing" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-2xl">🏌️</div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-white font-semibold truncate">
            {session.compared_pro_name ? `vs ${session.compared_pro_name}` : 'Solo Analysis'}
          </span>
          <StatusBadge status={status} />
        </div>
        <p className="text-gray-500 text-xs">{formattedDate}</p>
      </div>

      {/* Score */}
      {score != null && (
        <div className="text-right flex-shrink-0">
          <div className={`text-2xl font-bold font-mono ${scoreColor(score)}`}>
            {score.toFixed(1)}
          </div>
          <div className="text-xs text-gray-500">score</div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* View button — comparison flow is the default for saved swings */}
        {status === 'complete' && (
          <Link
            to={`/comparison/${session.session_id}`}
            className="bg-surface-700 hover:bg-surface-600 text-white
                       text-xs font-medium px-3 py-2 rounded-lg transition-colors"
          >
            View →
          </Link>
        )}

        {/* Delete button */}
        {confirmDelete ? (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-red-400">Delete?</span>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-xs bg-red-900/40 hover:bg-red-900/70 text-red-400 border border-red-800
                         px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {deleting ? '…' : 'Yes'}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-xs text-gray-500 hover:text-white px-2 py-1.5"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400
                       transition-all p-1.5 rounded-lg hover:bg-red-900/20"
            title="Delete this swing"
          >
            🗑
          </button>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    complete:   'bg-green-500/10 text-green-400',
    failed:     'bg-red-500/10 text-red-400',
    processing: 'bg-yellow-500/10 text-yellow-400',
    uploaded:   'bg-gray-500/10 text-gray-400',
  }
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${map[status] ?? map.uploaded}`}>
      {status}
    </span>
  )
}
