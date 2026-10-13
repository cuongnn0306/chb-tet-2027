/// <reference types="node" />
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, truncateSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  formatFinding,
  loadAllowlist,
  sanitizePath,
  scanHistory,
  scanText,
  scanWorkingTree,
} from '../../../scripts/secret-scan.mjs'

// Synthetic credentials, assembled at runtime so this file itself stays clean for the scanner.
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (role: string) =>
  `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'synthetic-test', role })}.${'Qw7'.repeat(8)}`
const SERVICE = jwt('service_role')
const ANON = jwt('anon')
const AUTHENTICATED = jwt('authenticated')
const SB_SECRET = `sb_${'secret'}_${'Kl90Mn12'.repeat(3)}`
const CRED_URL = ['postgres://app', 'hunter22@db.example.test/app'].join(':')
const LOCAL_URL = ['postgresql://postgres', 'postgres@127.0.0.1:54322/postgres'].join(':')
const SCRIPT = resolve(process.cwd(), 'scripts/secret-scan.mjs')

const dirs: string[] = []
function makeRepo(): {
  root: string
  git: (...a: string[]) => string
  commit: (msg: string) => void
} {
  const root = mkdtempSync(resolve(tmpdir(), 'chb-secret-scan-'))
  dirs.push(root)
  const git = (...a: string[]) =>
    execFileSync(
      'git',
      [
        '-C',
        root,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.test',
        '-c',
        'commit.gpgsign=false',
        ...a,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
  git('init', '-q')
  return {
    root,
    git,
    commit: (msg) => (git('add', '-A'), git('commit', '-q', '-m', msg), undefined),
  }
}
afterEach(() => {
  for (const d of dirs.splice(0)) {
    if (!d.startsWith(resolve(tmpdir(), 'chb-secret-scan-')))
      throw new Error('Unsafe fixture cleanup')
    rmSync(d, { recursive: true, force: true })
  }
})

describe('scanText', () => {
  it('flags service-role JWTs, sb_secret keys and remote credential URLs', () => {
    const rules = scanText(`a=${SERVICE}\nb=${SB_SECRET}\nc=${CRED_URL}\n`, { path: 'x.ts' }).map(
      (f) => f.rule,
    )
    expect(rules).toEqual(['jwt-service-role', 'supabase-secret-key', 'url-credentials'])
  })

  it('allows public anon keys and local-only database URLs', () => {
    expect(scanText(`k=${ANON}\nu=${LOCAL_URL}\n`, { path: 'x.ts' })).toEqual([])
  })

  it('flags long literal secret assignments but not env references or placeholders', () => {
    const literal = ['SEPAY_WEBHOOK', 'SECRET'].join('_') + " = 'Xk29fQw81LmZp03vTr7YbN'"
    expect(scanText(literal, { path: 'a.ts' }).map((f) => f.rule)).toEqual([
      'hardcoded-secret-assignment',
    ])
    expect(
      scanText('auth_token = "env(SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN)"', { path: 'a.toml' }),
    ).toEqual([])
    expect(scanText("API_KEY = 'your-api-key-placeholder-value'", { path: 'a.ts' })).toEqual([])
  })

  it('flags authenticated user JWT bearer literals in generic source but not the anon key', () => {
    const src = `const session = '${AUTHENTICATED}'\nheaders.Authorization = "Bearer ${AUTHENTICATED}"\nconst anon = '${ANON}'\n`
    const hits = scanText(src, { path: 'src/session.ts' })
    expect(hits.map((h) => [h.rule, h.line])).toEqual([
      ['jwt-user-session', 1],
      ['jwt-user-session', 2],
    ])
    const out = hits.map((h) => formatFinding(h)).join('\n')
    expect(out).toContain('src/session.ts:1')
    expect(out).not.toContain(AUTHENTICATED)
    expect(out).not.toContain('Qw7Qw7')
  })

  it('does not let a service-role allowlist entry hide an authenticated token', () => {
    const [service] = scanText(`k=${SERVICE}`, { path: 'x.ts' })
    const allow = new Set([`${service!.rule}:${service!.fingerprint}`])
    expect(scanText(`k=${AUTHENTICATED}`, { path: 'x.ts', allowlist: allow })).toHaveLength(1)
  })

  it('has no inline suppression marker: a comment cannot hide a secret', () => {
    const hits = scanText(
      `// secret-scan:allow\nk=${SERVICE}\nj=${SERVICE} // secret-scan:allow\n`,
      { path: 'x.ts' },
    )
    expect(hits).toHaveLength(2)
  })

  it('reports file, line and fingerprint but never the value', () => {
    const [hit] = scanText(`\n\nk=${SERVICE}\n`, { path: 'src/a.ts' })
    const out = formatFinding(hit!)
    expect(out).toContain('src/a.ts:3')
    expect(out).toMatch(/fingerprint [0-9a-f]{10}/)
    expect(out).not.toContain(SERVICE)
    expect(out).not.toContain('Qw7Qw7')
  })

  it('skips only reviewed rule+fingerprint pairs', () => {
    const [hit] = scanText(`k=${SERVICE}`, { path: 'x.ts' })
    const allow = new Set([`${hit!.rule}:${hit!.fingerprint}`])
    expect(scanText(`k=${SERVICE}`, { path: 'x.ts', allowlist: allow })).toEqual([])
    expect(
      scanText(`k=${jwt('service_role')}x`, {
        path: 'x.ts',
        allowlist: new Set(['other:0000000000']),
      }),
    ).toHaveLength(1)
  })

  it('sanitizes control characters and separators in paths', () => {
    expect(sanitizePath('a\u001b[31m\\b\nc.ts')).toBe('a?[31m/b?c.ts')
  })
})

describe('loadAllowlist', () => {
  it('requires rule, fingerprint and a reason', () => {
    const { root } = makeRepo()
    const file = resolve(root, 'allow.json')
    writeFileSync(
      file,
      JSON.stringify({ entries: [{ rule: 'jwt-service-role', fingerprint: 'abcdef0123' }] }),
    )
    expect(() => loadAllowlist(file)).toThrow(/reason/)
    writeFileSync(
      file,
      JSON.stringify({
        entries: [
          { rule: 'jwt-service-role', fingerprint: 'abcdef0123', reason: 'rotated 2026-10-02' },
        ],
      }),
    )
    expect([...loadAllowlist(file)]).toEqual(['jwt-service-role:abcdef0123'])
    unlinkSync(file)
    expect(loadAllowlist(file).size).toBe(0)
  })
})

describe('working tree and local history', () => {
  it('scans package-lock registry credential URLs in the tree and deleted history', async () => {
    const { root, commit } = makeRepo()
    writeFileSync(resolve(root, 'package-lock.json'), JSON.stringify({ resolved: CRED_URL }))
    commit('lockfile credential')
    expect(scanWorkingTree(root).findings).toContainEqual(
      expect.objectContaining({ path: 'package-lock.json', rule: 'url-credentials' }),
    )
    writeFileSync(resolve(root, 'package-lock.json'), '{}')
    commit('remove lockfile credential')
    expect(scanWorkingTree(root).findings).toEqual([])
    expect((await scanHistory(root)).findings).toContainEqual(
      expect.objectContaining({ path: 'package-lock.json', rule: 'url-credentials' }),
    )
  })

  it('detects a secret introduced only by merge conflict resolution and deleted later', async () => {
    const { root, git, commit } = makeRepo()
    writeFileSync(resolve(root, 'merge.txt'), 'base\n')
    commit('base')
    const base = git('rev-parse', 'HEAD').trim()
    git('checkout', '-q', '-b', 'left')
    writeFileSync(resolve(root, 'merge.txt'), 'left\n')
    commit('left')
    git('checkout', '-q', '-b', 'right', base)
    writeFileSync(resolve(root, 'merge.txt'), 'right\n')
    commit('right')
    expect(() => git('merge', '--no-edit', 'left')).toThrow()
    writeFileSync(resolve(root, 'merge.txt'), `${SERVICE}\n`)
    commit('merge resolution')
    const mergeId = git('rev-parse', 'HEAD').trim().slice(0, 12)
    writeFileSync(resolve(root, 'merge.txt'), 'clean\n')
    commit('remove merge credential')
    expect(scanWorkingTree(root).findings).toEqual([])
    expect((await scanHistory(root)).findings).toContainEqual(
      expect.objectContaining({ rule: 'jwt-service-role', path: 'merge.txt', commits: [mergeId] }),
    )
  })
  it('detects a secret that was committed and later deleted, and reports sanitized references', async () => {
    const { root, git, commit } = makeRepo()
    writeFileSync(resolve(root, 'config.ts'), `export const key = '${SERVICE}'\n`)
    commit('add config')
    const [introducing] = git('rev-parse', 'HEAD').trim().split('\n')
    writeFileSync(resolve(root, 'config.ts'), 'export const key = process.env.KEY\n')
    commit('remove secret')

    expect(scanWorkingTree(root).findings).toEqual([])

    const { findings, commitCount, shallow } = await scanHistory(root)
    expect(shallow).toBe(false)
    expect(commitCount).toBe(2)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ rule: 'jwt-service-role', path: 'config.ts', line: 1 })
    expect(findings[0]?.commits).toEqual([introducing!.slice(0, 12)])
    expect(formatFinding(findings[0]!)).not.toContain(SERVICE)
  })

  it('detects an authenticated user JWT in the tree and in history after deletion, redacted', async () => {
    const { root, git, commit } = makeRepo()
    writeFileSync(resolve(root, 'session.ts'), `export const token = '${AUTHENTICATED}'\n`)
    commit('add session token')
    const introducing = git('rev-parse', 'HEAD').trim().slice(0, 12)
    expect(scanWorkingTree(root).findings).toContainEqual(
      expect.objectContaining({ rule: 'jwt-user-session', path: 'session.ts', line: 1 }),
    )
    const cli = spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' })
    const cliOut = `${cli.stdout}${cli.stderr}`
    expect(cli.status).toBe(1)
    expect(cliOut).toContain('jwt-user-session')
    expect(cliOut).not.toContain(AUTHENTICATED)
    expect(cliOut).not.toContain('Qw7Qw7')

    writeFileSync(resolve(root, 'session.ts'), 'export const token = process.env.TOKEN\n')
    commit('remove session token')
    expect(scanWorkingTree(root).findings).toEqual([])
    const { findings } = await scanHistory(root)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'jwt-user-session',
      path: 'session.ts',
      commits: [introducing],
    })
    expect(formatFinding(findings[0]!)).not.toContain(AUTHENTICATED)
  })

  it('finds secrets on other local branches (git log --all)', async () => {
    const { root, git, commit } = makeRepo()
    writeFileSync(resolve(root, 'a.txt'), 'hello\n')
    commit('base')
    git('checkout', '-q', '-b', 'side')
    writeFileSync(resolve(root, 'b.txt'), `${SB_SECRET}\n`)
    commit('side secret')
    git('checkout', '-q', '-')
    expect((await scanHistory(root)).findings.map((f) => f.rule)).toEqual(['supabase-secret-key'])
  })

  it('stays usable: anon keys, local URLs, env references and fixtures do not fail a clean repo', async () => {
    const { root, commit } = makeRepo()
    writeFileSync(resolve(root, '.env.example'), 'VITE_SUPABASE_URL=\nVITE_SUPABASE_ANON_KEY=\n')
    writeFileSync(resolve(root, 'fixture.json'), JSON.stringify({ anon: ANON, db: LOCAL_URL }))
    writeFileSync(resolve(root, 'config.toml'), 'auth_token = "env(SOME_TOKEN)"\n')
    commit('clean')
    expect(scanWorkingTree(root).findings).toEqual([])
    expect((await scanHistory(root)).findings).toEqual([])
  })

  it('honours the reviewed fingerprint allowlist for history findings', async () => {
    const { root, commit } = makeRepo()
    writeFileSync(resolve(root, 'old.txt'), `${SERVICE}\n`)
    commit('old rotated key')
    const first = (await scanHistory(root)).findings[0]!
    const allow = new Set([`${first.rule}:${first.fingerprint}`])
    expect((await scanHistory(root, { allowlist: allow })).findings).toEqual([])
  })

  it('CLI exits non-zero and prints no raw credential', () => {
    const { root, commit } = makeRepo()
    writeFileSync(resolve(root, 'leak.ts'), `const k = '${SERVICE}'\nconst s = '${SB_SECRET}'\n`)
    commit('leak')
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' })
    const out = `${r.stdout}${r.stderr}`
    expect(r.status).toBe(1)
    expect(out).toContain('leak.ts:1')
    expect(out).toContain('jwt-service-role')
    for (const secret of [SERVICE, SB_SECRET, 'Qw7Qw7', 'Kl90Mn12'])
      expect(out).not.toContain(secret)
  })

  it('scans every position of very long lines, including chunk boundaries', () => {
    const fps = new Set<string>()
    for (const offset of [0, 24_500, 24_576 - 100, 32_768 - 100, 49_152 - 10, 100_000, 300_001]) {
      const line = `${' '.repeat(offset)}${SERVICE};${' '.repeat(120_000)}`
      const hits = scanText(line, { path: 'min.js' })
      expect(hits.map((h) => h.rule)).toEqual(['jwt-service-role'])
      fps.add(hits[0]!.fingerprint)
    }
    expect(fps.size).toBe(1)
    expect(scanText(`${' '.repeat(200_000)}${ANON}`, { path: 'min.js' })).toEqual([])
  })

  it('detects a credential longer than the former overlapping scan window', () => {
    const longJwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'service_role', padding: 'x'.repeat(40_000) })}.${'Qw7'.repeat(8)}`
    expect(
      scanText(`${' '.repeat(24_500)}${longJwt};`, { path: 'large.json' }).map((f) => f.rule),
    ).toEqual(['jwt-service-role'])
  })

  it('fails CLI when a file exceeds the scan coverage size limit', () => {
    const { root } = makeRepo()
    const path = resolve(root, 'oversize.txt')
    writeFileSync(path, '')
    truncateSync(path, 64 * 1024 * 1024 + 1)
    expect(scanWorkingTree(root).skipped).toEqual(['oversize.txt'])
    const r = spawnSync(process.execPath, [SCRIPT, '--tree-only'], { cwd: root, encoding: 'utf8' })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('oversize.txt')
    expect(r.stdout).not.toContain('OK:')
  })

  it('finds secrets in a long single-line file in the working tree and in history', async () => {
    const { root, commit } = makeRepo()
    const body = `${'a;'.repeat(60_000)}var k="${SERVICE}";${'b;'.repeat(60_000)}`
    writeFileSync(resolve(root, 'bundle.min.js'), body)
    commit('minified bundle')
    const tree = scanWorkingTree(root)
    expect(tree.findings).toHaveLength(1)
    expect(tree.findings[0]).toMatchObject({
      rule: 'jwt-service-role',
      path: 'bundle.min.js',
      line: 1,
    })

    writeFileSync(resolve(root, 'bundle.min.js'), 'var k=process.env.K;\n')
    commit('drop secret')
    expect(scanWorkingTree(root).findings).toEqual([])
    const hist = await scanHistory(root)
    expect(hist.findings).toHaveLength(1)
    expect(hist.findings[0]).toMatchObject({
      rule: 'jwt-service-role',
      path: 'bundle.min.js',
      line: 1,
    })
    expect(formatFinding(hist.findings[0]!)).not.toContain(SERVICE)
  })

  it('CLI exits zero on a clean repository', () => {
    const { root, commit } = makeRepo()
    writeFileSync(resolve(root, 'a.txt'), 'nothing here\n')
    commit('clean')
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' })
    expect(r.status).toBe(0)
  })
})
