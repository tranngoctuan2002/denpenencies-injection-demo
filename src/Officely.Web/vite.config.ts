import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Dev: the API runs on 5100 (dotnet run). Build: the API serves the bundle from its wwwroot.
  server: { proxy: { '/api': 'http://localhost:5100' } },
  build: { outDir: '../Officely.Api/wwwroot', emptyOutDir: true },
})
