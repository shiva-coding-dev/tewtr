import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

const reactCompiler = babel({ presets: [reactCompilerPreset()] })

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // React Compiler via Babel can break Vite dev HMR (500 on /src/*.tsx). Keep it for production builds only.
    { ...reactCompiler, apply: 'build' },
  ],
})
