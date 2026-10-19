import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { test } from 'node:test'
import { rejectGeneratedTypes } from '../../scripts/db-types.mjs'

const script = resolve('scripts/task-pipeline.mjs')
// What the pipeline may print about a lease: pid, createdAt and a short token hash only.
const leaseText = ({ pid, token, createdAt }) =>
  `pid=${pid} token=${createHash('sha256').update(token).digest('hex').slice(0, 8)} at ${createdAt}`
const waitFor = async (path, ms = 10_000) => {
  const until = Date.now() + ms
  while (!existsSync(path) && Date.now() < until)
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  assert.ok(existsSync(path), `${path} did not appear`)
}
function fixture(t, failReset = false, blocker = '') {
  const cwd = mkdtempSync(resolve(tmpdir(), 'chb-pipeline-'))
  // Only this newly-created test directory is deleted; never the project checkout.
  t.after(() => {
    assert.ok(resolve(cwd).startsWith(`${resolve(tmpdir())}${sep}chb-pipeline-`))
    rmSync(cwd, { recursive: true, force: true })
  })
  mkdirSync(resolve(cwd, 'docs/delivery'), { recursive: true })
  mkdirSync(resolve(cwd, 'src'))
  writeFileSync(
    resolve(cwd, 'docs/delivery/IMPLEMENTATION_INFRA_PLAN_v1.0.md'),
    '## TRF-001 — Request\n',
  )
  writeFileSync(resolve(cwd, 'src/app.ts'), 'export const version = 1\n')
  writeFileSync(resolve(cwd, '.gitignore'), 'tmp/\nfake-npm.cjs\nsummary.json\n')
  const cli = resolve(cwd, 'fake-npm.cjs')
  writeFileSync(
    cli,
    `console.log('authorization=fixture-value'); process.exit(${failReset} && process.argv.includes('reset') ? 1 : 0)`,
  )
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  git('init', '-q')
  git('add', '.')
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-qm',
    'baseline',
  )
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        npm_execpath: cli,
        // Fixture validation never acquires the real DB lease inherited from a worker.
        CHB_DB_LOCK_PATH: '',
        CHB_DB_LOCK_OWNER_TOKEN: '',
        CHB_DB_VALIDATION_BLOCKER: blocker,
      },
    })
  const summary = {
    implemented: ['Fixture implementation'],
    database: ['none'],
    tests: ['Fixture CLI checks only; not real project validation'],
    acceptance: [
      { description: 'Fixture criterion', status: 'met', evidence: 'Fixture assertions' },
    ],
    notes: [],
    nextTasks: [],
    mobile: 'not verified: fixture',
    staging: 'not verified: fixture',
    review: 'not verified: fixture',
  }
  writeFileSync(resolve(cwd, 'summary.json'), JSON.stringify(summary))
  const read = (path) => JSON.parse(readFileSync(resolve(cwd, path), 'utf8'))
  const start = () => run('start', 'TRF-001', '--agent', 'claude', '--title', 'fixture')
  const finish = () => run('finish', 'TRF-001', '--summary-file', 'summary.json')
  const report = () =>
    read(read('docs/handoff/tasks.json').tasks['TRF-001'].latestReport.replace(/\.md$/, '.json'))
  return { cwd, git, run, read, start, finish, report }
}

test('invalid IDs and concurrent starts are rejected', (t) => {
  const f = fixture(t)
  assert.equal(f.run('start', '../../other', '--agent', 'claude', '--title', 'fixture').status, 1)
  assert.equal(f.start().status, 0)
  assert.equal(f.start().status, 1)
})

test('failed DB reset produces a durable honest report and skips dependent DB tests', (t) => {
  const f = fixture(t, true)
  assert.equal(f.start().status, 0)
  assert.equal(f.finish().status, 1)
  const r = f.report()
  assert.equal(r.status, 'needs_validation')
  assert.equal(r.checks.find((c) => c.name === 'db reset').status, 'fail')
  assert.equal(r.checks.find((c) => c.name === 'integration').status, 'not_run')
  assert.equal(f.run('verify').status, 0)
  assert.equal(
    readFileSync(resolve(f.cwd, r.checks[0].log), 'utf8').includes('fixture-value'),
    false,
  )
})

