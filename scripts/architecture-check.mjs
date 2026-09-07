#!/usr/bin/env node
/**
 * Static architecture gate for Hotel+ consolidation.
 * Fails when production src/ reintroduces:
 * - direct localStorage access outside safe-storage.js
 * - alternate program proof-key constructors
 * - alternate week:workout completion-key construction
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const srcRoot = path.join(root, 'src');

const IDENTITY_OWNER = 'workout-completion-identity.js';
const STORAGE_OWNER = 'safe-storage.js';

const ALLOWED_LOCAL_STORAGE = new Set([STORAGE_OWNER]);
const ALLOWED_PROGRAM_PROOF = new Set([IDENTITY_OWNER]);
const ALLOWED_COMPLETION_KEY = new Set([IDENTITY_OWNER]);

/** Match `${week}:${workout}` style entity keys (not mm:ss time displays). */
const COMPLETION_KEY_TEMPLATE = /\$\{[^}\n]*(?:week|Week)[^}\n]*\}:\$\{[^}\n]*(?:workout|Workout)[^}\n]*\}/;
const PROGRAM_PROOF_TEMPLATE = /`program:\$\{/;
const PROGRAM_PROOF_FUNCTION = /function\s+buildProgramProofKey\s*\(/;
const LOCAL_STORAGE_ACCESS = /\blocalStorage\s*[.[]/;

function listJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listJsFiles(full));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function checkFile(filePath) {
  const rel = path.relative(srcRoot, filePath);
  const base = path.basename(filePath);
  const raw = fs.readFileSync(filePath, 'utf8');
  const source = stripComments(raw);
  const violations = [];

  if (!ALLOWED_LOCAL_STORAGE.has(base) && LOCAL_STORAGE_ACCESS.test(source)) {
    violations.push({
      rule: 'no-direct-localStorage',
      message: `direct localStorage access is forbidden outside ${STORAGE_OWNER}`,
    });
  }

  if (!ALLOWED_PROGRAM_PROOF.has(base)) {
    if (PROGRAM_PROOF_TEMPLATE.test(source) || PROGRAM_PROOF_FUNCTION.test(source)) {
      violations.push({
        rule: 'no-alternate-program-proof-key',
        message: `program proof keys must be built only in ${IDENTITY_OWNER}`,
      });
    }
  }

  if (!ALLOWED_COMPLETION_KEY.has(base) && COMPLETION_KEY_TEMPLATE.test(source)) {
    violations.push({
      rule: 'no-alternate-completion-key',
      message: `week:workout completion keys must use buildWorkoutCompletionKey from ${IDENTITY_OWNER}`,
    });
  }

  return violations.map((v) => ({ file: rel, ...v }));
}

function main() {
  if (!fs.existsSync(srcRoot)) {
    console.error(`architecture-check: missing ${srcRoot}`);
    process.exit(1);
  }

  const files = listJsFiles(srcRoot);
  const violations = files.flatMap(checkFile);

  if (violations.length) {
    console.error('architecture-check FAILED:\n');
    for (const v of violations) {
      console.error(`  ${v.file}: [${v.rule}] ${v.message}`);
    }
    console.error(`\n${violations.length} violation(s).`);
    process.exit(1);
  }

  console.log(`architecture-check OK (${files.length} src files scanned).`);
}

main();
