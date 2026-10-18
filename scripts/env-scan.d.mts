export const BROWSER_PREFIX: string
export const VITE_MODES: string[]
export const APP_ENVS: string[]
export const ANON_KEY_VARS: string[]

export type KeyKind =
  | 'empty'
  | 'supabase-publishable'
  | 'supabase-secret'
  | 'jwt-anon'
  | 'jwt-service-role'
  | 'jwt-other-role'
  | 'jwt-no-role'
  | 'jwt-malformed'
  | 'other'

export interface SecretShape {
  rule: string
  fingerprint: string
  /** Start offset of the match within the scanned text. */
  index: number
}

export interface EnvEntry {
  key: string
  value: string
  line: number
}

export interface ViteVar extends EnvEntry {
  source: string
  refs: string[]
}

export interface EnvFinding {
  severity: 'error' | 'warning'
  code: string
  key: string
  source: string
  line: number
  modes: string[]
  message: string
  shadowed?: boolean
}

export function fingerprint(rule: string, value: string): string
export function decodeJwt(value: string): { role: string | null } | null
export function classifyKey(value: string): { kind: KeyKind; role?: string }
export function findSecretShapes(
  text: string,
  options?: { allowLocalUrls?: boolean },
): SecretShape[]
export function parseDotenv(text: string): EnvEntry[]
export function viteEnvFileNames(mode: string): string[]
export function loadViteEnv(options: {
  root: string
  mode: string
  processEnv?: Record<string, string | undefined>
}): { vars: ViteVar[]; shadowed: ViteVar[] }
export function evaluateBrowserVar(
  key: string,
  value: string,
): { code: string; detail?: string; fingerprint?: string }[]
export function scanEnv(options: {
  root: string
  modes?: string[]
  processEnv?: Record<string, string | undefined>
}): EnvFinding[]
export function formatFinding(finding: EnvFinding): string