test('occupied shared DB slot produces a durable report without resetting another lane', (t) => {
  const f = fixture(t)
  assert.equal(f.start().status, 0)
  const lock = resolve(f.cwd, 'tmp/db-validation.lock')
  mkdirSync(resolve(f.cwd, 'tmp'), { recursive: true })
  const owner = JSON.stringify({ pid: process.pid, token: 'other-lane' })
  writeFileSync(lock, owner)
  const result = spawnSync(process.execPath, [script, 'finish', 'TRF-001', 'summary.json'], {
    cwd: f.cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_execpath: resolve(f.cwd, 'fake-npm.cjs'),
      CHB_DB_LOCK_PATH: lock,
      CHB_DB_LOCK_TIMEOUT_MS: '0',
      CHB_DB_VALIDATION_BLOCKER: '',
      CHB_DB_LOCK_OWNER_TOKEN: '',
    },
  })
  assert.equal(result.status, 1)
  const report = f.report()
  assert.equal(report.status, 'needs_validation')
  assert.equal(report.checks.find((c) => c.name === 'db validation slot').status, 'fail')
  assert.equal(report.checks.find((c) => c.name === 'db reset').status, 'not_run')
  assert.equal(report.checks.find((c) => c.name === 'integration').status, 'not_run')
  assert.equal(readFileSync(lock, 'utf8'), owner)
})

test('PR gate rejects missing/stale evidence and accepts exact fresh validated source', (t) => {
  const f = fixture(t)
  assert.equal(f.start().status, 0)
  writeFileSync(resolve(f.cwd, 'src/app.ts'), 'export const version = 2\n')
  f.git('add', '.')
  f.git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-qm',
    'source',
  )
  const base = spawnSync('git', ['rev-parse', 'HEAD~1'], {
    cwd: f.cwd,
    encoding: 'utf8',
  }).stdout.trim()
  assert.equal(f.run('verify', '--base', base).status, 1)
  assert.equal(f.finish().status, 0)
  f.git('add', '.')
  f.git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-qm',
    'report',
  )
  assert.equal(f.run('verify', '--base', base).status, 0)
  writeFileSync(resolve(f.cwd, 'src/app.ts'), 'export const version = 3\n')
  assert.equal(f.run('verify', '--base', base).status, 1)
})

test('deleted source and CRLF checkouts retain a matching PR fingerprint', (t) => {
  const f = fixture(t)
  assert.equal(f.start().status, 0)
  f.git('rm', 'src/app.ts')
  mkdirSync(resolve(f.cwd, 'src'), { recursive: true })
  writeFileSync(resolve(f.cwd, 'src/replacement.ts'), 'export const version = 2\n')
  assert.equal(f.finish().status, 0)
  f.git('add', '.')
  f.git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-qm',
    'replacement plus report',
  )
  const base = spawnSync('git', ['rev-parse', 'HEAD~1'], {
    cwd: f.cwd,
    encoding: 'utf8',
  }).stdout.trim()
  writeFileSync(resolve(f.cwd, 'src/replacement.ts'), 'export const version = 2\r\n')
  assert.equal(f.run('verify', base).status, 0)
})

test('known external DB blocker writes not_run without attempting reset', (t) => {
  const f = fixture(t, false, 'Docker unavailable; intentional skip')
  assert.equal(f.start().status, 0)
  assert.equal(f.finish().status, 1)
  const r = f.report()
  assert.equal(r.status, 'needs_validation')
  assert.equal(r.checks.find((c) => c.name === 'db reset').status, 'not_run')
  assert.match(r.checks.find((c) => c.name === 'db reset').reason, /Docker/)
  assert.equal(f.run('verify').status, 0)
})

test('lease ownership loss still leaves a durable failed report', (t) => {
  const f = fixture(t)
  assert.equal(f.start().status, 0)
  const lock = resolve(f.cwd, 'tmp/db.lock')
  writeFileSync(
    resolve(f.cwd, 'fake-npm.cjs'),
    'if(process.argv.includes("reset")) require("node:fs").writeFileSync(process.env.CHB_DB_LOCK_PATH,JSON.stringify({pid:process.pid,token:"foreign"}));',
  )
  const run = spawnSync(process.execPath, [script, 'finish', 'TRF-001', 'summary.json'], {
    cwd: f.cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_execpath: resolve(f.cwd, 'fake-npm.cjs'),
      CHB_DB_LOCK_PATH: lock,
      CHB_DB_VALIDATION_BLOCKER: '',
      CHB_DB_LOCK_OWNER_TOKEN: '',
    },
  })
  assert.equal(run.status, 1)
  const r = f.report()
  assert.equal(r.status, 'needs_validation')
  assert.equal(r.checks.find((c) => c.name === 'db lease release').status, 'fail')
  assert.equal(JSON.parse(readFileSync(lock, 'utf8')).token, 'foreign')
})

