import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  base: mode === "pages" ? "/delta-stream-application/" : "/",
  plugins: [
    {
      name: "license-notices",
      async generateBundle() {
        for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
          this.emitFile({
            type: "asset",
            fileName: name,
            source: await readFile(new URL(name, import.meta.url), "utf8"),
          });
        }
      },
    },
    {
      name: "offline-bundle",
      apply: "build",
      async writeBundle(options) {
        const directory = resolve(options.dir ?? "dist");
        const files = (await readdir(directory, { recursive: true, withFileTypes: true }))
          .filter((entry) => entry.isFile() && entry.name !== "sw.js")
          .map((entry) => relative(directory, join(entry.parentPath, entry.name)).split(sep).join("/"))
          .sort();
        const template = await readFile(new URL("src/service-worker.js", import.meta.url), "utf8");
        const hash = createHash("sha256").update(template);
        for (const file of files) hash.update(file).update(await readFile(join(directory, file)));
        await writeFile(join(directory, "sw.js"), template
          .replace("__PRECACHE__", JSON.stringify(files))
          .replace("__REVISION__", JSON.stringify(hash.digest("hex"))));
      },
    },
  ],
}));
