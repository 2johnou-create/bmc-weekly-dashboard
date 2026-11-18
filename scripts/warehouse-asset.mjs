import { build } from "esbuild";

export async function buildWarehouseAsset() {
  const result = await build({
    entryPoints: ["worker/warehouse-scene.js"],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    legalComments: "eof",
    write: false,
  });
  return result.outputFiles[0].text;
}