test('timeout with a detached validation child retains the lease and publishes failure', async (t) => {
  const f = fixture(t)
  assert.equal(f.start().status, 0)
  const lock = resolve(f.cwd, 'tmp/db.lock'),
    marker = resolve(f.cwd, 'tmp/child-ended')
  writeFileSync(
    resolve(f.cwd, 'fake-npm.cjs'),
    'if(process.argv.includes("reset")){require("node:child_process").spawn(process.execPath,["-e",' +
      JSON.stringify(
        'setTimeout(()=>{require("node:fs").writeFileSync(' +
          JSON.stringify(marker) +
          ',"ended")},1800)',
      ) +
      '],{detached:true,stdio:"ignore"}).unref();setTimeout(()=>{},5000)}',
  )
  const result = spawnSync(process.execPath, [script, 'finish', 'TRF-001', 'summary.json'], {
    cwd: f.cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_execpath: resolve(f.cwd, 'fake-npm.cjs'),
      CHB_DB_LOCK_PATH: lock,
      CHB_DB_VALIDATION_BLOCKER: '',
      CHB_DB_LOCK_OWNER_TOKEN: '',
      CHB_VALIDATION_TIMEOUT_MS: '400',
    },
  })
  assert.equal(result.status, 1)
  const r = f.report()
  assert.equal(r.checks.find((c) => c.name === 'db reset').status, 'fail')
  assert.equal(r.checks.find((c) => c.name === 'db lease retained').status, 'fail')
  assert.equal(r.checks.find((c) => c.name === 'integration').status, 'not_run')
  const owner = JSON.parse(readFileSync(lock, 'utf8'))
  assert.ok(owner.token)
  // Machine-checkable ownership evidence: pid + createdAt + token hash prefix, never the token.
  const lease = r.checks.find((c) => c.name === 'db lease')
  assert.equal(lease.status, 'pass')
  assert.equal(lease.reason, `owned ${leaseText(owner)}`)
  assert.equal(
    r.checks.find((c) => c.name === 'db lease release'),
    undefined,
  )
  assert.match(r.checks.find((c) => c.name === 'db lease retained').reason, /token=[0-9a-f]{8} /)
  assert.equal(JSON.stringify(r).includes(owner.token), false)
  assert.equal(
    readFileSync(resolve(f.cwd, 'docs/handoff/reports', `${r.runId}.md`), 'utf8').includes(
      owner.token,
    ),
    false,
  )
  const module = new URL('../../scripts/db-validation-lock.mjs', import.meta.url).href
  const contender = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      'import {acquireDbValidationLock} from ' +
        JSON.stringify(module) +
        ';acquireDbValidationLock(' +
        JSON.stringify(lock) +
        ',{timeoutMs:0});',
    ],
    { encoding: 'utf8' },
  )
  assert.notEqual(contender.status, 0)
  assert.match(contender.stderr, /occupied/)
  await new Promise((resolveWait) => setTimeout(resolveWait, 2000))
  assert.equal(readFileSync(marker, 'utf8'), 'ended')
  assert.equal(JSON.parse(readFileSync(lock, 'utf8')).token, owner.token)
  assert.equal(f.run('verify').status, 0)
})

// --- INF-008: opt-in `--generate-types` (mock npm/supabase CLI; no real DB or generation) ---
const typesFile = 'src/types/database.generated.ts'
const oldTypes = 'export type Database = { old: true }\n'
const newTypes = 'export type Database = { public: { Tables: { demo: never } } }\n'

// Mock `supabase gen types` helpers. Both processes are detached, bounded and self-terminating:
// the test waits for their marker file before the fixture directory is removed.
const hangChild =
  "setTimeout(()=>{require('node:fs').writeFileSync('tmp/gen-child-ended','ended')},2500)"
