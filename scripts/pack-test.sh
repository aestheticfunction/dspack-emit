#!/usr/bin/env bash
# Pack-and-install boundary test (PR-2 acceptance): the package must be
# consumable exactly as published/git-dep'd — exports map only, no deep
# imports, dist self-contained (schemas compiled in, no runtime JSON reads).
set -euo pipefail
cd "$(dirname "$0")/.."

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

npm run build >/dev/null
TARBALL="$(npm pack --pack-destination "$WORK" 2>/dev/null | tail -1)"
echo "packed: $TARBALL"

cd "$WORK"
npm init -y >/dev/null 2>&1
npm install --no-fund --no-audit "./$TARBALL" >/dev/null

cat > smoke.mjs <<'EOF'
import { readFileSync } from "node:fs";
import {
  transform,
  emitSurface,
  validateCatalog,
  extractInstances,
  shadcnProfile,
  EmitSurfaceError,
} from "@aestheticfunction/dspack-emit";

const root = process.env.REPO_ROOT;
const doc = JSON.parse(readFileSync(`${root}/input/shadcn-ui.dspack.json`, "utf8"));
const csr = JSON.parse(readFileSync(`${root}/surface/delete-account.dsurface.json`, "utf8"));

const { messages } = emitSurface(csr, doc);
const { validation } = transform(doc, "0.9.1", { messages });
if (!validation.pass) throw new Error("gates failed from packed install");
if (extractInstances({ messages }).length === 0) throw new Error("no instances extracted");
if (typeof validateCatalog !== "function" || !shadcnProfile.catalogIdBase) throw new Error("exports missing");

let threw = false;
try {
  emitSurface({ ...csr, root: { component: "carousel" } }, doc);
} catch (e) {
  threw = e instanceof EmitSurfaceError;
}
if (!threw) throw new Error("typed error not thrown from packed install");
console.log("pack-and-install smoke: OK (A1-A3 pass; typed errors intact)");
EOF
REPO_ROOT="$OLDPWD" node smoke.mjs

# Profile-as-data from the packed install: loadProfile round-trips the shadcn
# profile as JSON, and the installed `dspack-emit` bin emits an external
# contract with --profile (exit 2 on a schema-invalid profile — fail closed).
cat > profile-smoke.mjs <<'EOF'
import { readFileSync, writeFileSync } from "node:fs";
import { loadProfile, ProfileLoadError, shadcnProfile, transformFromJson } from "@aestheticfunction/dspack-emit";

const root = process.env.REPO_ROOT;
const doc = JSON.parse(readFileSync(`${root}/input/shadcn-ui.dspack.json`, "utf8"));
const profileJson = { profileVersion: "1", ...structuredClone(shadcnProfile) };
writeFileSync("shadcn.profile.json", JSON.stringify(profileJson));
const fromJson = transformFromJson(doc, { profile: loadProfile(profileJson) });
const fromTs = transformFromJson(doc, { profile: shadcnProfile });
if (JSON.stringify(fromJson.catalog) !== JSON.stringify(fromTs.catalog)) {
  throw new Error("JSON profile is not byte-identical to the TS profile from the packed install");
}
let refused = false;
try {
  loadProfile({ profileVersion: "1" });
} catch (e) {
  refused = e instanceof ProfileLoadError && e.issues.length > 0;
}
if (!refused) throw new Error("loadProfile did not fail closed from the packed install");
console.log("profile-as-data smoke: OK (byte-identical; fail-closed)");
EOF
REPO_ROOT="$OLDPWD" node profile-smoke.mjs

# The 0.5.0 surface from the packed install: v2 language, version dispatch,
# fail-closed refusals (grammar, structural $refs, functions), the ledger,
# and the browser-safe boundary — everything a consumer can reach must
# survive publication, refusals included.
cat > v2-smoke.mjs <<'EOF'
import { readFileSync } from "node:fs";
import {
  loadProfile,
  ProfileLoadError,
  transformFromJson,
  emitSurface,
  shadcnProfile,
  profileSchemaV2,
} from "@aestheticfunction/dspack-emit";

const root = process.env.REPO_ROOT;
const doc = JSON.parse(readFileSync(`${root}/input/shadcn-ui.dspack.json`, "utf8"));

// v2 load + emit, byte-identical to v1 — the keystone, from the packed install.
const V2 = JSON.parse(readFileSync(`${root}/eval/shadcn-v2-keystone.smoke.json`, "utf8"));
const fromV2 = transformFromJson(doc, { profile: loadProfile(V2) });
const fromV1 = transformFromJson(doc, { profile: shadcnProfile });
if (JSON.stringify(fromV2.catalog) !== JSON.stringify(fromV1.catalog)) {
  throw new Error("v2 catalog is not byte-identical to v1 from the packed install");
}
if (loadProfile(V2).language !== "v2") throw new Error("v2 language stamp missing");
if (!profileSchemaV2 || profileSchemaV2["$id"] === undefined) throw new Error("v2 schema export missing");

