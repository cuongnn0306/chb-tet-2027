/**
 * Fails if a server secret can reach the browser through a Vite env variable (SEC-004).
 * Checks process.env plus the env files Vite loads for each mode (.env, .env.local,
 * .env.[mode], .env.[mode].local), key types (decoded JWT role, sb_secret_*), .env.example
 * and tracked env files. Values are never printed. Usage: npm run check:env
 */
import { formatFinding, scanEnv } from './env-scan.mjs'

const findings = scanEnv({ root: process.cwd(), processEnv: process.env })
const errors = findings.filter((f) => f.severity === 'error')

for (const f of findings) {
  const log = f.severity === 'error' ? console.error : console.warn
  log(formatFinding(f))
}

if (errors.length > 0) {
  console.error(
    `Phát hiện ${errors.length} lỗi. Sửa theo hướng dẫn rồi chạy lại; nếu khóa đã commit/deploy hãy xoay (rotate) khóa.`,
  )
  process.exit(1)
}
console.log(
  'OK: không có secret nào lộ qua biến VITE_* trong process.env và các file env của Vite.',
)
