/// <reference types="node" />
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  classifyKey,
  evaluateBrowserVar,
  formatFinding,
  parseDotenv,
  scanEnv,
  type EnvFinding,
} from '../../../scripts/env-scan.mjs'

// All credentials below are synthetic and assembled at runtime so no real-looking secret lives in source.
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (role?: string) =>
  `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'synthetic-test', ...(role ? { role } : {}) })}.${'Zq9'.repeat(8)}`
const SERVICE = jwt('service_role')
const ANON = jwt('anon')
const SB_SECRET = `sb_${'secret'}_${'Ab12Cd34'.repeat(3)}`
const SB_PUBLISHABLE = `sb_${'publishable'}_${'Ef56Gh78'.repeat(3)}`
const SERVICE_SIGNATURE = 'Zq9'.repeat(8)
const CRED_URL = ['postgres://app', 'hunter22@db.example.test/app'].join(':')

const roots: string[] = []
function makeRoot(files: Record<string, string>): string {
  const root = mkdtempSync(resolve(tmpdir(), 'chb-env-scan-'))
  roots.push(root)
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(resolve(root, name)), { recursive: true })
    writeFileSync(resolve(root, name), content)
  }
  return root
}
afterEach(() => {
  for (const r of roots.splice(0)) {
    if (!r.startsWith(resolve(tmpdir(), 'chb-env-scan-'))) throw new Error('Unsafe fixture cleanup')
    rmSync(r, { recursive: true, force: true })
  }
})

const errors = (f: EnvFinding[]) => f.filter((x) => x.severity === 'error')
const render = (f: EnvFinding[]) => f.map(formatFinding).join('\n')

describe('classifyKey', () => {
  it('decodes the JWT role without needing a signature check', () => {
    expect(classifyKey(ANON).kind).toBe('jwt-anon')
    expect(classifyKey(SERVICE)).toEqual({ kind: 'jwt-service-role', role: 'service_role' })
    expect(classifyKey(jwt('supabase_admin')).kind).toBe('jwt-other-role')
    expect(classifyKey(jwt()).kind).toBe('jwt-no-role')
  })

  it('recognises new-style Supabase keys, empty and malformed values', () => {
    expect(classifyKey(SB_PUBLISHABLE).kind).toBe('supabase-publishable')
    expect(classifyKey(SB_SECRET).kind).toBe('supabase-secret')
    expect(classifyKey('  ').kind).toBe('empty')
    expect(classifyKey('eyJbroken.jwt').kind).toBe('jwt-malformed')
    expect(classifyKey('plain-value').kind).toBe('other')
  })
})

describe('parseDotenv', () => {
  it('handles export, quotes, inline comments and multi-line quoted values', () => {
    const entries = parseDotenv(
      [
        '# c',
        'export A=1',
        'B="two words" # note',
        "C='x'",
        'D=plain # tail',
        'E="l1',
        'l2"',
        'F=',
      ].join('\n'),
    )
    expect(entries.map((e) => [e.key, e.value])).toEqual([
      ['A', '1'],
      ['B', 'two words'],
      ['C', 'x'],
      ['D', 'plain'],
      ['E', 'l1\nl2'],
      ['F', ''],
    ])
    expect(entries.find((e) => e.key === 'F')?.line).toBe(8)
  })

  it('matches the installed Vite: `#` ends an unquoted value and `KEY: value` is not an entry', () => {
    const entries = parseDotenv(['A: one', 'export B:  "two words"', 'D=x#y', 'E:\tz'].join('\n'))
    expect(entries.map((e) => [e.key, e.value, e.line])).toEqual([['D', 'x', 3]])
  })
})

