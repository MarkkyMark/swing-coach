import React from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ComparisonPage        from './pages/ComparisonPage'
import OverlayComparisonPage from './pages/OverlayComparisonPage'
import FrameSelectionPage from './pages/FrameSelectionPage'
import LibraryPage       from './pages/LibraryPage'
import LoginPage         from './pages/LoginPage'
import MySwingsPage      from './pages/MySwingsPage'
import ProcessingPage    from './pages/ProcessingPage'
import ResultsPage       from './pages/ResultsPage'
import SignupPage        from './pages/SignupPage'
import UploadPage        from './pages/UploadPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ── Main flow ── */}
        <Route path="/"                              element={<UploadPage />} />
        <Route path="/frame-selection/:sessionId"   element={<FrameSelectionPage />} />
        <Route path="/comparison/:sessionId"        element={<ComparisonPage />} />
        <Route path="/overlay/:sessionId"           element={<OverlayComparisonPage />} />

        {/* ── Legacy automated pipeline (still works) ── */}
        <Route path="/processing/:sessionId"        element={<ProcessingPage />} />
        <Route path="/results/:sessionId"           element={<ResultsPage />} />

        {/* ── Auth ── */}
        <Route path="/login"                        element={<LoginPage />} />
        <Route path="/signup"                       element={<SignupPage />} />
        <Route path="/swings"                       element={<MySwingsPage />} />
        <Route path="/library"                      element={<LibraryPage />} />

        <Route path="*"                             element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
