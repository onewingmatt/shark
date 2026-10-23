#!/usr/bin/env node
/**
 * gate — the portable half of the fleet gate: a TIERS registry, a mandatory FLOOR, and the
 * both-direction checks that make them real. No dependencies, so any repo can carry a copy.
 *
 *   node scripts/gate.mjs              run the FLOOR tiers
 *   node scripts/gate.mjs --deep       run every declared tier
 *   node scripts/gate.mjs --only=a,b   run just those (still checked against TIERS)
 *   node scripts/gate.mjs --strict     registry checks only, run nothing
 *
 * Why it exists: a game is not done until every tier in the FLOOR passes, and a game whose gate
 * cannot RUN a tier it claims has not proven anything. Both directions are checked here:
 *   - a FLOOR tier the repo does not declare  -> FAIL (the proof is missing)
 *   - a tier-shaped script not in TIERS       -> FAIL (no gate can ever run it)
 * Tune FLOOR for the repo — it is the set of proofs THIS game must ship, not every tier that exists.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));
const scripts = pkg.scripts || {};

/** Known tier names, and what each is FOR. A script matching a tier-ish name that is absent here
 *  can never run in any gate — that is the blind spot this table closes. */
const TIERS = {
  typecheck: 'it compiles, strictly',
  test: 'the rules unit-test green',
  audit: "the rulebook's own tables/worked examples replay",
  replay: 'a seeded full game reaches a DECLARED winner',
  sim: 'the engine can be simulated unattended',
  flow: 'a scripted multi-step play-through holds',
  'test:lobby': 'a human can create, seat and START in a real browser',
  'test:e2e': 'a full game over the live socket, end to end',
  'test:bot': 'a bot takes its own turn, unattended',
  'test:probe': 'headless play-through with ZERO page errors',
  'test:juice': 'the scoring moment is visible and honours reduced motion',
  'test:layout': 'the play surface fills the viewport (board band asserted)',
  'test:bots': 'the difficulty ladder is measured, not asserted',
  'test:socket': 'the wire contract holds',
  'test:reconnect': 'a seat survives a restart',
  'deploy:verify': 'the RUNNING deploy is this revision (container md5 == git HEAD)',
};

/** The proofs THIS repo must ship. Every entry must be declared in package.json scripts. */
const FLOOR = (pkg.gate && pkg.gate.floor) || ['audit', 'deploy:verify'];

/** Declared tiers that are knowingly not runnable yet, with the reason. A stale entry FAILS the
 *  gate, the same way a stale debt entry should. */
const EXEMPT = (pkg.gate && pkg.gate.exempt) || {};

/** Tiers that are known to FAIL, with the reason and why it is not being fixed now. A known-failing
 *  tier is reported loudly and does not break the gate — but the moment it PASSES, the gate fails and
 *  tells you to delete the entry. Debt that cannot rot beats a defect nobody sees; it is NOT a way to
 *  make a bar pass quietly. */
const DEBT = (pkg.gate && pkg.gate.debt) || {};
const settled = [];

/** Scripts that look like tiers but are not gated on purpose (e.g. a browser-only suite). */
const NOT_TIERS = new Set(['test:watch', 'test:ui', 'lint', 'lint:fix', 'format', 'prepare', 'build', 'dev', 'start', 'preview', 'postinstall']);

/** A watcher / coverage / verbose run of a tier is not itself a tier. Three repos in this fleet
 *  declare test:unit:watch and friends, and flagging those as "unrunnable tiers" is a false alarm
 *  that buries the real ones. */
const VARIANT = /:(watch|ui|coverage|cov|verbose|debug|update|only|ci|fast)$/;

/** Names this repo declares KNOWINGLY not as tiers — aliases and duplicates of a real tier, where
 *  the real tier is in the FLOOR and the gate does run it. Like every other ledger here, a stale
 *  entry FAILS: if the script disappears, the entry must go too. */
const VARIANTS = (pkg.gate && pkg.gate.variants) || [];

const argv = process.argv.slice(2);
const only = (argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];
const deep = argv.includes('--deep');
const strict = argv.includes('--strict');

const fails = [];
const isTier = (s) => TIERS[s] || (!NOT_TIERS.has(s) && !VARIANT.test(s) && !VARIANTS.includes(s) && /^(test|deploy)[:\-]/.test(s));
const declaredTiers = Object.keys(scripts).filter(isTier);

console.log(`◈ gate — ${pkg.name || 'this repo'}`);

// ---- the registry checks, both directions ------------------------------------------------------
for (const tier of FLOOR) {
  if (!scripts[tier]) fails.push(`FLOOR tier "${tier}" is not declared in package.json scripts — the proof is missing`);
}
for (const s of Object.keys(scripts)) {
  if (isTier(s) && !TIERS[s]) fails.push(`package.json declares "${s}", which is not in TIERS — no gate can ever run it`);
}
for (const v of VARIANTS) {
  if (!scripts[v]) fails.push(`variants entry "${v}" no longer applies (the script is gone) — remove it`);
}
for (const [tier, why] of Object.entries(EXEMPT)) {
  if (!scripts[tier]) fails.push(`EXEMPT entry "${tier}" no longer applies (the script is gone) — remove it`);
  if (!why) fails.push(`EXEMPT entry "${tier}" carries no reason`);
}

if (straightUp(fails)) {
  console.error(`\n  GATE STRICT FAILED — ${fails.length} registry problem(s):`);
  for (const f of fails) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`  registry: FLOOR [${FLOOR.join(', ')}] all declared; no unrunnable tier names`);

if (strict) {
  console.log('  GATE STRICT PASSED (registry only)');
  process.exit(0);
}

// ---- run the tiers -----------------------------------------------------------------------------
const toRun = only
  ? only.split(',').map((s) => s.trim())
  : deep
    ? declaredTiers
    : FLOOR;

for (const tier of toRun) {
  if (!TIERS[tier]) {
    fails.push(`asked to run "${tier}", which is not a known tier`);
    continue;
  }
  if (!scripts[tier]) {
    fails.push(`tier "${tier}" is not declared in package.json`);
    continue;
  }
  process.stdout.write(`  ${tier.padEnd(14)} `);
  const t0 = Date.now();
  try {
    execSync(`npm run ${tier}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(`✔  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    if (DEBT[tier]) fails.push(`debt entry "${tier}" is STALE — it passes now, so delete the entry`);
  } catch (e) {
    const tail = `${e.stdout || ''}${e.stderr || ''}`.trim().split('\n').slice(-8).join('\n');
    if (DEBT[tier]) {
      settled.push(tier);
      console.log(`✖  KNOWN DEBT (${((Date.now() - t0) / 1000).toFixed(1)}s) — ${DEBT[tier]}`);
    } else {
      console.log('✖');
      fails.push(`tier "${tier}" FAILED`);
      if (tail) console.error(tail.split('\n').map((l) => `      ${l}`).join('\n'));
    }
  }
}

if (fails.length) {
  console.error(`\n  GATE FAILED — ${fails.length} problem(s):`);
  for (const f of fails) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`\n  GATE PASSED — every tier run, 0 problems${settled.length ? `, ${settled.length} known debt (${settled.join(', ')})` : ''}`);
process.exit(0);

function straightUp(f) {
  return f.length > 0;
}
