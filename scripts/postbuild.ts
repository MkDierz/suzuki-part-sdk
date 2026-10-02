/**
 * Post-build: stamp the `type` field into each dist folder.
 *
 * The root package.json says `"type": "module"`, so the CJS output needs its
 * own `{"type": "commonjs"}` marker for Node to load those `.js` files as
 * CommonJS. Without this, `require()` of the package throws ERR_REQUIRE_ESM.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

const targets: Array<[dir: string, type: "module" | "commonjs"]> = [
  ["dist/esm", "module"],
  ["dist/cjs", "commonjs"],
];

for (const [dir, type] of targets) {
  await writeFile(
    join(root, dir, "package.json"),
    `${JSON.stringify({ type }, null, 2)}\n`,
    "utf8",
  );
  console.log(`postbuild: wrote ${dir}/package.json ({"type":"${type}"})`);
}
