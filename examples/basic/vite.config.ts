import { defineConfig } from "vite";
import ssr from "../../src/plugin";

export default defineConfig({
  plugins: [ssr({
    client: "src/entry-client.ts",
    ssr: "src/entry-ssr.ts",
    apis: {
      api: "src/entry-api.ts",
    },
  })],
});