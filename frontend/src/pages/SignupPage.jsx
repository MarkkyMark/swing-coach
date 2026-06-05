import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signup } from '../api/client'
import useAuthStore from '../store/authStore'

export default function SignupPage() {
  const navigate    = useNavigate()
  const { setAuth } = useAuthStore()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [error, setError]       = useState(null)
  const [loading, setLoading]   = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (password.length < 8)  { setError('Password must be at least 8 characters.'); return }

    setLoading(true)
    try {
      const { token, user_id, email: userEmail } = await signup(email, password)
      setAuth(token, { id: user_id, email: userEmail })
      navigate('/')
    } catch (err) {
      setError(err?.response?.data?.detail || 'Sign-up failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="text-5xl mb-4">⛳</div>
          <h1 className="text-3xl font-bold">Create account</h1>
          <p className="text-gray-400 mt-2">Save and revisit your swing analyses</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {[
            { label: 'Email',            type: 'email',    val: email,    set: setEmail,    ph: 'you@example.com' },
            { label: 'Password',         type: 'password', val: password, set: setPassword, ph: 'At least 8 characters' },
            { label: 'Confirm password', type: 'password', val: confirm,  set: setConfirm,  ph: '••••••••' },
          ].map(({ label, type, val, set, ph }) => (
            <div key={label}>
              <label className="block text-sm text-gray-400 mb-1">{label}</label>
              <input
                type={type}
                required
                value={val}
                onChange={(e) => set(e.target.value)}
                placeholder={ph}
                className="w-full bg-surface-800 border border-surface-600 rounded-xl px-4 py-3
                           text-white placeholder-gray-600 focus:outline-none focus:border-brand-500"
              />
            </div>
          ))}

          {error && (
            <p className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-brand-500 hover:bg-brand-600 text-black font-semibold
                       rounded-xl transition-colors disabled:opacity-50"
          >
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500">
          Already have an account?{' '}
          <Link to="/login" className="text-brand-400 hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
