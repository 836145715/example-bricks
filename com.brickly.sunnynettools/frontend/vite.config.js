import {defineConfig} from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Brickly Brick：@wailsio/runtime 全部指向本地 shim（Call.ByID -> preload invoke）
export default defineConfig({
    plugins: [vue()],
    resolve: {
        alias: {
            "@wailsio/runtime": path.resolve(here, "src/wails-shim/index.js")
        }
    },
    base: "./",
    server: {
        host: true,
        strictPort: true,
        port: Number(process.env.VITE_PORT) || 9245
    },
    build: {
        outDir: path.resolve(here, "../ui"),
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: path.resolve(here, "index.html"),
                replace: path.resolve(here, "ReplaceBody.html"),
                other: path.resolve(here, "Other.html"),
                debugTools: path.resolve(here, "debugTools.html"),
                cert: path.resolve(here, "Cert.html"),
                theme: path.resolve(here, "Theme.html")
            }
        }
    }
});
