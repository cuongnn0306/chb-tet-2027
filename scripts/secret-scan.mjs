/**
 * Secret scan of the working source and local Git history (SEC-004).
 * Usage: npm run check:secrets [-- --tree-only | --history-only]
 *
 * Only LOCAL history is read (git log --all); remotes are never contacted. Output holds rule ids,
 * sanitized paths, line numbers, 12-char commit ids and short fingerprints — never credential values.
 * No inline suppression exists. A reviewed hit may be allowed only by rule+fingerprint (with a reason)
 * in scripts/secret-scan.allowlist.json, e.g. after the credential has been rotated.
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { fingerprint, findSecretShapes } from './env-scan.mjs'

const MAX_FILE_BYTES = 64 * 1024 * 1024 // beyond this a file is reported as skipped, never silently
const SKIP_PATH = /(^|\/)(node_modules|dist|coverage)\//
const ASSIGNMENT_RE =
  /\b[A-Za-z0-9_]*(?:SERVICE_ROLE_KEY|WEBHOOK_SECRET|API_KEY|CLIENT_SECRET|ACCESS_TOKEN|AUTH_TOKEN|PRIVATE_KEY|DB_PASSWORD)\b['"]?\s*[:=]\s*(['"`])([^'"`\s]{20,})\1/gi
const PLACEHOLDER_RE =
  /^env\(|\$\{|example|placeholder|changeme|dummy|fake|your[-_]|xxxx|redacted|<.*>/i

const here = dirname(fileURLToPath(import.meta.url))

export function sanitizePath(path) {
  return path
    .replace(/\\/g, '/')
    .replace(/[^\x20-\x7e]/g, '?')
    .slice(0, 200)
}

function entropy(s) {
  const counts = new Map()
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1)
  let h = 0
  for (const n of counts.values()) h -= (n / s.length) * Math.log2(n / s.length)
  return h
}

function looksLikeSecretLiteral(v) {
  return !PLACEHOLDER_RE.test(v) && entropy(v) >= 3.2 && /[A-Za-z]/.test(v) && /[0-9_+/=-]/.test(v)
}

function scanChunk(chunk) {
  const found = findSecretShapes(chunk)
  for (const m of chunk.matchAll(ASSIGNMENT_RE)) {
    if (looksLikeSecretLiteral(m[2] ?? '')) {
      const rule = 'hardcoded-secret-assignment'
      found.push({ rule, fingerprint: fingerprint(rule, m[2]), index: m.index })
    }
  }
  return found
}

/**
 * Findings for one complete line. Credentials may exceed any fixed overlap size,
 * so scan the full line rather than truncating matches at window boundaries.
 */
export function scanLine(line) {
  return scanChunk(line).map(({ rule, fingerprint }) => ({ rule, fingerprint }))
}

/** Allowlist entries are { rule, fingerprint, reason }; an entry without a reason is a hard error. */
export function loadAllowlist(path = resolve(here, 'secret-scan.allowlist.json')) {
  if (!existsSync(path)) return new Set()
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  const out = new Set()
  for (const e of parsed.entries ?? []) {
    if (!e.rule || !/^[0-9a-f]{10}$/.test(e.fingerprint ?? '') || !String(e.reason ?? '').trim())
      throw new Error(
        'secret-scan.allowlist.json: mỗi mục cần rule, fingerprint (10 hex) và reason',
      )
    out.add(`${e.rule}:${e.fingerprint}`)
  }
  return out
}

const isAllowed = (allow, f) => allow.has(`${f.rule}:${f.fingerprint}`)

/** Scans text (a file body). There is no inline suppression: only reviewed fingerprints are skipped. */
export function scanText(text, { path = '', allowlist = new Set() } = {}) {
  const out = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    for (const f of scanLine(line))
      if (!isAllowed(allowlist, f)) out.push({ ...f, path: sanitizePath(path), line: i + 1 })
  }
  return out
}