// Observe the directory rename instead of repeatedly opening the target: polling it can deny
// Windows' atomic rename with EPERM, preventing the successful install this regression needs.
// The mock generator waits for watcher readiness before it emits the replacement types.
const hijackChild = `
const fs = require('node:fs');
const target = 'src/types/database.generated.ts';
const finish = (result) => {
  clearTimeout(deadline);
  watcher.close();
  fs.writeFileSync('tmp/hijack-done', result);
};
const watcher = fs.watch('src/types', (event, filename) => {
  if (filename !== 'database.generated.ts') return;
  try {
    if (fs.readFileSync(target, 'utf8') !== ${JSON.stringify(newTypes)}) return;
  } catch { return; }
  watcher.close();
  fs.writeFileSync(target, 'export type Database = { hijacked: true }\\n');
  finish('hijacked');
});
const deadline = setTimeout(() => finish('timed_out'), 8000);
fs.writeFileSync('tmp/hijack-ready', 'ready');
`

function typesFixture(t, { gen = 'ok', failReset = false } = {}) {
  const f = fixture(t)
  mkdirSync(resolve(f.cwd, 'src/types'), { recursive: true })
  writeFileSync(resolve(f.cwd, typesFile), oldTypes)
  f.git('add', '.')
  f.git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-qm',
    'types',
  )
  // Mock CLI: records every invocation; `gen` prints types on stdout according to CHB_FAKE_GEN.
  writeFileSync(
    resolve(f.cwd, 'fake-npm.cjs'),
    `const fs=require('node:fs'),a=process.argv.slice(2);fs.mkdirSync('tmp',{recursive:true});
fs.appendFileSync('tmp/calls.log',a.join(' ')+'\\n');
if(a.includes('reset')&&process.env.CHB_DB_LOCK_PATH)fs.copyFileSync(process.env.CHB_DB_LOCK_PATH,'tmp/lease-seen.json');
if(a.includes('reset')&&process.env.CHB_FAKE_FAIL_RESET)process.exit(1);
if(a.includes('gen')){const m=process.env.CHB_FAKE_GEN;
if(m==='fail'){console.error('boom authorization=secret-token');process.exit(1)}
if(m==='empty')process.exit(0);
if(m==='invalid'){console.log('not typescript');process.exit(0)}
if(m==='malformed'){console.log('export type Database = { public: {');process.exit(0)}
if(m==='exec'){process.stdout.write(${JSON.stringify(newTypes)}+"console.log('side effect')\\n");process.exit(0)}
if(m==='hang'){require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(hangChild)}],{detached:true,stdio:'ignore'}).unref();setTimeout(()=>{},10000)}
else{
if(m==='hijack'){
require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(hijackChild)}],{detached:true,stdio:'ignore'}).unref();
const deadline=Date.now()+8000;
while(!fs.existsSync('tmp/hijack-ready')){
if(Date.now()>=deadline)throw new Error('hijack watcher did not become ready');
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
}}
if(m==='mutate')fs.writeFileSync('src/app.ts','export const version = 99\\n');
process.stdout.write(${JSON.stringify(newTypes)})}}`,
  )
  const lock = resolve(f.cwd, 'tmp/db.lock')
  const finish = (extra = [], env = {}) =>
    spawnSync(process.execPath, [script, 'finish', 'TRF-001', 'summary.json', ...extra], {
      cwd: f.cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        npm_execpath: resolve(f.cwd, 'fake-npm.cjs'),
        CHB_DB_LOCK_PATH: lock,
        CHB_DB_LOCK_OWNER_TOKEN: '',
        CHB_DB_VALIDATION_BLOCKER: '',
        CHB_FAKE_GEN: gen,
        CHB_FAKE_FAIL_RESET: failReset ? '1' : '',
        ...env,
      },
    })
  const calls = () => readFileSync(resolve(f.cwd, 'tmp/calls.log'), 'utf8').trim().split('\n')
  const types = () => readFileSync(resolve(f.cwd, typesFile), 'utf8')
  const typesBytes = () => readFileSync(resolve(f.cwd, typesFile))
  const check = (name) => f.report().checks.find((c) => c.name === name)
  return { ...f, lock, finish, calls, types, typesBytes, check }
}

