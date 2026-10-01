/**
 * Fails if a server secret is exposed through a VITE_* variable or if the
 * environment name is unknown. Usage: npm run check:env
 */
const FORBIDDEN = /SERVICE_ROLE|SECRET|HMAC|PRIVATE|PASSWORD/i
let failed = false

for (const key of Object.keys(process.env)) {
  if (key.startsWith('VITE_') && FORBIDDEN.test(key)) {
    console.error(`LỖI: ${key} có tiền tố VITE_ nên sẽ lộ ra trình duyệt. Hãy đổi tên (bỏ VITE_).`)
    failed = true
  }
}

const appEnv = process.env.VITE_APP_ENV ?? 'local'
if (!['local', 'staging', 'production'].includes(appEnv)) {
  console.error(`LỖI: VITE_APP_ENV="${appEnv}" không hợp lệ.`)
  failed = true
}

if (failed) process.exit(1)
console.log(`OK: môi trường "${appEnv}", không có secret nào dùng tiền tố VITE_.`)
