#!/usr/bin/env node
/**
 * Contract-copy drift check (dspack-gen#7, ecosystem-wide).
 *
 * The ecosystem deliberately carries copies of shared artifacts (the shadcn
 * v0.3 contract; see the manifest below) instead of a shared package — repo
 * rule: no shared types/utils package. The price of copies is silent drift;
 * this script makes drift loud: every entry must match its source of truth
 * BYTE-FOR-BYTE. CI runs it on every push/PR; a red check means the source
 * moved (or the copy was edited locally) — run with --write to re-sync,
 * then regenerate anything derived (catalogs, json-render goldens) and commit both together.
 *
 * Boring by design: node builtins + global fetch, one retry, no deps.
 */
import { readFileSync, writeFileSync } from "node:fs";

const MANIFEST = [
  {
    local: "input/shadcn-ui.dspack.json",
    source:
      "https://raw.githubusercontent.com/aestheticfunction/dspack/main/examples/shadcn-ui.dspack.json",
    note: "the transformer input — copy of the spec repo source of truth",
  },
];

const write = process.argv.includes("--write");

async function fetchSource(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= 2) throw new Error(`fetching ${url}: ${error.message ?? error}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

let drifted = 0;
for (const entry of MANIFEST) {
  const source = await fetchSource(entry.source);
  let local;
  try {
    local = readFileSync(entry.local);
  } catch {
    local = null;
  }
  if (local && source.equals(local)) {
    console.log(`in sync  ${entry.local}`);
    continue;
  }
  if (write) {
    writeFileSync(entry.local, source);
    console.log(`SYNCED   ${entry.local}  <-  ${entry.source}`);
    console.log(`         regenerate derived goldens before committing (see README).`);
  } else {
    drifted++;
    console.error(`DRIFT    ${entry.local}  (${entry.note})`);
    console.error(`         differs from ${entry.source}`);
    console.error(`         fix: node scripts/check-sync.mjs --write, regenerate derived goldens, commit together.`);
  }
}
if (drifted > 0) process.exit(1);
