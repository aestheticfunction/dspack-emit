/**
 * Browser-safety boundary gate (mirrors dspack-gen's core-boundary test):
 * the library surface — src/transform, src/validate, src/targets — must be
 * bundleable for the browser, because the dspack-studio composer runs
 * `transformFromJson`, `validateCatalog`, and `loadProfile` in-page for live
 * fidelity feedback. No module in these directories may import a Node
 * built-in (`node:*` or bare-specifier form); schema documents reach the
 * runtime through committed TS mirrors, not readFileSync.
 *
 * src/cli.ts is deliberately out of scope: it is the Node CLI and owns all
 * filesystem I/O. Tests may use node:fs freely (they run under vitest).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BOUNDARY_DIRS = ["src/transform", "src/validate", "src/targets"];

// Bare-specifier built-ins that would slip past a `node:` prefix check.
const BARE_BUILTINS = new Set([
  "fs", "path", "url", "os", "crypto", "util", "stream", "buffer",
  "http", "https", "net", "tls", "child_process", "worker_threads",
]);

const files = BOUNDARY_DIRS.flatMap((dir) =>
  readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => join(dir, f)),
);

describe("browser boundary", () => {
  it("covers the library modules", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it.each(files)("%s imports no Node built-ins", (file) => {
    const source = readFileSync(file, "utf8");
    const imports = [...source.matchAll(/from\s+"([^"]+)"|import\s*\(\s*"([^"]+)"\s*\)|require\s*\(\s*"([^"]+)"\s*\)/g)].map(
      (m) => m[1] ?? m[2] ?? m[3],
    );
    for (const specifier of imports) {
      expect(specifier.startsWith("node:"), `${file} imports ${specifier}`).toBe(false);
      expect(BARE_BUILTINS.has(specifier), `${file} imports Node built-in ${specifier}`).toBe(false);
    }
  });
});
