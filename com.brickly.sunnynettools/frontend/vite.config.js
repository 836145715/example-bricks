import {defineConfig} from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    plugins: [vue()],
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
            cert: path.resolve(here, "Cert.html"),
                theme: path.resolve(here, "Theme.html")
            }
        }
    }
});
