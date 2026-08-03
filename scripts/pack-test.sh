#!/usr/bin/env bash
# Pack-and-install boundary test (PR-2 acceptance): the package must be
# consumable exactly as published/git-dep'd — exports map only, no deep
# imports, dist + meta files present in the tarball.
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

BIN="./node_modules/.bin/dspack-emit"
"$BIN" --in "$OLDPWD/input/shadcn-ui.dspack.json" --a2ui-version 0.9.1 --out cli-out \
  --profile shadcn.profile.json >/dev/null
test -f cli-out/catalog.v0_9_1.json || { echo "bin did not emit a catalog"; exit 1; }
if "$BIN" --in "$OLDPWD/input/shadcn-ui.dspack.json" --profile /dev/null >/dev/null 2>&1; then
  echo "bin accepted an invalid profile"; exit 1
fi
echo "bin smoke: OK (installed dspack-emit emits with --profile; refuses invalid profile)"
