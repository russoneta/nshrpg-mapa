import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// rutas relativas asi anda en github pages sin importar el nombre del repo
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1200 },
});
