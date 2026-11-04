import { defineConfig } from 'vite';

// Relative base so the build works at https://<user>.github.io/<repo>/ without changes.
export default defineConfig({
  base: './',
});
