import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { acquireDbValidationLock } from './db-validation-lock.mjs'

const root = process.cwd()
const home = 'docs/handoff'
const registryPath = `${home}/tasks.json`
const planPath = 'docs/delivery/IMPLEMENTATION_INFRA_PLAN_v1.0.md'
const [action, id, ...args] = process.argv.slice(2)
const option = (name) => args[args.indexOf(name) + 1]
const hasOption = (name) => args.includes(name)
const fail = (message) => {
  throw new Error(message)
}
const read = (path) => readFileSync(resolve(root, path), 'utf8').replace(/^\uFEFF/, '')
const json = (path) => JSON.parse(read(path))
const save = (path, data) => {
  mkdirSync(dirname(resolve(root, path)), { recursive: true })
  writeFileSync(
    resolve(root, path),
    typeof data === 'string' ? cleanText(data) : `${JSON.stringify(data, null, 2)}\n`,
  )
}
const git = (...gitArgs) => {
  const result = spawnSync('git', gitArgs, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) fail(`git ${gitArgs[0]} thất bại; kiểm tra repository.`)
  return result.stdout.trim()
}
const hash = (data) => createHash('sha256').update(data).digest('hex')
// Documentation-only changes don't require an implementation report. Reports never hash themselves.
const governed = (path) => !path.startsWith('docs/') && !path.startsWith('tmp/')
const files = () =>
  git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean)
const snapshot = () =>
  Object.fromEntries(
    [...new Set(files())]
      .filter((path) => governed(path) && existsSync(resolve(root, path)))
      .sort()
      .map((path) => {
        const bytes = existsSync(resolve(root, path)) ? readFileSync(resolve(root, path)) : null
        // Match source fingerprints between Windows CRLF and Linux CI checkouts; preserve binary bytes.
        return [
          path,
          bytes
            ? hash(bytes.includes(0) ? bytes : bytes.toString('utf8').replace(/\r\n/g, '\n'))
            : null,
        ]
      }),
  )
const changed = (before, after) =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((path) => before[path] !== after[path])
    .sort()
const cleanText = (value) =>
  String(value)
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]')
    .replace(
      /((?:authorization|api[_-]?key|secret|password|access[_-]?token|service[_-]?role[_-]?key)\s*[=:]\s*)[^\s,}]+/gi,
      '$1[REDACTED]',
    )
    .replace(/\b(?:sb_secret_|sk_live_|ghp_|github_pat_)[A-Za-z0-9_-]+/g, '[REDACTED_SECRET]')
const textList = (value, label) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim()))
    fail(`${label} phải là mảng chuỗi.`)
  return value.map(cleanText)
}
const sanitize = (value) => {
  if (typeof value === 'string') return cleanText(value)
  if (Array.isArray(value)) return value.map(sanitize)
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item)]))
  return value
}
const registry = () =>
  existsSync(resolve(root, registryPath)) ? json(registryPath) : { version: 1, tasks: {} }
