import { defineConfig } from 'vite';
import ssr from "@havelaer/vite-plugin-ssr";
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), ssr({
    client: "src/entry-client.tsx",
    ssr: "src/entry-ssr.tsx",
    apis: {
      api: "src/entry-api.ts",
    },
  })],
});