import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// CSP só no build (o servidor de desenvolvimento do Vite usa scripts inline)
const csp: Plugin = {
  name: "nexo-csp",
  apply: "build",
  transformIndexHtml: (html) =>
    html.replace(
      "<head>",
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: data:; connect-src 'self' wss: https:; font-src 'self' data:; object-src 'none'; base-uri 'none'" />`,
    ),
};

export default defineConfig(() => ({
  base: "./",
  plugins: [react(), csp],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "chrome130",
    // ícones Phosphor trazem os 6 pesos em cada componente; app desktop carrega do disco
    chunkSizeWarningLimit: 900,
  },
}));
