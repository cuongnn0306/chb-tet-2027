import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { test } from 'node:test'
import { acquireDbValidationLock } from '../../scripts/db-validation-lock.mjs'

function fixture(t) {
  const dir = mkdtempSync(resolve(tmpdir(), 'chb-db-lease-'))
  t.after(() => {
    assert.ok(resolve(dir).startsWith(`${resolve(tmpdir())}${sep}chb-db-lease-`))
    rmSync(dir, { recursive: true, force: true })
  })
  return { dir, lock: resolve(dir, 'db.lock') }
}

test('foreign lease blocks reset access without deleting or altering it', (t) => {
  const { lock } = fixture(t)
  writeFileSync(lock, JSON.stringify({ pid: process.pid, token: 'foreign' }))
  const before = readFileSync(lock, 'utf8')
  assert.throws(() => acquireDbValidationLock(lock, { timeoutMs: 0 }), /occupied/)
  assert.equal(readFileSync(lock, 'utf8'), before)
})

test('borrowed worker lease is rejected and its owner remains untouched', (t) => {
  const { lock } = fixture(t)
  writeFileSync(lock, JSON.stringify({ pid: process.pid, token: 'primary' }))
  assert.throws(
    () => acquireDbValidationLock(lock, { ownerToken: 'primary', timeoutMs: 0 }),
    /Borrowed/,
  )
  assert.equal(existsSync(lock), true)
})

test('release refuses an ownership change and symlink leases fail closed', (t) => {
  const { dir, lock } = fixture(t)
  const release = acquireDbValidationLock(lock)
  writeFileSync(lock, JSON.stringify({ pid: process.pid, token: 'other' }))
  assert.throws(release, /ownership changed/)
  const target = resolve(dir, 'target')
  writeFileSync(target, 'do not read or overwrite')
  const link = resolve(dir, 'link')
  try {
    symlinkSync(target, link)
  } catch (error) {
    if (error.code === 'EPERM') return // Windows may not grant symlink creation.
    throw error
  }
  assert.throws(() => acquireDbValidationLock(link), /symlink/)
  assert.equal(readFileSync(target, 'utf8'), 'do not read or overwrite')
})

test('two processes serialize the entire critical section', async (t) => {
  const { dir, lock } = fixture(t)
  const events = resolve(dir, 'events')
  const module = new URL('../../scripts/db-validation-lock.mjs', import.meta.url).href
  const run = (name) =>
    new Promise((resolveRun, reject) => {
      const script = `import {acquireDbValidationLock} from ${JSON.stringify(module)};import {appendFileSync} from 'node:fs';const release=acquireDbValidationLock(${JSON.stringify(lock)},{pollMs:10,timeoutMs:5000});appendFileSync(${JSON.stringify(events)},${JSON.stringify(name + ':start\n')});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);appendFileSync(${JSON.stringify(events)},${JSON.stringify(name + ':end\n')});release();`
      const child = spawn(process.execPath, ['--input-type=module', '-e', script])
      let stderr = ''
      child.stderr.on('data', (b) => {
        stderr += b
      })
      child.on('error', reject)
      child.on('exit', (code) => (code === 0 ? resolveRun() : reject(new Error(stderr))))
    })
  await Promise.all([run('A'), run('B')])
  const lines = readFileSync(events, 'utf8').trim().split('\n')
  assert.ok(
    ['A:start,A:end,B:start,B:end', 'B:start,B:end,A:start,A:end'].includes(lines.join(',')),
  )
  assert.equal(existsSync(lock), false)
})
