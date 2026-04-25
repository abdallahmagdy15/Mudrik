#!/usr/bin/env node
/**
 * Mudrik is Windows-only. electron-builder + 7zip-bin both ship cross-platform
 * native binaries we'll never invoke (Linux + macOS), wasting ~140 MB inside
 * node_modules. This script prunes them after every `npm install`.
 *
 * Safe by construction:
 *   - Only deletes platform subdirs (linux/, mac/) — never touches win/.
 *   - Idempotent — silently skips paths that no longer exist.
 *   - Pure Node, no shell dependencies, runs cross-platform (it's a no-op
 *     for Windows users, and harmless for anyone running this from WSL).
 *
 * If you ever port Mudrik to Linux or macOS, drop the matching entries from
 * the PRUNE list below — the corresponding native binary will be required
 * to build for that target.
 */

const fs = require("fs");
const path = require("path");

const PRUNE = [
  "node_modules/app-builder-bin/linux",
  "node_modules/app-builder-bin/mac",
  "node_modules/7zip-bin/linux",
  "node_modules/7zip-bin/mac",
];

function dirSize(p) {
  let total = 0;
  try {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, e.name);
      if (e.isDirectory()) total += dirSize(f);
      else if (e.isFile()) {
        try { total += fs.statSync(f).size; } catch {}
      }
    }
  } catch {}
  return total;
}

let totalRemoved = 0;
for (const rel of PRUNE) {
  const abs = path.resolve(process.cwd(), rel);
  if (!fs.existsSync(abs)) continue;
  const size = dirSize(abs);
  try {
    fs.rmSync(abs, { recursive: true, force: true });
    totalRemoved += size;
    console.log(`  pruned ${rel}  (${(size / 1024 / 1024).toFixed(1)} MB)`);
  } catch (err) {
    console.log(`  prune failed: ${rel}  (${err.message})`);
  }
}

if (totalRemoved > 0) {
  console.log(`  total: ${(totalRemoved / 1024 / 1024).toFixed(1)} MB freed from node_modules`);
}