const refuses = (mutate, name) => {
  const docJson = structuredClone(V2);
  mutate(docJson);
  try {
    loadProfile(docJson);
  } catch (e) {
    if (e instanceof ProfileLoadError && e.issues.length > 0) return;
    throw new Error(`${name}: wrong error type from packed install`);
  }
  throw new Error(`${name}: did not refuse from packed install`);
};
// unknown version
refuses((d) => { d.profileVersion = "3"; }, "unknown-version");
// malformed route selector + destination
refuses((d) => { d.components[0].surface = { routes: [{ from: ["$.magic.path"], to: "prop:x" }] }; }, "malformed-selector");
refuses((d) => { d.components[0].surface = { routes: [{ from: ["self.text"], to: "vibes:x" }] }; }, "malformed-destination");
// functions refusals: $ref in args; and an instance calling an undeclared function fails A3
refuses((d) => { d.functions = { f: { description: "d", returns: "boolean", args: { $ref: "#/$defs/Nope" } } }; }, "functions-ref");

// structural dangling $ref: a pathed gate failure, never a crash, never a pass
const broken = structuredClone(V2);
broken.components[3].structural.label.schema = { $ref: "#/$defs/DoesNotExist" };
const out = transformFromJson(doc, { profile: loadProfile(broken) });
const gate1 = out.validation.gates.find((g) => g.name === "schema-compile + no-external-ref");
if (gate1.pass !== false) throw new Error("dangling structural $ref passed gate 1 from packed install");
if (!(gate1.errors ?? []).join("").includes("#/$defs/DoesNotExist")) throw new Error("gate 1 finding lost the ref");

// the ledger rides the result
const emitted = emitSurface(
  { dspackSurface: "0.1", system: doc.name, intent: "record-collection", root: { component: "input", text: "Email" } },
  doc,
);
if (!Array.isArray(emitted.fidelity) || emitted.fidelity.length === 0) throw new Error("fidelity ledger missing");
console.log("v2 smoke: OK (keystone byte-identical; unknown-version/grammar/functions/structural-$ref all refuse; ledger present)");
EOF
node -e "
const fs=require('fs');
" >/dev/null
REPO_ROOT="$OLDPWD" node v2-smoke.mjs

# Browser-safe boundary from the packed DIST: the loader (and everything the
# composer bundles) must import with no node builtins reachable.
cat > browser-smoke.mjs <<'EOF'
import { readFileSync } from "node:fs";
const dist = new URL("./node_modules/@aestheticfunction/dspack-emit/dist/", import.meta.url);
const files = ["transform/profile-load.js", "transform/profile-schema.js", "transform/profile-schema-v2.js", "transform/parse-v2.js", "transform/desugar.js", "transform/model.js", "targets/a2ui/diagnostics.js"];
for (const f of files) {
  const src = readFileSync(new URL(f, dist), "utf8");
  if (/from "node:|require\("node:/.test(src)) throw new Error(`${f} reaches a node builtin`);
}
console.log("browser-boundary smoke: OK (loader chain has no node builtins in dist)");
EOF
node browser-smoke.mjs

BIN="./node_modules/.bin/dspack-emit"
"$BIN" --in "$OLDPWD/input/shadcn-ui.dspack.json" --a2ui-version 0.9.1 --out cli-out \
  --profile shadcn.profile.json >/dev/null
test -f cli-out/catalog.v0_9_1.json || { echo "bin did not emit a catalog"; exit 1; }
if "$BIN" --in "$OLDPWD/input/shadcn-ui.dspack.json" --profile /dev/null >/dev/null 2>&1; then
  echo "bin accepted an invalid profile"; exit 1
fi
echo "bin smoke: OK (installed dspack-emit emits with --profile; refuses invalid profile)"

# --strict-surface from the installed bin: lossy exits 5, clean passes,
# emitted bytes identical with and without the flag.
printf '%s' '{"dspackSurface":"0.1","system":"shadcn/ui","intent":"record-collection","root":{"component":"card","children":[{"component":"card-header","children":[{"component":"card-title","text":"T"}]}]}}' > lossy.dsurface.json
if "$BIN" --in "$OLDPWD/input/shadcn-ui.dspack.json" --a2ui-version 0.9.1 --out strict-out   --profile shadcn.profile.json --emit-surface lossy.dsurface.json --strict-surface >/dev/null 2>&1; then
  echo "strict-surface did not fail a lossy emission"; exit 1
fi
cp strict-out/lossy.surface.json strict-run.json
"$BIN" --in "$OLDPWD/input/shadcn-ui.dspack.json" --a2ui-version 0.9.1 --out strict-out   --profile shadcn.profile.json --emit-surface lossy.dsurface.json >/dev/null
cmp -s strict-run.json strict-out/lossy.surface.json || { echo "strict-surface altered emitted bytes"; exit 1; }
echo "strict-surface smoke: OK (exit 5 on lossy; emitted bytes identical with and without the flag)"
