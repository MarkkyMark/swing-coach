import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // All backend-served paths forwarded to FastAPI
      '/api':      { target: 'http://localhost:8000', changeOrigin: true },
      '/sessions': { target: 'http://localhost:8000', changeOrigin: true },
      '/library':  { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
})
