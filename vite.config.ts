import { defineConfig } from 'vite';
import {bookflixPWA} from './scripts/pwa-build.mjs';
export default defineConfig({base:'./',plugins:[bookflixPWA()]});
