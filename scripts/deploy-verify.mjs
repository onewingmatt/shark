#!/usr/bin/env node
/**
 * deploy-verify — prove the RUNNING deploy came from THIS revision.
 *
 * Portable: node stdlib + ssh + `docker exec`. No dependencies, no monorepo imports, so any
 * standalone repo can carry a copy.
 *
 * This encodes the drill that caught every drift in the 2026-10-23 fleet pass:
 *   docker exec <container> md5sum <file>   vs   git show HEAD:<file>
 * Two rules learned the hard way are built in:
 *   1. compare against `git show HEAD:<file>`, NEVER the working tree (uncommitted work reads as drift);
 *   2. use files that are copied VERBATIM into the image (package.json, package-lock.json, a plain
 *      server file). Compiled bundles are not comparable across build environments.
 *
 * Config: deploy.json beside this script:
 *   {
 *     "host": "onewing@10.0.0.145",
 *     "container": "stuck",
 *     "files": ["package.json", { "repo": "frontend/package.json", "container": "/app/package.json" }],
 *     "url": "https://stuck.onewing.top/",          // optional
 *     "expectStatus": 200                            // optional, default 200
 *   }
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const cfgPath = process.argv[2] || join(HERE, '..', 'deploy.json');

if (!existsSync(cfgPath)) {
  console.error(`deploy-verify: no ${cfgPath} — this repo declares no deploy to verify`);
  process.exit(2);
}

const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const md5 = (b) => createHash('md5').update(b).digest('hex').slice(0, 8);
const fails = [];
const log = (...a) => console.log('  [deploy]', ...a);

const sh = (cmd) => {
  try {
    return { out: execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), code: 0 };
  } catch (e) {
    return { out: `${e.stdout || ''}${e.stderr || ''}`, code: e.status ?? 1 };
  }
};

const files = (cfg.files || []).map((f) => (typeof f === 'string' ? { repo: f, container: f } : f));
if (!files.length) {
  console.error('deploy-verify: deploy.json lists no files — nothing comparable');
  process.exit(2);
}

console.log(`◈ deploy-verify — ${cfg.host}:${cfg.container} vs git HEAD`);

for (const { repo: repoPath, container: containerPath } of files) {
  const head = sh(`git show HEAD:${repoPath} | md5sum`);
  if (head.code !== 0) {
    fails.push(`${repoPath}: not in git HEAD (untracked or wrong path) — cannot verify provenance`);
    log(`FAIL ${repoPath}: not at HEAD`);
    continue;
  }
  const want = head.out.slice(0, 8);

  const got = sh(
    `ssh -o ConnectTimeout=20 -o BatchMode=yes ${cfg.host} ${JSON.stringify(`docker exec ${cfg.container} md5sum ${containerPath}`)}`,
  );
  const have = (got.out.match(/[0-9a-f]{32}/) || [])[0]?.slice(0, 8);

  if (!have) {
    fails.push(`${containerPath}: could not hash inside the container (is ${cfg.container} running on ${cfg.host}?)`);
    log(`FAIL ${containerPath}: unreachable`);
    continue;
  }
  if (have !== want) {
    fails.push(`${containerPath}: running ${have} != HEAD ${want} — the deploy is NOT this revision`);
    log(`FAIL ${containerPath}: running=${have} HEAD=${want}`);
    continue;
  }
  log(`ok   ${containerPath} == HEAD (${want})`);
}

if (cfg.url) {
  const status = sh(`curl -s -o /dev/null -w '%{http_code}' ${cfg.url}`).out.trim();
  const want = String(cfg.expectStatus ?? 200);
  if (status !== want) {
    fails.push(`${cfg.url}: answered ${status}, expected ${want}`);
    log(`FAIL ${cfg.url} -> ${status}`);
  } else {
    log(`ok   ${cfg.url} -> ${status}`);
  }
}

if (fails.length) {
  console.error(`\n  DEPLOY VERIFY FAILED — ${fails.length} problem(s):`);
  for (const f of fails) console.error(`   - ${f}`);
  process.exit(1);
}
console.log('  deploy verify PASSED — the running deploy is this revision');