const index = (state) => {
  const rows = Object.values(state.tasks)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(
      (task) =>
        `| ${task.id} | ${task.agent} | ${task.status} | ${task.updatedAt} | ${task.latestReport ? `[Báo cáo](${task.latestReport.replace(`${home}/`, '')})` : 'Đang thực hiện'} |`,
    )
  save(
    `${home}/STATUS.md`,
    '# Tiến độ task giữa Codex và Claude\n\n' +
      'Sinh bằng `npm run task:start` / `npm run task:finish`. Không sửa tay bảng này. ' +
      'Tiến độ có trước pipeline: [PROJECT_PROGRESS.md](PROJECT_PROGRESS.md). ' +
      '`validated_local` còn cần review, mobile và staging theo Definition of Done.\n\n' +
      '| Task | Agent | Trạng thái | Cập nhật (UTC) | Báo cáo |\n| --- | --- | --- | --- | --- |\n' +
      rows.join('\n') +
      '\n',
  )
}
const allowedIds = () =>
  [...read(planPath).matchAll(/^## ([A-Z]+-\d{3})\s/gm)].map((match) => match[1])
const requireId = () => {
  if (!allowedIds().includes(id))
    fail('Task ID phải có trong implementation plan (một task mỗi lần).')
}
const reportFiles = () =>
  existsSync(resolve(root, `${home}/reports`))
    ? readdirSync(resolve(root, `${home}/reports`))
        .filter((path) => path.endsWith('.json'))
        .map((path) => `${home}/reports/${path}`)
    : []

// Fixed commands, no user-supplied shell commands. DB operations are LOCAL only.
const validationCommands = [
  ['pipeline', ['run', 'test:pipeline']],
  ['lint', ['run', 'lint']],
  ['typecheck', ['run', 'typecheck']],
  ['tests', ['test']],
  ['build', ['run', 'build']],
  ['format', ['run', 'format:check']],
  ['env', ['run', 'check:env']],
  ['db reset', ['exec', '--', 'supabase', 'db', 'reset', '--local']],
  ['pgTAP', ['run', 'test:db']],
  ['integration', ['run', 'test:integration']],
]
const runNpm = (npmArgs) => {
  // npm_execpath is npm-cli.js when invoked through an npm script (also works on Windows).
  const cli = process.env.npm_execpath
  if (!cli) fail('Chạy qua npm run task:finish để dùng npm CLI không qua shell.')
  const timeoutMs = Number(process.env.CHB_VALIDATION_TIMEOUT_MS ?? 600_000)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000)
    fail('Invalid validation timeout.')
  return spawnSync(process.execPath, [cli, ...npmArgs], {
    cwd: root,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1' },
  })
}

function start() {
  requireId()
  const agent = hasOption('--agent') ? option('--agent') : args[0]
  const title = hasOption('--title') ? option('--title') : args.slice(1).join(' ')
  if (!['codex', 'claude'].includes(agent) || !title?.trim())
    fail('Cần --agent codex|claude và --title.')
  const state = registry()
  if (Object.values(state.tasks).some((task) => task.status === 'in_progress'))
    fail('Đã có task đang thực hiện; kết thúc task đó trước.')
  const now = new Date().toISOString()
  state.tasks[id] = {
    id,
    title: cleanText(title),
    agent,
    status: 'in_progress',
    startedAt: now,
    updatedAt: now,
    baseCommit: git('rev-parse', 'HEAD'),
    branch: git('branch', '--show-current'),
    preExistingChanges: [
      ...new Set([
        ...git('diff', '--name-only', 'HEAD', '-z').split('\0'),
        ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0'),
      ]),
    ]
      .filter(Boolean)
      .sort(),
    baseline: snapshot(),
    latestReport: state.tasks[id]?.latestReport ?? null,
  }
  save(registryPath, state)
  index(state)
  console.log(`${id}: in_progress (${agent}). Điền summary theo docs/handoff/summary.example.json.`)
}

function finish() {
  requireId()
  const state = registry()
  const task = state.tasks[id]
  if (!task || task.status !== 'in_progress') fail('Chạy task:start cho task này trước.')
  const summaryFile = hasOption('--summary-file') ? option('--summary-file') : args[0]
  if (!summaryFile) fail('Cần đường dẫn summary JSON.')
  const summary = json(summaryFile)
  for (const key of ['implemented', 'database', 'tests', 'notes', 'nextTasks'])
    summary[key] = textList(summary[key], key)
  if (!summary.implemented.length || !summary.database.length || !summary.tests.length)
    fail('Implemented, database, tests phải có nội dung (ghi none/not run nếu phù hợp).')
  if (
    !Array.isArray(summary.acceptance) ||
    !summary.acceptance.length ||
    summary.acceptance.some(
      (criterion) =>
        !criterion.description?.trim() ||
        !['met', 'unmet', 'not_verified'].includes(criterion.status) ||
        !criterion.evidence?.trim(),
    )
  )
    fail('Acceptance cần description, status met|unmet|not_verified và evidence cho từng tiêu chí.')
  if (!summary.mobile?.trim() || !summary.staging?.trim() || !summary.review?.trim())
    fail('Ghi rõ mobile, staging, review; chưa chạy ghi not verified + lý do.')
  const runId = `${id}-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const checks = []
  let dbReady = false
  const sourceBefore = snapshot()
  let dbLifetimeUncertain = false
  let releaseDbLock
  try {
    for (const [name, command] of validationCommands) {
      const display = `npm ${command.join(' ')}`
      if (name === 'db reset') {
        if (process.env.CHB_DB_VALIDATION_BLOCKER) {
          checks.push({
            name,
            command: display,
            status: 'not_run',
            reason: cleanText(process.env.CHB_DB_VALIDATION_BLOCKER).slice(0, 1200),
          })
          continue
        }
        try {
          releaseDbLock = acquireDbValidationLock(process.env.CHB_DB_LOCK_PATH, {
            timeoutMs: Number(process.env.CHB_DB_LOCK_TIMEOUT_MS ?? 1_200_000),
          })
        } catch (error) {
          checks.push({
            name: 'db validation slot',
            command: 'exclusive local DB lease',
            status: 'fail',
            reason: cleanText(error.message),
          })
          checks.push({
            name,
            command: display,
            status: 'not_run',
            reason: 'Local DB lease unavailable; reset was not run.',
          })
          continue
        }
      }
      if (['pgTAP', 'integration'].includes(name) && !dbReady) {
        checks.push({
          name,
          command: display,
          status: 'not_run',
          reason: 'Local DB reset chưa đạt; không chạy trên DB chưa xác minh.',
        })
        continue
      }
      console.log(`[${id}] ${display}`)
      const began = Date.now()
      const result = runNpm(command)
      const log = cleanText(
        `${result.stdout ?? ''}\n${result.stderr ?? ''}\n${result.error?.message ?? ''}`,
      )
      const path = `tmp/task-logs/${runId}/${name.replace(/\s/g, '-')}.log`
      save(path, log)
      if (
        ['db reset', 'pgTAP', 'integration'].includes(name) &&
        (result.error || result.signal || result.status === null)
      ) {
        dbLifetimeUncertain = true
        dbReady = false
      }
      const status = result.status === 0 && !result.error ? 'pass' : 'fail'
      checks.push({
        name,
        command: display,
        status,
        exitCode: result.status,
        durationMs: Date.now() - began,
        log: path,
        reason: status === 'fail' ? log.trim().slice(-1200) : null,
      })
      console.log(`[${id}] ${name}: ${status}`)
      if (name === 'db reset') dbReady = status === 'pass'
    }
  } finally {
    try {
      if (releaseDbLock && dbLifetimeUncertain) {
        checks.push({
          name: 'db lease retained',
          command: 'retain validation lease until reviewed descendant recovery',
          status: 'fail',
          reason:
            'Validation timeout/error leaves descendant lifetime uncertain. Lease retained; do not retry DB until all descendants are proven stopped.',
        })
      } else releaseDbLock?.()
    } catch (error) {
      checks.push({
        name: 'db lease release',
        command: 'release owned local DB lease',
        status: 'fail',
        reason: cleanText(error.message),
      })
    }
  }
  const source = snapshot()
  const mutated = changed(sourceBefore, source)
  if (mutated.length)
    checks.push({
      name: 'source stability',
      command: 'SHA-256 snapshot before/after checks',
      status: 'fail',
      reason: mutated.join(', '),
    })
  const allPassed = checks.every((check) => check.status === 'pass')
  const status =
    allPassed && summary.acceptance.every((criterion) => criterion.status === 'met')
      ? 'validated_local'
      : 'needs_validation'
  const record = {
    version: 1,
    runId,
    taskId: id,
    title: task.title,
    agent: task.agent,
    status,
    startedAt: task.startedAt,
    finishedAt: new Date().toISOString(),
    baseCommit: task.baseCommit,
    checkedHead: git('rev-parse', 'HEAD'),
    branch: git('branch', '--show-current'),
    filesChanged: changed(task.baseline, source),
    source,
    sourceDigest: hash(JSON.stringify(source)),
    preExistingChanges: task.preExistingChanges,
    summary: sanitize(summary),
    checks,
  }
  const reportPath = `${home}/reports/${runId}`
  save(`${reportPath}.json`, record)
  const bullets = (items) => items.map((item) => `- ${item}`).join('\n') || '- none'
  save(
    `${reportPath}.md`,
    `# Task: ${id}\n\nAgent: ${task.agent} · Status: ${status}\n\n` +
      `Branch: ${record.branch} · Checked HEAD: ${record.checkedHead}\n\n` +
      `Started: ${record.startedAt} · Finished: ${record.finishedAt} (UTC)\n\n` +
      `## Implemented\n\n${bullets(summary.implemented)}\n\n## Files changed\n\n${bullets(record.filesChanged)}\n\n` +
      `## Changes already present at task:start\n\n${bullets(record.preExistingChanges)}\n\nThese paths are context; the pipeline does not assign authorship.\n\n` +
      `## Database\n\n${bullets(summary.database)}\n\n## Tests\n\n${bullets(summary.tests)}\n\n` +
      '## Acceptance\n\n' +
      summary.acceptance.map((c) => `- ${c.status}: ${c.description} — ${c.evidence}`).join('\n') +
      '\n\n' +
      '## Validation\n\n| Check | Result | Command |\n| --- | --- | --- |\n' +
      checks.map((c) => `| ${c.name} | ${c.status} | \`${c.command}\` |`).join('\n') +
      '\n\n' +
      checks
        .filter((c) => c.reason)
        .map((c) => `- ${c.name}: ${c.reason.replace(/\n/g, ' ')}`)
        .join('\n') +
      '\n\n' +
      `## Notes / risks\n\n${bullets(summary.notes)}\n\nMobile: ${summary.mobile}\n\nStaging: ${summary.staging}\n\nReview: ${summary.review}\n\n` +
      `## Next tasks\n\n${bullets(summary.nextTasks)}\n\n` +
      'Full sanitized command logs: `tmp/task-logs/` (ignored; do not commit logs or secrets). ' +
      'Machine-readable evidence: JSON beside this report. Local checks do not certify staging/UAT or completion.\n',
  )
  state.tasks[id] = {
    ...task,
    status,
    updatedAt: record.finishedAt,
    latestReport: `${reportPath}.md`,
  }
  delete state.tasks[id].baseline
  save(registryPath, state)
  index(state)
  console.log(`Báo cáo: ${reportPath}.md (${status})`)
  if (status !== 'validated_local') process.exitCode = 1
}

