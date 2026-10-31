import { defineConfig } from 'vite';
import {bookflixPWA} from './scripts/pwa-build.mjs';
export default defineConfig({base:'./',plugins:[bookflixPWA()],build:{rollupOptions:{output:{manualChunks(id){if(id.includes('/node_modules/@firebase/')||id.includes('/node_modules/firebase/')||id.includes('/node_modules/idb/'))return 'firebase-auth';}}}}});
