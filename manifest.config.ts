import { defineManifest } from "@crxjs/vite-plugin";

// `defineManifest` infers and validates the literal type for us, which means a
// typo in a file path or permission is a build error rather than a silent
// runtime failure.
export default defineManifest({
  manifest_version: 3,
  name: "One-Click QA",
  version: "0.1.0",
  description:
    "One click to scan the current page for QA issues, highlight them, and read the report in the side panel.",

  // Referenced without the `public/` prefix: Vite copies everything in
  // `public/` to the root of `dist/`, so `icon-16.png` is the one canonical
  // output path. Prefixing it with `public/` makes CRXJS emit a *second* copy
  // under `dist/public/`, and the manifest then points at that copy instead -
  // so a stale one left over in `dist/` silently wins over your artwork.
  icons: {
    "16": "icon-16.png",
    "32": "icon-32.png",
    "48": "icon-48.png",
    "128": "icon-128.png",
  },

  action: {
    default_title: "Run QA scan",
  },

  // The React side panel. `chrome.sidePanel.default_path` tells the browser which
  // page to load when `setPanelBehavior` opens it on the toolbar icon click.
  side_panel: {
    default_path: "src/sidepanel/index.html",
  },

  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },

  content_scripts: [
    {
      matches: ["http://*/*", "https://*/*"],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
      all_frames: false,
    },
  ],

  permissions: [
    "activeTab",
    "scripting",
    "sidePanel",
    "storage",
  ],

  // Needed by the background link checker: it fetches arbitrary link targets
  // to read their status codes, which is exactly what CORS would block in the
  // page. In an extension context, host permissions grant that bypass.
  host_permissions: ["<all_urls>"],
});
