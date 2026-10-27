import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'root-redirect',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/' || req.url === '') {
            res.writeHead(302, { Location: '/static/' });
            res.end();
            return;
          }
          next();
        });
      },
    },
  ],
  // Prefix all asset imports with /static/ to match FastAPI and CloudFront routing
  base: '/static/',
  // Disable Vite's static public folder copying because ./public is our build output destination
  publicDir: false,
  build: {
    // Output production bundle directly to frontend/public for packaging and serving
    outDir: fileURLToPath(new URL('./public', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    // Forward API and docs requests to local FastAPI backend during npm run dev
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/docs': 'http://127.0.0.1:8000',
      '/openapi.json': 'http://127.0.0.1:8000',
    },
  },
});
