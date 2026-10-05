import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute } from 'node:path'

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/**
 * A local validation lease. Never automatically remove a stale/foreign lease.
 * Returns a release function. When a lease is really owned, `release.lease` holds report-safe
 * evidence ({ pid, createdAt, tokenSha256 } = first 8 hex chars of the token's SHA-256, never the
 * token itself) and release() returns 'released' or 'absent'. Without a path nothing is owned:
 * the no-op release has no `lease`.
 */
export function acquireDbValidationLock(path, options = {}) {
  if (!path) return () => {}
  if (options.ownerToken)
    throw new Error(
      'Borrowed DB leases are unsupported; each validation process must own its lease.',
    )
  if (!isAbsolute(path)) throw new Error('DB validation lock must be an absolute path.')
  const timeoutMs = options.timeoutMs ?? 1_200_000
  const pollMs = options.pollMs ?? 500
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isFinite(pollMs) || pollMs <= 0)
    throw new Error('Invalid DB validation lock timeout.')
  mkdirSync(dirname(path), { recursive: true })
  const token = randomUUID()
  const start = Date.now()
  for (;;) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink())
      throw new Error('DB validation lease cannot be a symlink.')
    let fd
    try {
      fd = openSync(path, 'wx')
      const createdAt = new Date().toISOString()
      writeFileSync(fd, JSON.stringify({ pid: process.pid, token, createdAt }))
      closeSync(fd)
      const release = () => {
        if (!existsSync(path)) return 'absent'
        const owner = JSON.parse(readFileSync(path, 'utf8'))
        if (owner.token !== token || owner.pid !== process.pid)
          throw new Error('DB validation lease ownership changed; refusing to release it.')
        unlinkSync(path)
        return 'released'
      }
      release.lease = Object.freeze({
        pid: process.pid,
        createdAt,
        tokenSha256: createHash('sha256').update(token).digest('hex').slice(0, 8),
      })
      return release
    } catch (error) {
      if (fd !== undefined) closeSync(fd)
      if (error.code !== 'EEXIST') throw error
      if (Date.now() - start >= timeoutMs)
        throw new Error(
          'DB validation slot is occupied. No reset was run; retry after the owner finishes or reviewed crash recovery.',
        )
      pause(pollMs)
    }
  }
}
