import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// Relative base so the site works from a GitHub Pages project subpath.
export default defineConfig({
  base: './',
  plugins: [tailwindcss()],
  build: { chunkSizeWarningLimit: 1500 }, // recipes.json is a deliberate lazy chunk.
})