function verify() {
  const state = registry()
  const reports = reportFiles().map((path) => ({ path, record: json(path) }))
  for (const { path, record } of reports) {
    if (
      !allowedIds().includes(record.taskId) ||
      record.sourceDigest !== hash(JSON.stringify(record.source))
    )
      fail(`Báo cáo sai định dạng: ${path}`)
    if (!['needs_validation', 'validated_local'].includes(record.status))
      fail(`Trạng thái không hợp lệ: ${path}`)
    if (
      record.status === 'validated_local' &&
      (record.checks.some((c) => c.status !== 'pass') ||
        validationCommands.some(
          ([name]) => !record.checks.some((c) => c.name === name && c.status === 'pass'),
        ) ||
        !record.summary.acceptance.length ||
        record.summary.acceptance.some((c) => c.status !== 'met'))
    )
      fail(`Báo cáo khai pass sai: ${path}`)
    if (!existsSync(resolve(root, path.replace(/\.json$/, '.md'))))
      fail(`Thiếu báo cáo Markdown: ${path}`)
  }
  for (const task of Object.values(state.tasks)) {
    if (task.latestReport && !existsSync(resolve(root, task.latestReport)))
      fail(`Thiếu báo cáo cho ${task.id}.`)
  }
  // --base REF is used by PR CI to require fresh evidence for the exact proposed source tree.
  // Without it this command checks report integrity, including honest failed attempts.
  if (id) {
    const base = id === '--base' ? process.argv[4] : id
    if (!base || base.startsWith('-')) fail('Cần base ref hợp lệ.')
    const mergeBase = git('merge-base', base, 'HEAD')
    const diff = git('diff', '--name-only', '-z', mergeBase, 'HEAD').split('\0').filter(Boolean)
    const codeChanges = diff.filter(governed)
    if (codeChanges.length) {
      const now = snapshot()
      const digest = hash(JSON.stringify(now))
      const fresh = reports.filter(({ path }) => diff.includes(path))
      if (
        !fresh.some(
          ({ record }) => record.status === 'validated_local' && record.sourceDigest === digest,
        )
      )
        fail(
          'PR thay đổi code nhưng thiếu báo cáo mới validated_local khớp source hiện tại. Chạy task:start/task:finish, commit báo cáo cùng code.',
        )
      if (Object.values(state.tasks).some((task) => task.status === 'in_progress'))
        fail('PR còn task in_progress.')
    }
  }
  console.log(
    `OK: ${reports.length} báo cáo hợp lệ. ${id ? 'PR evidence đã kiểm tra.' : 'Chưa kiểm tra PR/source freshness (cần base ref).'} `,
  )
}

try {
  if (action === 'start') start()
  else if (action === 'finish') finish()
  else if (action === 'verify') verify()
  else if (action === 'status') console.log(read(`${home}/STATUS.md`))
  else
    fail(
      'Dùng npm run task:start|task:finish|task:verify|task:status (xem docs/handoff/WORKFLOW.md).',
    )
} catch (error) {
  console.error(cleanText(error.message))
  process.exitCode = 1
}
