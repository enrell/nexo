import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/unit/setup.ts"],
    environment: "node",
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // o que dá para testar sem Electron/WebRTC. session.ts, audio.ts, rtc.ts e os componentes de
      // tela ficam por conta do teste ponta a ponta (tests/e2e.mjs), que usa instâncias reais.
      include: ["src/lib/{bytes,vault,identity,derive,events,sanitize,storage,theme,db,denoise}.ts", "src/lib/turn.ts", "public/denoise/{framer,shim,worklet}.js", "src/components/{Markdown,ErrorBoundary}.tsx", "electron/{netguard,portmap,preview,updater,updatesig}.cjs"],
      thresholds: { lines: 90, functions: 90, branches: 80, statements: 90 },
    },
  },
});
