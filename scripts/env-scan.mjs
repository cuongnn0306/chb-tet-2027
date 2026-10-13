/**
 * Env/secret scanning helpers (SEC-004). Pure functions plus a small Vite-env loader.
 *
 * Nothing in this module returns or logs a credential value: findings carry rule ids,
 * variable names, file:line references and short non-reversible fingerprints only.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const BROWSER_PREFIX = 'VITE_'
export const VITE_MODES = ['development', 'production', 'staging']
export const APP_ENVS = ['local', 'staging', 'production']
export const ANON_KEY_VARS = ['VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY']

const FORBIDDEN_NAME = /SERVICE_ROLE|SECRET|HMAC|PRIVATE|PASSWORD/i
const PUBLIC_JWT_ROLES = new Set(['anon'])
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal'])

const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g
const SB_SECRET_RE = /\bsb_secret_[A-Za-z0-9_-]{16,}/g
const SB_PUBLISHABLE_RE = /^sb_publishable_[A-Za-z0-9_-]{16,}$/
const PEM_RE = /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/g
const URL_CREDENTIALS_RE =
  /\b[a-z][a-z0-9+.-]*:\/\/([^\s/:@]+):([^\s/@]+)@(\[[^\]]+\]|[^\s/:?#]+)/gi
const TOKEN_RES = [
  /\bgh[pousr]_[A-Za-z0-9]{36,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bsk_live_[A-Za-z0-9]{16,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{20,}/g,
  /\bsbp_[0-9a-f]{40}\b/g,
]

/** Short, non-reversible id so a reviewed finding can be allowlisted without printing it. */
export function fingerprint(rule, value) {
  return createHash('sha256').update(`${rule}\0${value}`).digest('hex').slice(0, 10)
}

