import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const API_BASE_URL = env.VITE_API_BASE_URL || 'http://localhost:8080'
  const WS_BASE_URL = env.VITE_WS_BASE_URL || 'ws://localhost:8080'
  
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': API_BASE_URL,
        '/webhook': API_BASE_URL,
        '/cubbit-proxy': API_BASE_URL,
        '/ws': { target: WS_BASE_URL, ws: true },
      }
    },
    build: {
      outDir: 'dist',
    }
  }
})
