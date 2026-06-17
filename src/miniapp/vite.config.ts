import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));
const flagsDir = path.resolve(root, "node_modules/flag-icons/flags/4x3");

function flagIconsPlugin(): Plugin {
  const serve = (reqUrl: string, res: import("node:http").ServerResponse, next: () => void) => {
    const name = path.basename(reqUrl.split("?")[0] ?? "");
    if (!/^[a-z0-9-]+\.svg$/i.test(name)) return next();
    const file = path.join(flagsDir, name);
    if (!fs.existsSync(file)) return next();
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    fs.createReadStream(file).pipe(res);
  };

  return {
    name: "flag-icons-static",
    configureServer(server) {
      server.middlewares.use("/flags", (req, res, next) => serve(req.url ?? "", res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use("/flags", (req, res, next) => serve(req.url ?? "", res, next));
    },
    closeBundle() {
      const out = path.resolve(root, "dist/flags");
      if (!fs.existsSync(flagsDir)) return;
      fs.mkdirSync(out, { recursive: true });
      for (const f of fs.readdirSync(flagsDir)) {
        if (f.endsWith(".svg")) {
          fs.copyFileSync(path.join(flagsDir, f), path.join(out, f));
        }
      }
    },
  };
}

export default defineConfig({
  root,
  envDir: path.resolve(root, "../.."),
  plugins: [react(), flagIconsPlugin()],
  resolve: {
    alias: {
      "@assets": path.resolve(root, "../../assets"),
    },
  },
  server: {
    port: 5173,
    host: true,
    open: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (
              id.includes("react-dom") ||
              id.includes("react-router") ||
              id.includes("/react/")
            ) {
              return "vendor";
            }
          }
          if (id.includes("assets/plans.json") || id.includes("assets/catalog")) {
            return "catalog";
          }
        },
      },
    },
  },
});
