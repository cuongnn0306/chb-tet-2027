import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { test } from 'node:test'

const script = resolve('scripts/task-pipeline.mjs')
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
