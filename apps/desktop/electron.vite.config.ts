import { readFileSync } from "node:fs";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const version = (packageJson: string): string => JSON.parse(readFileSync(new URL(packageJson, import.meta.url), "utf8")).version;

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { output: { format: "cjs", entryFileNames: "[name].js" } } },
  },
  renderer: {
    plugins: [react()],
    // Shown in Settings. Pi is bundled, so its version is fixed at build time.
    define: {
      __APP_VERSION__: JSON.stringify(version("./package.json")),
      __PI_VERSION__: JSON.stringify(version("./node_modules/@earendil-works/pi-coding-agent/package.json")),
    },
  },
});
