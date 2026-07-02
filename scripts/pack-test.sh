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
} from "@aestheticfunction/dspack-to-a2ui";

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
