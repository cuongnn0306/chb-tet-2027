export interface ScanFinding {
  rule: string
  fingerprint: string
  path: string
  line: number
}

export interface HistoryFinding {
  rule: string
  fingerprint: string
  path: string
  line: number
  commits: string[]
}

export function sanitizePath(path: string): string
export function scanLine(line: string): { rule: string; fingerprint: string }[]
export function loadAllowlist(path?: string): Set<string>
export function scanText(
  text: string,
  options?: { path?: string; allowlist?: Set<string> },
): ScanFinding[]
export function isGitRepo(root: string): boolean
export function scanWorkingTree(
  root: string,
  options?: { allowlist?: Set<string> },
): { findings: ScanFinding[]; scanned: number; binary: number; skipped: string[] }
export function scanHistory(
  root: string,
  options?: { allowlist?: Set<string> },
): Promise<{ findings: HistoryFinding[]; commitCount: number; shallow: boolean }>
export function formatFinding(finding: ScanFinding | HistoryFinding, label?: string): string