describe('evaluateBrowserVar', () => {
  it('accepts public anon and publishable keys and ordinary values', () => {
    expect(evaluateBrowserVar('VITE_SUPABASE_ANON_KEY', ANON)).toEqual([])
    expect(evaluateBrowserVar('VITE_SUPABASE_ANON_KEY', SB_PUBLISHABLE)).toEqual([])
    expect(evaluateBrowserVar('VITE_SUPABASE_ANON_KEY', '')).toEqual([])
    expect(evaluateBrowserVar('VITE_SUPABASE_URL', 'https://abc.supabase.co')).toEqual([])
    expect(evaluateBrowserVar('VITE_APP_ENV', 'staging')).toEqual([])
  })

  it('rejects server keys hidden behind a legitimate browser variable name', () => {
    expect(evaluateBrowserVar('VITE_SUPABASE_ANON_KEY', SERVICE).map((i) => i.code)).toEqual([
      'server-key-in-browser-var',
    ])
    expect(evaluateBrowserVar('VITE_SUPABASE_ANON_KEY', SB_SECRET).map((i) => i.code)).toContain(
      'server-key-in-browser-var',
    )
    expect(evaluateBrowserVar('VITE_ANALYTICS_ID', SERVICE).map((i) => i.code)).toContain(
      'server-key-in-browser-var',
    )
  })

  it('rejects malformed keys and non-anon roles in the anon key variable', () => {
    expect(
      evaluateBrowserVar('VITE_SUPABASE_ANON_KEY', 'eyJbroken.jwt').map((i) => i.code),
    ).toEqual(['malformed-key'])
    expect(evaluateBrowserVar('VITE_SUPABASE_ANON_KEY', 'not-a-key').map((i) => i.code)).toEqual([
      'malformed-key',
    ])
    expect(
      evaluateBrowserVar('VITE_SUPABASE_ANON_KEY', jwt('authenticated')).map((i) => i.code),
    ).toEqual(['not-anon-key'])
  })

  it('keeps the name-based check and flags other secret shapes', () => {
    expect(evaluateBrowserVar('VITE_SERVICE_ROLE_KEY', '').map((i) => i.code)).toEqual([
      'forbidden-name',
    ])
    expect(evaluateBrowserVar('VITE_DB', CRED_URL)[0]?.code).toBe('secret-in-browser-var')
  })
})

