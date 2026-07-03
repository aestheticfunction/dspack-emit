#!/usr/bin/env bash
# Framework-level gates for the json-render target:
#   J1 — generated catalog + registry compile (tsc --noEmit)
#   J2 — spec structural integrity (json-render validateSpec)
#   J3 — instance acceptance (catalog.validate with the generated Zod schemas)
# run against FRESHLY generated artifacts, with the real @json-render packages
# and zod v4 — pinned inside gates/json-render, isolated from the root tree
# (the a2ui side is pinned to zod v3 by @a2ui/web_core's peer range).
set -euo pipefail
cd "$(dirname "$0")/.."

npm ci --prefix gates/json-render

# Generate catalog.ts + registry.tsx + the delete-account spec via the CLI
# (this also exercises the CLI's offline model-vocabulary check, exit 4 on fail).
npx tsx src/cli.ts --target json-render --in input/shadcn-ui.dspack.json \
  --out gates/json-render/generated --emit-surface surface/delete-account.dsurface.json

# J1 (tsc) then J2+J3 (validate.ts) inside the pinned gate package.
npm run gate --prefix gates/json-render