function git(root, args) {
  return execFileSync('git', ['-C', root, '-c', 'core.quotepath=false', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

export function isGitRepo(root) {
  try {
    return git(root, ['rev-parse', '--is-inside-work-tree']).trim() === 'true'
  } catch {
    return false
  }
}

/** Working source = tracked + untracked-but-not-ignored files. Ignored env files are check:env's job. */
export function scanWorkingTree(root, { allowlist = new Set() } = {}) {
  const files = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0')
    .filter(Boolean)
  const findings = []
  let scanned = 0
  const skipped = []
  let binary = 0
  for (const rel of files) {
    if (SKIP_PATH.test(rel)) continue
    const abs = resolve(root, rel)
    let st
    try {
      st = statSync(abs)
    } catch {
      continue // listed but deleted in the working tree
    }
    if (!st.isFile()) continue
    if (st.size > MAX_FILE_BYTES) {
      skipped.push(sanitizePath(rel))
      continue
    }
    const buf = readFileSync(abs)
    if (buf.includes(0)) {
      binary++
      continue
    }
    scanned++
    findings.push(...scanText(buf.toString('utf8'), { path: rel, allowlist }))
  }
  return { findings, scanned, binary, skipped }
}

/**
 * Scans every line ever added in local history (all refs). A secret deleted later is still found
 * in the commit that added it. Returns grouped findings with the oldest commits that introduced them.
 */
export async function scanHistory(root, { allowlist = new Set() } = {}) {
  const shallow = git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true'
  const child = spawn(
    'git',
    [
      '-C',
      root,
      '-c',
      'core.quotepath=false',
      'log',
      '--all',
      '-m',
      '--no-color',
      '--no-ext-diff',
      '--no-renames',
      '-p',
      '-U0',
      '--format=%x01%H',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let stderr = ''
  child.stderr.on('data', (d) => (stderr += d))
  const exited = new Promise((res, rej) => {
    child.on('error', rej)
    child.on('close', (code) =>
      code === 0 ? res() : rej(new Error(`git log failed: ${stderr.trim()}`)),
    )
  })

  const groups = new Map()
  const commits = new Set()
  let commit = ''
  let path = null
  let lineNo = 0
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity })
  for await (const raw of rl) {
    if (raw.startsWith('\u0001')) {
      commit = raw.slice(1)
      commits.add(commit)
      path = null
    } else if (raw.startsWith('+++ ')) {
      const p = raw.slice(4).replace(/\t$/, '')
      path = p === '/dev/null' ? null : p.replace(/^b\//, '')
    } else if (raw.startsWith('@@')) {
      lineNo = Number(/\+(\d+)/.exec(raw)?.[1] ?? 0) - 1
    } else if (raw.startsWith('+') && path && !SKIP_PATH.test(path)) {
      lineNo++
      for (const f of scanLine(raw.slice(1))) {
        if (isAllowed(allowlist, f)) continue
        const key = `${f.rule}:${f.fingerprint}:${path}`
        const g = groups.get(key) ?? {
          rule: f.rule,
          fingerprint: f.fingerprint,
          path: sanitizePath(path),
          commits: [],
          line: lineNo,
        }
        if (!g.commits.includes(commit.slice(0, 12))) g.commits.push(commit.slice(0, 12))
        groups.set(key, g)
      }
    }
  }
  await exited
  return { findings: [...groups.values()], commitCount: commits.size, shallow }
}

export function formatFinding(f, label = 'LỖI') {
  const where = f.line ? `${f.path}:${f.line}` : f.path
  const refs = f.commits
    ? `, commit ${f.commits.slice(-3).reverse().join('/')}${f.commits.length > 3 ? ` (+${f.commits.length - 3})` : ''}`
    : ''
  return `${label} [${f.rule}] ${where}${refs} (fingerprint ${f.fingerprint})`
}

async function main(argv) {
  const root = process.cwd()
  const treeOnly = argv.includes('--tree-only')
  const historyOnly = argv.includes('--history-only')
  if (!isGitRepo(root)) {
    console.error('LỖI: không phải Git work tree; không thể quét secret.')
    return 1
  }
  const allowlist = loadAllowlist()
  let failed = false

  let treePrints = new Set()
  if (!historyOnly) {
    const { findings, scanned, binary, skipped } = scanWorkingTree(root, { allowlist })
    for (const p of skipped) console.error(`LỖI: ${p} quá lớn (>64MB), chưa được quét secret.`)
    if (skipped.length) failed = true
    for (const f of findings) {
      console.error(formatFinding(f))
      treePrints.add(`${f.rule}:${f.fingerprint}`)
    }
    if (findings.length) {
      failed = true
      console.error(
        'Gỡ secret khỏi mã nguồn, dùng biến môi trường, và xoay (rotate) khóa nếu đã commit.',
      )
    }
    console.log(
      `Working tree: quét ${scanned} file (bỏ qua ${binary} file nhị phân), ${findings.length} phát hiện.`,
    )
  }
  if (!treeOnly) {
    const { findings, commitCount, shallow } = await scanHistory(root, { allowlist })
    if (shallow)
      console.error('CẢNH BÁO: clone shallow — lịch sử Git chưa đầy đủ (dùng fetch-depth: 0).')
    for (const f of findings) {
      const still = treePrints.has(`${f.rule}:${f.fingerprint}`)
      console.error(
        formatFinding(f, still ? 'LỖI' : 'LỖI (đã xóa khỏi cây, vẫn còn trong lịch sử)'),
      )
    }
    if (findings.length) {
      failed = true
      console.error(
        'Lịch sử: hãy xoay (rotate) credential. Việc viết lại lịch sử do con người quyết định; ' +
          'sau khi xoay, ghi fingerprint + lý do vào scripts/secret-scan.allowlist.json.',
      )
    }
    console.log(
      `Git history (local, --all): quét ${commitCount} commit, ${findings.length} phát hiện.`,
    )
  }
  if (!failed) console.log('OK: không phát hiện secret.')
  return failed ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`LỖI: ${err instanceof Error ? err.message : 'quét thất bại'}`)
      process.exit(2)
    },
  )
}