describe('scanEnv', () => {
  it('passes a clean setup with valid public keys', () => {
    const root = makeRoot({
      '.env.local': `VITE_APP_ENV=local\nVITE_SUPABASE_URL=http://127.0.0.1:54321\nVITE_SUPABASE_ANON_KEY=${ANON}\n`,
      '.env.production': `VITE_APP_ENV=production\nVITE_SUPABASE_ANON_KEY=${SB_PUBLISHABLE}\n`,
      '.env.example':
        'VITE_APP_ENV=local\nVITE_SUPABASE_URL=\nVITE_SUPABASE_ANON_KEY=\n# SEPAY_WEBHOOK_SECRET=\n',
    })
    expect(scanEnv({ root })).toEqual([])
  })

  it('does not treat non-browser server values as exposed', () => {
    const root = makeRoot({
      '.env.local': `SUPABASE_SERVICE_ROLE_KEY=${SERVICE}\nSEPAY_WEBHOOK_SECRET=abcdefabcdef\n`,
    })
    expect(scanEnv({ root })).toEqual([])
  })

  it('finds a service-role JWT in VITE_SUPABASE_ANON_KEY in .env.local with redacted output', () => {
    const root = makeRoot({ '.env.local': `VITE_SUPABASE_ANON_KEY=${SERVICE}\n` })
    const findings = scanEnv({ root })
    expect(errors(findings)).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      code: 'server-key-in-browser-var',
      key: 'VITE_SUPABASE_ANON_KEY',
      source: '.env.local',
      line: 1,
      modes: ['development', 'production', 'staging'],
    })
    const out = render(findings)
    expect(out).toContain('VITE_SUPABASE_ANON_KEY')
    expect(out).not.toContain(SERVICE)
    expect(out).not.toContain(SERVICE_SIGNATURE)
    expect(out).not.toContain('service_role')
  })

  it('finds sb_secret-style keys and redacts them', () => {
    const root = makeRoot({ '.env.production': `VITE_SUPABASE_ANON_KEY=${SB_SECRET}\n` })
    const findings = scanEnv({ root })
    expect(errors(findings).map((f) => f.code)).toContain('server-key-in-browser-var')
    expect(findings[0]?.modes).toEqual(['production'])
    expect(render(findings)).not.toContain(SB_SECRET)
  })

  it('applies Vite precedence: .env.[mode].local beats .env, so a shadowed bad value only warns there', () => {
    const root = makeRoot({
      '.env': `VITE_SUPABASE_ANON_KEY=${SERVICE}\n`,
      '.env.production.local': `VITE_SUPABASE_ANON_KEY=${ANON}\n`,
    })
    const findings = scanEnv({ root })
    const err = findings.find((f) => f.severity === 'error')
    const warn = findings.find((f) => f.severity === 'warning')
    expect(err?.modes).toEqual(['development', 'staging'])
    expect(warn).toMatchObject({ shadowed: true, source: '.env', modes: ['production'] })
  })

  it('ranks .env.[mode] above .env.local', () => {
    const root = makeRoot({
      '.env.local': `VITE_SUPABASE_ANON_KEY=${SERVICE}\n`,
      '.env.production': `VITE_SUPABASE_ANON_KEY=${ANON}\n`,
    })
    const err = scanEnv({ root }).find((f) => f.severity === 'error')
    expect(err?.modes).toEqual(['development', 'staging'])
  })

  it('reports mode-specific files only for their mode', () => {
    const root = makeRoot({ '.env.staging.local': `VITE_SUPABASE_ANON_KEY=${SERVICE}\n` })
    const findings = scanEnv({ root })
    expect(findings).toHaveLength(1)
    expect(findings[0]?.modes).toEqual(['staging'])
  })

  it('lets process.env win over files and also scans process.env itself', () => {
    const root = makeRoot({ '.env.local': `VITE_SUPABASE_ANON_KEY=${SERVICE}\n` })
    const overridden = scanEnv({ root, processEnv: { VITE_SUPABASE_ANON_KEY: ANON } })
    expect(errors(overridden)).toHaveLength(0)
    expect(overridden.every((f) => f.severity === 'warning' && f.shadowed)).toBe(true)

    const leaked = scanEnv({ root: makeRoot({}), processEnv: { VITE_SUPABASE_ANON_KEY: SERVICE } })
    expect(leaked[0]).toMatchObject({ severity: 'error', source: 'process.env' })
    expect(render(leaked)).not.toContain(SERVICE)
  })

  it('follows ${VAR} references into browser variables without printing values', () => {
    const root = makeRoot({
      '.env.local': `SUPABASE_SERVICE_ROLE_KEY=${SERVICE}\nVITE_SUPABASE_ANON_KEY=\${SUPABASE_SERVICE_ROLE_KEY}\n`,
    })
    const findings = scanEnv({ root })
    expect(errors(findings)).toHaveLength(1)
    const out = render(findings)
    expect(out).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(out).not.toContain(SERVICE)
  })

  it('flags invalid VITE_APP_ENV, forbidden names and malformed keys', () => {
    const root = makeRoot({
      '.env.local':
        'VITE_APP_ENV=prod\nVITE_PAYMENT_SECRET=\nVITE_SUPABASE_ANON_KEY=eyJbroken.jwt\n',
    })
    const codes = errors(scanEnv({ root })).map((f) => f.code)
    expect(codes).toEqual(
      expect.arrayContaining(['invalid-app-env', 'forbidden-name', 'malformed-key']),
    )
  })

  it('rejects real-looking credentials in .env.example but allows empty placeholders', () => {
    const bad = makeRoot({
      '.env.example': `VITE_SUPABASE_ANON_KEY=${SERVICE}\nSOME_URL=${CRED_URL}\n`,
    })
    const findings = scanEnv({ root: bad })
    expect(errors(findings).length).toBeGreaterThanOrEqual(2)
    expect(findings.every((f) => f.source === '.env.example')).toBe(true)
    expect(render(findings)).not.toContain(SERVICE)
  })

  it('ignores `KEY: value` lines like the installed Vite, but still flags `KEY=value`', () => {
    const root = makeRoot({
      '.env.local': `VITE_SUPABASE_ANON_KEY: ${SB_SECRET}\nVITE_OTHER_KEY=${SERVICE}\n`,
    })
    const findings = scanEnv({ root })
    expect(errors(findings).map((f) => [f.code, f.key, f.line])).toEqual([
      ['server-key-in-browser-var', 'VITE_OTHER_KEY', 2],
    ])
    const out = render(findings)
    expect(out).not.toContain(SB_SECRET)
    expect(out).not.toContain(SERVICE)
    expect(out).not.toContain(SERVICE_SIGNATURE)
  })

  it('fails when a real env file is tracked by Git', () => {
    const root = makeRoot({ '.env.local': 'VITE_APP_ENV=local\n' })
    const git = (...a: string[]) => execFileSync('git', ['-C', root, ...a], { stdio: 'ignore' })
    git('init', '-q')
    git('add', '-f', '.env.local')
    const f = scanEnv({ root }).find((x) => x.code === 'env-file-tracked')
    expect(f).toMatchObject({ severity: 'error', key: '.env.local' })
  })

  it.each(['ts', 'js', 'mts', 'mjs', 'cts', 'cjs'])(
    'rejects unsupported envDir in vite.config.%s',
    (extension) => {
      const root = makeRoot({
        [`vite.config.${extension}`]: 'export default { envDir: "./server-env" }',
      })
      expect(errors(scanEnv({ root }))).toContainEqual(
        expect.objectContaining({ code: 'custom-env-dir', source: `vite.config.${extension}` }),
      )
    },
  )

  it.each(['ts', 'js', 'mts', 'mjs', 'cts', 'cjs'])(
    'fails closed for unsupported envPrefix in vite.config.%s',
    (extension) => {
      const root = makeRoot({
        [`vite.config.${extension}`]: 'export default { envPrefix: ["VITE_", "SERVER_"] }',
      })
      expect(errors(scanEnv({ root }))).toContainEqual(
        expect.objectContaining({ code: 'custom-env-prefix', source: `vite.config.${extension}` }),
      )
    },
  )
})
