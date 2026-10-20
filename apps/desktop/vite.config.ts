import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      // AISDKMessageConverter 未进包 exports；委托旁路弹窗复用官方转换
      "@agentup/aisdk-message-converter": path.resolve(
        root,
        "node_modules/@assistant-ui/ai-sdk/dist/converters/convertMessage.js",
      ),
    },
  },
  plugins: [
    vue({
      template: {
        compilerOptions: {
          comments: true,
        },
      },
    }),
    tailwindcss(),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/runtime": {
        target: process.env.AGENTUP_RUNTIME_URL ?? "http://127.0.0.1:47391",
        rewrite: (path) => path.replace(/^\/runtime/, ""),
      },
    },
  },
});