function b64urlJson(segment) {
  try {
    const parsed = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Decodes a JWT payload only (no signature check). Returns null when it is not a JWT. */
export function decodeJwt(value) {
  const parts = value.split('.')
  if (parts.length !== 3 || !parts[0]?.startsWith('eyJ')) return null
  const header = b64urlJson(parts[0])
  const payload = b64urlJson(parts[1] ?? '')
  if (!header || !payload) return null
  return { role: typeof payload.role === 'string' ? payload.role : null }
}

/**
 * Classifies a credential-looking value without exposing it.
 * kind: empty | supabase-publishable | supabase-secret | jwt-anon | jwt-service-role |
 *       jwt-other-role | jwt-no-role | jwt-malformed | other
 */
export function classifyKey(value) {
  const v = value.trim()
  if (v === '') return { kind: 'empty' }
  if (SB_PUBLISHABLE_RE.test(v)) return { kind: 'supabase-publishable' }
  if (/^sb_secret_/.test(v)) return { kind: 'supabase-secret' }
  if (v.startsWith('eyJ')) {
    const jwt = decodeJwt(v)
    if (!jwt) return { kind: 'jwt-malformed' }
    if (jwt.role === null) return { kind: 'jwt-no-role' }
    if (PUBLIC_JWT_ROLES.has(jwt.role)) return { kind: 'jwt-anon', role: jwt.role }
    if (jwt.role === 'service_role') return { kind: 'jwt-service-role', role: jwt.role }
    return { kind: 'jwt-other-role', role: jwt.role }
  }
  return { kind: 'other' }
}

/**
 * Finds credential shapes inside free text. Returns [{ rule, fingerprint, index }] (index = start
 * offset, used for chunked scanning) and never the match itself.
 * Public Supabase anon keys and local-only credential URLs are not findings.
 */
export function findSecretShapes(text, { allowLocalUrls = true } = {}) {
  const found = []
  const add = (rule, match, index) =>
    found.push({ rule, fingerprint: fingerprint(rule, match), index })

  for (const m of text.matchAll(JWT_RE)) {
    const jwt = decodeJwt(m[0])
    if (!jwt || jwt.role === null || PUBLIC_JWT_ROLES.has(jwt.role) || jwt.role === 'authenticated')
      continue
    add(jwt.role === 'service_role' ? 'jwt-service-role' : 'jwt-privileged-role', m[0], m.index)
  }
  for (const m of text.matchAll(SB_SECRET_RE)) add('supabase-secret-key', m[0], m.index)
  for (const m of text.matchAll(PEM_RE)) add('private-key-block', m[0], m.index)
  for (const m of text.matchAll(URL_CREDENTIALS_RE)) {
    if (allowLocalUrls && LOCAL_HOSTS.has((m[3] ?? '').toLowerCase())) continue
    add('url-credentials', `${m[1]}:${m[2]}@${m[3]}`, m.index)
  }
  for (const re of TOKEN_RES)
    for (const m of text.matchAll(re)) add('provider-token', m[0], m.index)
  return found
}

// --- dotenv parsing (same grammar as the dotenv package Vite uses) ------------------------------

// Only `KEY=value` is an entry: the installed Vite loads env files with node:util parseEnv, which
// ignores `KEY: value` lines, so the scanner must not report them. Optional `export`, quoted values
// (' " `) may span lines, an unquoted value ends at the first `#`.
const DOTENV_LINE =
  /(?:^|^)\s*(?:export\s+)?([\w.-]+)\s*=\s*?(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm

/** Parses dotenv text into [{ key, value, line }] following the installed Vite (`KEY=value` only). */
export function parseDotenv(text) {
  const entries = []
  const src = text.replace(/\r\n?/g, '\n')
  for (const m of src.matchAll(DOTENV_LINE)) {
    let value = (m[2] ?? '').trim()
    const quote = value[0]
    value = value.replace(/^(['"`])([\s\S]*)\1$/m, '$2')
    if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r')
    const keyStart = m.index + Math.max(0, m[0].search(/\S/))
    entries.push({ key: m[1], value, line: src.slice(0, keyStart).split('\n').length })
  }
  return entries
}

function expandValue(value, lookup, depth = 0) {
  if (depth > 5 || !value.includes('$')) return { value, refs: [] }
  const refs = []
  const out = value.replace(
    /(\\)?\$(?:\{([A-Za-z_][A-Za-z0-9_]*)(?::?-([^}]*))?\}|([A-Za-z_][A-Za-z0-9_]*))/g,
    (whole, escaped, braced, fallback, bare) => {
      if (escaped) return whole.slice(1)
      const name = braced ?? bare
      refs.push(name)
      const found = lookup(name)
      if (found === undefined || found === '') return fallback ?? ''
      const inner = expandValue(found, lookup, depth + 1)
      refs.push(...inner.refs)
      return inner.value
    },
  )
  return { value: out, refs }
}

/** Env files Vite loads for a mode, lowest to highest priority. */
export function viteEnvFileNames(mode) {
  return ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]
}

/**
 * Loads the VITE_* variables Vite would expose in `mode`. Priority: process.env > .env.[mode].local >
 * .env.[mode] > .env.local > .env. Losers are returned as `shadowed`.
 * Returns { vars: [{ key, value, source, line, refs }], shadowed: [...] } — values stay in memory only.
 */
export function loadViteEnv({ root, mode, processEnv = {} }) {
  const merged = new Map()
  const shadowed = []
  for (const name of viteEnvFileNames(mode)) {
    const path = resolve(root, name)
    if (!existsSync(path)) continue
    for (const e of parseDotenv(readFileSync(path, 'utf8'))) {
      const prev = merged.get(e.key)
      if (prev) shadowed.push(prev)
      merged.set(e.key, { ...e, source: name })
    }
  }
  const lookup = (name) => processEnv[name] ?? merged.get(name)?.value
  const vars = []
  const resolveEntry = (entry) => {
    const { value, refs } = expandValue(entry.value, lookup)
    return { ...entry, value, refs }
  }
  for (const entry of merged.values()) {
    if (!entry.key.startsWith(BROWSER_PREFIX)) continue
    if (processEnv[entry.key] !== undefined) {
      shadowed.push(entry)
      continue
    }
    vars.push(resolveEntry(entry))
  }
  for (const [key, value] of Object.entries(processEnv)) {
    if (key.startsWith(BROWSER_PREFIX) && value !== undefined)
      vars.push({ key, value, source: 'process.env', line: 0, refs: [] })
  }
  return {
    vars,
    shadowed: shadowed.filter((e) => e.key.startsWith(BROWSER_PREFIX)).map(resolveEntry),
  }
}

// --- evaluation ---------------------------------------------------------------------------------

const MESSAGES = {
  'forbidden-name': (k) =>
    `${k} có tiền tố VITE_ nên sẽ lộ ra trình duyệt. Đổi tên (bỏ VITE_) và đặt ở server env.`,
  'server-key-in-browser-var': (k, d) =>
    `${k} chứa khóa phía server (${d}). Gỡ khỏi biến VITE_, xoay (rotate) khóa nếu đã commit/deploy.`,
  'secret-in-browser-var': (k, d) =>
    `${k} chứa giá trị giống secret (${d}). Gỡ khỏi biến VITE_ và xoay khóa nếu đã bị lộ.`,
  'not-anon-key': (k, d) =>
    `${k} phải là khóa anon/publishable, nhưng là ${d}. Dùng khóa anon từ "supabase status".`,
  'malformed-key': (k) =>
    `${k} không phải JWT anon hợp lệ hay sb_publishable_*; không thể xác minh loại khóa.`,
  'invalid-app-env': () => `VITE_APP_ENV không thuộc ${APP_ENVS.join(' | ')}.`,
  'env-file-tracked': (k) => `${k} đang được Git theo dõi; env thật phải bị .gitignore.`,
  'secret-in-template': (k, d) =>
    `${k} trong file mẫu chứa giá trị giống secret (${d}). File mẫu chỉ được để trống/placeholder.`,
  'custom-env-prefix': () =>
    'vite.config có envPrefix tùy chỉnh; scanner chỉ kiểm tra tiền tố VITE_. Cập nhật scanner.',
  'custom-env-dir': () =>
    'vite.config có envDir tùy chỉnh; scanner chỉ kiểm tra env tại project root. Cập nhật scanner trước khi dùng envDir.',
}

function describe(rule) {
  return rule.replace(/-/g, ' ')
}

/** Issues for one browser-exposed variable: [{ code, detail }]. No values leave this function. */
export function evaluateBrowserVar(key, rawValue) {
  const issues = []
  if (FORBIDDEN_NAME.test(key)) issues.push({ code: 'forbidden-name' })

  const cls = classifyKey(rawValue)
  const shapes = findSecretShapes(rawValue, { allowLocalUrls: false })
  const isKeyRule = (r) =>
    r === 'jwt-service-role' || r === 'jwt-privileged-role' || r === 'supabase-secret-key'
  for (const s of shapes) {
    issues.push({
      code: isKeyRule(s.rule) ? 'server-key-in-browser-var' : 'secret-in-browser-var',
      detail: describe(s.rule),
      fingerprint: s.fingerprint,
    })
  }

  if (ANON_KEY_VARS.includes(key)) {
    const known = ['empty', 'jwt-anon', 'supabase-publishable']
    const covered = shapes.length > 0
    if (!known.includes(cls.kind) && !covered) {
      if (cls.kind === 'jwt-other-role' || cls.kind === 'jwt-no-role')
        issues.push({
          code: 'not-anon-key',
          detail: cls.role ? `JWT role "${cls.role}"` : 'JWT không có role',
        })
      else issues.push({ code: 'malformed-key' })
    }
  } else if (cls.kind === 'jwt-malformed') {
    issues.push({ code: 'malformed-key' })
  }
  return issues
}

function gitTracked(root, patterns) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--', ...patterns], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.split('\0').filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Scans the env sources Vite uses for each mode. Returns findings:
 * { severity: 'error'|'warning', code, key, source, line, modes, message, shadowed? }
 */
export function scanEnv({ root, modes = VITE_MODES, processEnv = {} }) {
  const byId = new Map()
  const push = (f) => {
    const id = [f.code, f.key, f.source, f.line, f.severity].join('|')
    const prev = byId.get(id)
    if (prev) {
      if (f.mode && !prev.modes.includes(f.mode)) prev.modes.push(f.mode)
      return
    }
    const { mode, ...rest } = f
    byId.set(id, { ...rest, modes: mode ? [mode] : [] })
  }
  const message = (code, key, detail) => (MESSAGES[code] ?? (() => code))(key, detail)

  for (const mode of modes) {
    const { vars, shadowed } = loadViteEnv({ root, mode, processEnv })
    for (const v of vars) {
      for (const issue of evaluateBrowserVar(v.key, v.value)) {
        const via = v.refs.length
          ? ` (qua tham chiếu \${${[...new Set(v.refs)].join('}, ${')}})`
          : ''
        push({
          severity: 'error',
          code: issue.code,
          key: v.key,
          source: v.source,
          line: v.line,
          mode,
          message: message(issue.code, v.key, issue.detail) + via,
        })
      }
      if (v.key === 'VITE_APP_ENV' && v.value !== '' && !APP_ENVS.includes(v.value))
        push({
          severity: 'error',
          code: 'invalid-app-env',
          key: v.key,
          source: v.source,
          line: v.line,
          mode,
          message: message('invalid-app-env'),
        })
    }
    for (const v of shadowed) {
      for (const issue of evaluateBrowserVar(v.key, v.value)) {
        push({
          severity: 'warning',
          code: issue.code,
          key: v.key,
          source: v.source,
          line: v.line,
          mode,
          shadowed: true,
          message: `${message(issue.code, v.key, issue.detail)} Giá trị này đang bị ghi đè nhưng vẫn nên xóa.`,
        })
      }
    }
  }

  const template = resolve(root, '.env.example')
  if (existsSync(template)) {
    for (const e of parseDotenv(readFileSync(template, 'utf8'))) {
      const shapes = findSecretShapes(e.value, { allowLocalUrls: false })
      const bad = e.key.startsWith(BROWSER_PREFIX)
        ? evaluateBrowserVar(e.key, e.value).filter((i) => i.code !== 'malformed-key')
        : shapes.map((s) => ({ code: 'secret-in-template', detail: describe(s.rule) }))
      for (const issue of bad)
        push({
          severity: 'error',
          code: issue.code,
          key: e.key,
          source: '.env.example',
          line: e.line,
          message: message(issue.code, e.key, issue.detail),
        })
    }
  }

  for (const tracked of gitTracked(root, ['.env', '.env.*'])) {
    if (tracked === '.env.example') continue
    push({
      severity: 'error',
      code: 'env-file-tracked',
      key: tracked,
      source: tracked,
      line: 0,
      message: message('env-file-tracked', tracked),
    })
  }

  for (const configName of [
    'vite.config.ts',
    'vite.config.js',
    'vite.config.mts',
    'vite.config.mjs',
    'vite.config.cts',
    'vite.config.cjs',
  ]) {
    const viteConfig = resolve(root, configName)
    if (!existsSync(viteConfig)) continue
    const configSource = readFileSync(viteConfig, 'utf8')
    for (const [option, code] of [
      ['envPrefix', 'custom-env-prefix'],
      ['envDir', 'custom-env-dir'],
    ]) {
      if (!new RegExp(`\\b${option}\\b`).test(configSource)) continue
      push({
        severity: 'error',
        code,
        key: option,
        source: configName,
        line: 0,
        message: message(code),
      })
    }
  }

  return [...byId.values()]
}

export function formatFinding(f) {
  const where = f.line ? `${f.source}:${f.line}` : f.source
  const modes = f.modes?.length ? `, mode: ${f.modes.join('/')}` : ''
  const label = f.severity === 'error' ? 'LỖI' : 'CẢNH BÁO'
  return `${label} [${f.code}] ${f.key} (${where}${modes}): ${f.message}`
}
