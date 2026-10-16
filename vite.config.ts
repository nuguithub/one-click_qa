import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import manifest from "./manifest.config";

export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest })],
  build: {
    // Extension bundles are small; keeping them readable helps when debugging
    // in chrome://extensions -> "service worker" / "Inspect views".
    target: "chrome116",
  },
});
