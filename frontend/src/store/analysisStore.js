import { create } from 'zustand'

/**
 * Global Zustand store.
 * Holds session metadata, live progress, and final analysis results.
 */
const useAnalysisStore = create((set, get) => ({
  // Upload state
  sessionId:    null,
  videoMetadata: null,
  selectedProId: 'tiger_2000',
  uploadProgress: 0,

  // Pipeline progress
  pipelineStatus:   'idle',   // idle | uploading | processing | complete | failed
  currentStage:     null,
  stageProgress:    0,
  overallProgress:  0,
  progressMessage:  '',
  pipelineError:    null,

  // Results
  analysis: null,

  // UI state
  activeTab: 'overview',

  // -----------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------

  setSelectedPro: (proId) => set({ selectedProId: proId }),

  setUploadProgress: (pct) => set({ uploadProgress: pct }),

  setUploaded: (sessionId, metadata) => set({
    sessionId,
    videoMetadata: metadata,
    pipelineStatus: 'processing',
    uploadProgress: 100,
  }),

  updateProgress: (data) => {
    const { status, progress, error } = data
    set({
      pipelineStatus:  status,
      currentStage:    progress?.stage      ?? get().currentStage,
      stageProgress:   progress?.stage_progress   ?? get().stageProgress,
      overallProgress: progress?.overall_progress ?? get().overallProgress,
      progressMessage: progress?.message    ?? get().progressMessage,
      pipelineError:   error ?? null,
    })
  },

  setAnalysis: (analysis) => set({
    analysis,
    pipelineStatus: 'complete',
  }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  reset: () => set({
    sessionId: null, videoMetadata: null, uploadProgress: 0,
    pipelineStatus: 'idle', currentStage: null, stageProgress: 0,
    overallProgress: 0, progressMessage: '', pipelineError: null,
    analysis: null, activeTab: 'overview',
  }),
}))

export default useAnalysisStore
