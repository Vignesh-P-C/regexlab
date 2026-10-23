import { defineConfig } from "vitest/config";

// The app and repository tests have separate node_modules directories. Keep
// React and its renderer on one module instance so component tests obey hooks.
export default defineConfig({
  resolve: {
    dedupe: ["react", "react-dom"],
  },
});
