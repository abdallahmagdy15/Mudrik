#!/usr/bin/env node
/*
 * Pre-release leak guard. Exits non-zero if anything that looks like a
 * secret landed in the packed output. Intentionally narrow: OLLAMA_API_KEY
 * is the key we actually had leak in history, plus a generic 32-hex+token
 * shape that matches it, plus a block on any literal `.env` file ending
 * up under `release/` or `dist/`.
 *
 * Run from the repo root: `node scripts/check-no-env.js [path...]`
 */

"use strict";
const fs = require("fs");
const path = require("path");

const roots = (process.argv.slice(2).length ? process.argv.slice(2) : ["dist", "release"])
  .map((r) => path.resolve(process.cwd(), r))
  .filter((p) => fs.existsSync(p));

const SKIP_DIRS = new Set(["node_modules", ".git"]);
const TEXT_EXT = new Set([".js", ".ts", ".tsx", ".json", ".md", ".html", ".yml", ".yaml", ".map", ".txt", ".cjs", ".mjs"]);
// 32 hex + dot + 24 base64-ish chars. Matches the OLLAMA_API_KEY shape that
// previously leaked; kept narrow so we don't have to chase false positives.
const TOKEN_RE = /\b[0-9a-f]{32}\.[A-Za-z0-9]{24}\b/;
const FORBIDDEN_NAMES = [".env"];

let violations = 0;

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full);
      continue;
    }
    if (FORBIDDEN_NAMES.includes(e.name)) {
      console.error(`LEAK: forbidden filename '${e.name}' shipped: ${full}`);
      violations++;
      continue;
    }
    const ext = path.extname(e.name).toLowerCase();
    if (!TEXT_EXT.has(ext)) continue;
    let text;
    try { text = fs.readFileSync(full, "utf-8"); }
    catch { continue; }
    if (text.includes("OLLAMA_API_KEY=")) {
      console.error(`LEAK: OLLAMA_API_KEY assignment in ${full}`);
      violations++;
    }
    const m = text.match(TOKEN_RE);
    if (m) {
      console.error(`LEAK: token-shaped string '${m[0].slice(0, 8)}…' in ${full}`);
      violations++;
    }
  }
}

for (const r of roots) walk(r);

if (violations > 0) {
  console.error(`\nLeak guard failed (${violations} violation${violations === 1 ? "" : "s"}).`);
  process.exit(1);
}
console.log(`Leak guard OK (${roots.length} root${roots.length === 1 ? "" : "s"} scanned).`);
