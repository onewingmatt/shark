// test:features — the behavioural proof for the done-gate frontend features.
//
// Runs test/runtime-verify.py, which drives a real Chromium against a real
// server. Two things this launcher exists to guarantee, both learned the hard
// way elsewhere in this fleet:
//
//   1. It OWNS both servers. The probe used to need uvicorn + vite started by
//      hand, so it only ever ran in the session that had them up, and a leftover
//      process on the port made it look flaky.
//   2. It refuses to pass on a missing dependency. If the interpreter that runs
//      the probe cannot import playwright, this exits non-zero with the install
//      line, rather than quietly becoming a tier that only passes for one person
//      on one box (a Hermes-session venv, in the case that motivated it).
//
// It prints the interpreter and its paths, so a green is attributable.
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BACKEND_PORT = 8001 // fixed: frontend/vite.config.ts proxies /api and /ws here
const FRONTEND_PORT = 5173
const BOOT_TIMEOUT_MS = 90_000
const TERM_GRACE_MS = 4_000

const log = (m) => console.log(`  [features] ${m}`)

function portFree(port) {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

async function waitFor(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (res.status < 500) return true
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`${label} never became ready at ${url} within ${timeoutMs / 1000}s`)
}

// Any interpreter that can actually import what the probe needs AND launch a
// browser. Checking the import alone is not enough: playwright can import fine
// while its browser revision is missing or unusable, and the failure then appears
// mid-probe as an unrelated-looking banner. Launch one here, where it is cheap and
// legible. First match wins; a repo-local venv is preferred so the tier does not
// depend on whatever the caller's shell happens to have activated (a session venv,
// in the case that motivated this). SHARK_PYTHON overrides.
const PREFLIGHT = [
  'import sys, playwright',
  'from playwright.sync_api import sync_playwright',
  'with sync_playwright() as p:',
  '    b = p.chromium.launch()',
  '    b.close()',
  'print(sys.executable); print(playwright.__file__)',
].join('\n')

function findPython() {
  const candidates = [
    join(ROOT, 'backend', '.venv', 'bin', 'python'),
    process.env.SHARK_PYTHON,
    'python3',
    '/usr/bin/python3',
  ].filter(Boolean)
  const rejected = []
  for (const py of candidates) {
    const r = spawnSync(py, ['-c', PREFLIGHT], { encoding: 'utf8', timeout: 60_000 })
    if (r.status === 0) {
      return { py, detail: (r.stdout || '').trim().split('\n').filter(Boolean) }
    }
    // Pull out the line that actually says what went wrong. The raw last line is
    // often playwright's banner border ("╚═══...") or an empty spawn failure, which
    // tells you nothing at 2am.
    const lines = `${r.stderr || ''}\n${r.stdout || ''}`.split('\n').filter((l) => l.trim())
    const why =
      lines.find((l) => /Executable doesn't exist/.test(l)) ??
      lines.find((l) => /^[A-Za-z_.]*(Error|Exception):/.test(l.trim())) ??
      lines.find((l) => /No module named/.test(l)) ??
      (r.error ? String(r.error.message) : undefined) ??
      lines.filter((l) => !/[╔╚║═]/.test(l)).pop() ??
      'unknown'
    rejected.push(`${py}: ${why.trim()}`)
  }
  return { rejected }
}

const python = findPython()
if (!python.py) {
  console.error(
    `\n  [features] FAILED — no interpreter can import playwright, websockets AND launch a browser.\n\n` +
      python.rejected.map((r) => `    ${r}`).join('\n') +
      `\n\n  Install them, then re-run:\n` +
      `    pip install -r backend/requirements-dev.txt\n` +
      `    python3 -m playwright install chromium\n` +
      `  Or point SHARK_PYTHON at an interpreter that already has them.\n`,
  )
  process.exit(1)
}
log(`interpreter: ${python.py} -> ${python.detail[0] ?? '?'}`)
log(`playwright:  ${python.detail[1] ?? '?'}`)

for (const [port, what] of [
  [BACKEND_PORT, 'backend (uvicorn)'],
  [FRONTEND_PORT, 'frontend (vite)'],
]) {
  if (!(await portFree(port))) {
    console.error(
      `\n  [features] FAILED — port ${port} is already in use, so ${what} cannot be started.\n` +
        `  Something else is listening there. Stop it (or note that this repo's own\n` +
        `  leftover dev server is the usual cause) and re-run.\n`,
    )
    process.exit(1)
  }
}

const procs = []
function start(cmd, args, cwd, label) {
  const child = spawn(cmd, args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', (d) => (out += d))
  child.stderr.on('data', (d) => (out += d))
  child.__out = () => out
  child.__label = label
  procs.push(child)
  return child
}

function stopAll() {
  for (const c of procs) {
    if (c.exitCode !== null) continue
    try {
      process.kill(-c.pid, 'SIGTERM')
    } catch {
      try {
        c.kill('SIGTERM')
      } catch {}
    }
  }
  return new Promise((resolve) => {
    setTimeout(() => {
      for (const c of procs) {
        if (c.exitCode === null) {
          try {
            process.kill(-c.pid, 'SIGKILL')
          } catch {
            try {
              c.kill('SIGKILL')
            } catch {}
          }
        }
      }
      resolve()
    }, TERM_GRACE_MS)
  })
}

let code = 1
try {
  log(`booting backend on :${BACKEND_PORT}`)
  start(python.py, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)], join(ROOT, 'backend'), 'backend')
  await waitFor(`http://127.0.0.1:${BACKEND_PORT}/docs`, BOOT_TIMEOUT_MS, 'backend')

  log(`booting frontend on :${FRONTEND_PORT}`)
  start('npm', ['run', 'dev', '--', '--port', String(FRONTEND_PORT), '--host', '127.0.0.1', '--strictPort'], join(ROOT, 'frontend'), 'frontend')
  await waitFor(`http://127.0.0.1:${FRONTEND_PORT}/`, BOOT_TIMEOUT_MS, 'frontend')

  log('running test/runtime-verify.py')
  const probe = spawnSync(python.py, ['test/runtime-verify.py'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      SHARK_APP_URL: `http://127.0.0.1:${FRONTEND_PORT}/`,
      SHARK_WS_URL: `ws://127.0.0.1:${BACKEND_PORT}/ws/{room}/observer`,
    },
  })
  code = probe.status ?? 1
} catch (e) {
  console.error(`\n  [features] FAILED — ${e.message}`)
  for (const c of procs) {
    const out = (c.__out?.() ?? '').trim()
    if (out) console.error(`\n  --- ${c.__label} output ---\n${out.split('\n').slice(-15).join('\n')}`)
  }
  code = 1
} finally {
  await stopAll()
}

console.log(`\n  [features] exit ${code}`)
process.exit(code)
