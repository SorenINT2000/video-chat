import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('@chakra-ui')) {
              return 'chakra';
            }
            if (id.includes('firebase')) {
              return 'firebase';
            }
            if (id.includes('react-icons')) {
              return 'icons';
            }
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) {
              return 'vendor';
            }
            return 'vendor';
          }
        }
      }
    },
    chunkSizeWarningLimit: 1000
  }
})
