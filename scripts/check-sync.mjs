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
 * An entry may carry a `pin`: a deliberate hold at one upstream commit rather
 * than following a branch. A pin is a stronger claim than tracking, not a
 * weaker one — it asserts the exact bytes this package was built against, is
 * verified by sha256 on every run, always reports how far behind the tracked
 * branch it sits, and carries an explicit removal condition. Staleness hides;
 * a pin announces itself. See docs/CONTRACT-PIN.md.
 *
 * Boring by design: node builtins + global fetch, one retry, no deps.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const RAW = "https://raw.githubusercontent.com/aestheticfunction/dspack";

const MANIFEST = [
  {
    local: "input/astryx.dspack.json",
    source: `${RAW}/main/examples/astryx.dspack.json`,
    note: "the Astryx transformer input — copy of the spec repo source of truth",
  },
  {
    local: "input/shadcn-ui.dspack.json",
    source: `${RAW}/805732c154f0f214721c9934a450b0edb2656c99/examples/shadcn-ui.dspack.json`,
    note: "the transformer input — copy of the spec repo source of truth",
    // A DELIBERATE PIN, not staleness. See docs/CONTRACT-PIN.md for the full
    // record; the short version: dspack main now carries the 32-component
    // production contract, but this package's profile, renderers and parity
    // invariant were all built against the 8-component v2.3.0 contract, and
    // migrating before the representation foundation lands would silently
    // convert 12 of 14 worked examples into refusals.
    pin: {
      ref: "805732c154f0f214721c9934a450b0edb2656c99",
      version: "2.3.0",
      // Teeth: a pinned ref should be immutable. If the bytes behind it ever
      // change (force-push, history rewrite, CDN mismatch), fail loudly rather
      // than quietly re-syncing to something the profile was never designed for.
      sha256: "ca19f8410a97f2004cf1d6f6dd2d7542abccfbb5430b756e0ccdc1ee954c7bb7",
      // Never let the pin masquerade as current coverage: every run reports how
      // far behind `main` it is.
      tracks: `${RAW}/main/examples/shadcn-ui.dspack.json`,
      removeWhen:
        "profile v2 + v1 desugaring + load-time validation + surface fidelity/--strict-surface + " +
        "renderer parity + functions support + the restated parity invariant are implemented and measured",
      issue: "aestheticfunction/dspack-emit#28",
    },
  },
];

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

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

/** A pinned ref must be immutable; report how far behind the tracked branch it sits. */
async function reportPin(entry, source) {
  const { pin } = entry;
  const actual = sha256(source);
  if (actual !== pin.sha256) {
    console.error(`TAMPERED ${entry.local}  the PINNED artifact itself changed`);
    console.error(`         ref      ${pin.ref}`);
    console.error(`         expected sha256 ${pin.sha256}`);
    console.error(`         actual   sha256 ${actual}`);
    console.error(`         a pinned commit must be immutable — investigate before re-syncing.`);
    return false;
  }
  // The pin is never allowed to read as current coverage.
  let ahead = "unavailable";
  try {
    const head = await fetchSource(pin.tracks);
    ahead = head.equals(source)
      ? "none — main matches the pin; the pin can be lifted"
      : `main has moved (v${JSON.parse(head.toString()).version}, ${head.length} bytes vs pinned ${source.length})`;
  } catch {
    /* offline: the pin still verifies against its own hash */
  }
  console.log(`PINNED   ${entry.local}  v${pin.version} @ ${pin.ref.slice(0, 7)} (sha256 verified)`);
  console.log(`         upstream drift: ${ahead}`);
  console.log(`         NOT current shadcn coverage — see docs/CONTRACT-PIN.md (${pin.issue})`);
  return true;
}

let drifted = 0;
for (const entry of MANIFEST) {
  const source = await fetchSource(entry.source);
  if (entry.pin && !(await reportPin(entry, source))) {
    drifted++;
    continue;
  }
  let local;
  try {
    local = readFileSync(entry.local);
  } catch {
    local = null;
  }
  if (local && source.equals(local)) {
    if (!entry.pin) console.log(`in sync  ${entry.local}`);
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
