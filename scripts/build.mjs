import { mkdir, copyFile, rm, cp } from "node:fs/promises";
import { build } from "esbuild";
await rm("dist", { recursive: true, force: true });
await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await build({ entryPoints: ["worker/index.js"], outfile: "dist/server/index.js", bundle: true, format: "esm", platform: "browser", target: "es2022", minify: false, legalComments: "eof" });
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
await cp("drizzle", "dist/.openai/drizzle", { recursive: true });
console.log("Built the BMC Weekly Dashboard Worker.");