test('default finish never generates types', (t) => {
  const f = typesFixture(t)
  assert.equal(f.start().status, 0)
  assert.equal(f.finish().status, 0)
  assert.equal(
    f.calls().some((c) => c.includes('gen')),
    false,
  )
  assert.equal(f.check('generate types'), undefined)
  assert.equal(f.types(), oldTypes)
})

test('generation after a passing reset replaces types and reruns app checks on the new source', (t) => {
  const f = typesFixture(t)
  assert.equal(f.start().status, 0)
  const result = f.finish(['--generate-types'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(f.types(), newTypes)
  const calls = f.calls()
  const reset = calls.findIndex((c) => c.includes('reset'))
  const gen = calls.findIndex((c) => c.includes('gen'))
  assert.ok(reset >= 0 && gen > reset, 'gen runs only after reset')
  // Every app check ran once before generation (old types) and once after it (new types).
  for (const cmd of ['run lint', 'run typecheck', 'test', 'run build', 'run format:check']) {
    const hits = calls.flatMap((c, i) => (c === cmd ? [i] : []))
    assert.equal(hits.length, 2, cmd)
    assert.ok(hits[0] < gen && hits[1] > gen, `${cmd} reruns after generation`)
  }
  const r = f.report()
  assert.equal(r.status, 'validated_local')
  assert.equal(f.check('generate types').status, 'pass')
  assert.equal(f.check('lint after types').status, 'pass')
  assert.equal(f.check('build after types').status, 'pass')
  assert.equal(f.check('source stability'), undefined)
  // Fingerprint covers the generated file, so the report is for the new types.
  assert.ok(r.source[typesFile])
  assert.equal(f.run('verify').status, 0)
})

test('lock held, failed reset and blocker all skip generation without touching the types file', (t) => {
  const held = typesFixture(t)
  assert.equal(held.start().status, 0)
  mkdirSync(resolve(held.cwd, 'tmp'), { recursive: true })
  const owner = JSON.stringify({ pid: process.pid, token: 'other-lane' })
  writeFileSync(held.lock, owner)
  assert.equal(held.finish(['--generate-types'], { CHB_DB_LOCK_TIMEOUT_MS: '0' }).status, 1)
  assert.equal(held.check('generate types').status, 'not_run')
  assert.equal(
    held.calls().some((c) => c.includes('gen') || c.includes('reset')),
    false,
  )
  assert.equal(readFileSync(held.lock, 'utf8'), owner)
  assert.equal(held.types(), oldTypes)

  const failed = typesFixture(t, { failReset: true })
  assert.equal(failed.start().status, 0)
  assert.equal(failed.finish(['--generate-types']).status, 1)
  assert.equal(failed.check('db reset').status, 'fail')
  assert.equal(failed.check('generate types').status, 'not_run')
  assert.equal(
    failed.calls().some((c) => c.includes('gen')),
    false,
  )
  assert.equal(failed.types(), oldTypes)

  const blocked = typesFixture(t)
  assert.equal(blocked.start().status, 0)
  blocked.finish(['--generate-types'], { CHB_DB_VALIDATION_BLOCKER: 'shared DB is another schema' })
  assert.equal(blocked.check('generate types').status, 'not_run')
  assert.match(blocked.check('generate types').reason, /another schema/)
  assert.equal(
    blocked.calls().some((c) => c.includes('gen') || c.includes('reset')),
    false,
  )
  assert.equal(blocked.types(), oldTypes)
})

test('generation without an owned lease is not attempted', (t) => {
  const f = typesFixture(t)
  assert.equal(f.start().status, 0)
  f.finish(['--generate-types'], { CHB_DB_LOCK_PATH: '' })
  assert.equal(f.check('generate types').status, 'not_run')
  assert.equal(
    f.calls().some((c) => c.includes('gen')),
    false,
  )
  assert.equal(f.types(), oldTypes)
})

test('failed, empty, invalid, malformed or executable CLI output preserves the old file byte-for-byte', (t) => {
  for (const gen of ['fail', 'empty', 'invalid', 'malformed', 'exec']) {
    const f = typesFixture(t, { gen })
    assert.equal(f.start().status, 0)
    assert.equal(f.finish(['--generate-types']).status, 1, gen)
    assert.equal(f.check('generate types').status, 'fail', gen)
    assert.ok(f.typesBytes().equals(Buffer.from(oldTypes)), gen)
    assert.equal(
      readdirSync(resolve(f.cwd, 'src/types')).some((name) => name.endsWith('.tmp')),
      false,
      gen,
    )
    if (gen === 'malformed') assert.match(f.check('generate types').reason, /not valid TypeScript/)
    if (gen === 'exec') assert.match(f.check('generate types').reason, /non-type top-level/)
    assert.equal(f.check('lint after types'), undefined, gen)
    assert.equal(f.report().status, 'needs_validation', gen)
    const log = readFileSync(resolve(f.cwd, f.check('generate types').log), 'utf8')
    assert.equal(log.includes('secret-token'), false, gen)
  }
})

test('type validator accepts real Supabase output shapes and the repo generated file', () => {
  const sample = `
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: { Tables: { [_ in never]: never }; Enums: { kind: "a" | "b" } }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Enums<T extends keyof DefaultSchema["Enums"], U = never> = T extends U ? never : DefaultSchema["Enums"][T]

export const Constants = {
  "public": {
    Enums: { kind: ["a", "b"] },
  },
} as const
`
  assert.equal(rejectGeneratedTypes(sample), null)
  const real = readFileSync(resolve(typesFile), 'utf8')
  assert.equal(rejectGeneratedTypes(real), null)
})

test('type validator rejects malformed Database, executable statements and non-literal constants', () => {
  const db = 'export type Database = { public: { Tables: {} } }\n'
  const cases = {
    'malformed Database': ['export type Database = { public: {\n', /not valid TypeScript/],
    'Database without body': ['export type Database =\n', /not valid TypeScript/],
    'only a token': ['// export type Database\n', /does not declare/],
    'Database not exported': ['type Database = { a: 1 }\n', /does not declare/],
    'call statement': [`${db}console.log(1)\n`, /non-type top-level/],
    'exported call': [
      `${db}export const x = fetch('http://example.invalid')\n`,
      /non-type top-level/,
    ],
    'let binding': [`${db}export let Constants = {}\n`, /non-type top-level/],
    'Constants with call': [
      `${db}export const Constants = { a: run() } as const\n`,
      /non-type top-level/,
    ],
    'Constants with spread': [
      `${db}export const Constants = { ...other } as const\n`,
      /non-type top-level/,
    ],
    import: [`import fs from 'node:fs'\n${db}`, /non-type top-level/],
    function: [`${db}export function f() {}\n`, /non-type top-level/],
    enum: [`${db}export enum E { A }\n`, /non-type top-level/],
    'export default': [`${db}export default {}\n`, /non-type top-level/],
    'stray empty statement': [`${db};;\n`, /non-type top-level/],
  }
  for (const [name, [text, reason]] of Object.entries(cases))
    assert.match(String(rejectGeneratedTypes(text)), reason, name)
})

test('unrelated source mutated by the generator is reported, not hidden', (t) => {
  const f = typesFixture(t, { gen: 'mutate' })
  assert.equal(f.start().status, 0)
  assert.equal(f.finish(['--generate-types']).status, 1)
  assert.equal(f.types(), newTypes)
  const stability = f.check('source stability')
  assert.equal(stability.status, 'fail')
  assert.match(stability.reason, /src\/app\.ts/)
  assert.doesNotMatch(stability.reason, /database\.generated/)
})

test('a hung type generator makes DB lifetime uncertain: pgTAP/integration not run, lease retained', async (t) => {
  const f = typesFixture(t, { gen: 'hang' })
  assert.equal(f.start().status, 0)
  const result = f.finish(['--generate-types'], { CHB_VALIDATION_TIMEOUT_MS: '1500' })
  assert.equal(result.status, 1)
  assert.equal(f.check('db reset').status, 'pass')
  assert.equal(f.check('generate types').status, 'fail')
  for (const name of ['pgTAP', 'integration']) {
    assert.equal(f.check(name).status, 'not_run', name)
    assert.match(f.check(name).reason, /lifetime uncertain/, name)
  }
  // The DB-touching npm scripts were never invoked after the generator timed out.
  assert.equal(
    f.calls().some((c) => c.includes('test:db') || c.includes('test:integration')),
    false,
  )
  assert.equal(f.check('db lease retained').status, 'fail')
  assert.equal(f.check('db lease release'), undefined)
  assert.equal(f.report().status, 'needs_validation')
  // Lease file is untouched and still names this pipeline process as its owner.
  const owner = JSON.parse(readFileSync(f.lock, 'utf8'))
  assert.equal(owner.pid, result.pid)
  assert.equal(f.check('db lease').reason, `owned ${leaseText(owner)}`)
  assert.equal(JSON.stringify(f.report()).includes(owner.token), false)
  assert.equal(f.types(), oldTypes)
  // The mock's detached child ends by itself; wait for it so nothing outlives the fixture.
  await waitFor(resolve(f.cwd, 'tmp/gen-child-ended'))
})

test('a concurrent edit of the types file inside the generation window is reported', async (t) => {
  const f = typesFixture(t, { gen: 'hijack' })
  assert.equal(f.start().status, 0)
  const result = f.finish(['--generate-types'])
  await waitFor(resolve(f.cwd, 'tmp/hijack-done'))
  assert.equal(readFileSync(resolve(f.cwd, 'tmp/hijack-done'), 'utf8'), 'hijacked')
  assert.equal(result.status, 1)
  assert.equal(f.check('generate types').status, 'pass', f.check('generate types').reason)
  assert.match(f.types(), /hijacked/)
  const stability = f.check('source stability')
  assert.equal(stability.status, 'fail')
  assert.match(stability.reason, /src\/types\/database\.generated\.ts/)
  assert.equal(f.report().status, 'needs_validation')
})

test('a clean owned-lease run records acquisition and release evidence, never the token', (t) => {
  const f = typesFixture(t)
  assert.equal(f.start().status, 0)
  const result = f.finish()
  assert.equal(result.status, 0, result.stderr)
  const r = f.report()
  const seen = JSON.parse(readFileSync(resolve(f.cwd, 'tmp/lease-seen.json'), 'utf8'))
  assert.equal(seen.pid, result.pid)
  const acquired = f.check('db lease')
  assert.equal(acquired.status, 'pass')
  assert.equal(acquired.command, 'exclusive local DB lease')
  assert.equal(acquired.reason, `owned ${leaseText(seen)}`)
  const released = f.check('db lease release')
  assert.equal(released.status, 'pass')
  assert.equal(released.reason, `released ${leaseText(seen)}`)
  assert.equal(
    r.checks.findIndex((c) => c.name === 'db lease') <
      r.checks.findIndex((c) => c.name === 'db reset'),
    true,
  )
  assert.equal(existsSync(f.lock), false)
  assert.equal(f.check('db lease retained'), undefined)
  assert.equal(r.status, 'validated_local')
  assert.equal(JSON.stringify(r).includes(seen.token), false)
  assert.equal(
    readFileSync(resolve(f.cwd, 'docs/handoff/reports', `${r.runId}.md`), 'utf8').includes(
      seen.token,
    ),
    false,
  )
  assert.equal(f.run('verify').status, 0)
})

test('without CHB_DB_LOCK_PATH no lease ownership is claimed; a foreign lease yields no owned row', (t) => {
  const none = typesFixture(t)
  assert.equal(none.start().status, 0)
  assert.equal(none.finish([], { CHB_DB_LOCK_PATH: '' }).status, 0)
  for (const name of ['db lease', 'db lease release', 'db lease retained'])
    assert.equal(none.check(name), undefined, name)
  assert.equal(none.report().status, 'validated_local')

  const foreign = typesFixture(t)
  assert.equal(foreign.start().status, 0)
  mkdirSync(resolve(foreign.cwd, 'tmp'), { recursive: true })
  const owner = JSON.stringify({ pid: process.pid, token: 'other-lane', createdAt: 'x' })
  writeFileSync(foreign.lock, owner)
  assert.equal(foreign.finish([], { CHB_DB_LOCK_TIMEOUT_MS: '0' }).status, 1)
  assert.equal(foreign.check('db validation slot').status, 'fail')
  for (const name of ['db lease', 'db lease release', 'db lease retained'])
    assert.equal(foreign.check(name), undefined, name)
  assert.equal(readFileSync(foreign.lock, 'utf8'), owner)
})
