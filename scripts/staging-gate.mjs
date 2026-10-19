// Staging deploy gate (INF-008 / RV-10).
//
// Decides whether `.github/workflows/staging.yml` may push migrations to staging.
// Rule: only the exact commit that is currently the tip of `develop`, and only after the
// required jobs of the `CI` workflow ran for that same commit and succeeded.
// Anything missing, stale, from another branch/repository or not provably green fails closed.
//
// The decision is taken twice: once before the approval-protected deploy job (the first run
// records which CI attempt it verified) and again, with the same inputs, AFTER the environment
// approval and right before each privileged migration command (`GATE_RECHECK=true`). A human
// approval can take hours: in the meantime develop may have advanced or CI may have been re-run,
// so the recheck denies when the develop tip OR the newest CI attempt is no longer the verified one.
//
// The decision (`evaluateStagingGate`) is pure and unit tested. The CLI at the bottom only
// runs inside GitHub Actions: it reads the run context from environment variables, queries the
// GitHub REST API with the workflow's read-only GITHUB_TOKEN and writes `sha`/`verified` to
// GITHUB_OUTPUT. It never receives staging secrets.
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const STAGING_BRANCH = 'develop'
export const CI_WORKFLOW_FILE = 'ci.yml'
export const CI_WORKFLOW_PATH = `.github/workflows/${CI_WORKFLOW_FILE}`
export const CI_WORKFLOW_NAME = 'CI'
export const REQUIRED_CI_JOBS = Object.freeze(['app', 'database'])
export const ALLOWED_EVENTS = Object.freeze(['push', 'workflow_dispatch'])

const SHA_PATTERN = /^[0-9a-f]{40}$/

const deploy = (sha, ciRunKey) => ({
  decision: 'deploy',
  reason: 'CI is green for this develop commit',
  sha,
  ciRunKey,
})
const wait = (reason) => ({ decision: 'wait', reason })
const deny = (reason) => ({ decision: 'deny', reason })

// CI runs that count as evidence for `sha`: same workflow file, push event on develop, same
// commit and same repository (fork or pull_request runs never qualify).
export function candidateCiRuns(runs, { sha, repository }) {
  if (!Array.isArray(runs)) return []
  return runs.filter(
    (run) =>
      run &&
      run.path === CI_WORKFLOW_PATH &&
      run.name === CI_WORKFLOW_NAME &&
      run.event === 'push' &&
      run.head_branch === STAGING_BRANCH &&
      run.head_sha === sha &&
      run.head_repository?.full_name === repository &&
      run.repository?.full_name === repository,
  )
}

// Identity of one CI attempt: the same run id with a re-run gets a new attempt number, a new run
// gets a new id and run number, so any re-run changes the key.
export function ciRunKey(run) {
  return `${run.id}:${run.run_number ?? 0}:${run.run_attempt ?? 1}`
}

// Newest run wins (a re-run of the same commit supersedes the earlier attempt).
export function selectLatestCiRun(runs, context) {
  const candidates = candidateCiRuns(runs, context)
  if (candidates.length === 0) return null
  return candidates.reduce((latest, run) => {
    const a = [latest.run_number ?? 0, latest.run_attempt ?? 1]
    const b = [run.run_number ?? 0, run.run_attempt ?? 1]
    return b[0] > a[0] || (b[0] === a[0] && b[1] > a[1]) ? run : latest
  })
}

/**
 * @param {object} input
 * @param {string} input.eventName   GITHUB_EVENT_NAME of the staging run
 * @param {string} input.ref         GITHUB_REF of the staging run
 * @param {string} input.sha         GITHUB_SHA of the staging run (the commit to deploy)
 * @param {string} input.repository  GITHUB_REPOSITORY (owner/name)
 * @param {string} input.developHeadSha  current tip of develop, fetched just now
 * @param {object[]} input.runs      workflow runs of ci.yml returned by the API for `sha`
 * @param {Record<string, object[]>} input.jobsByRunId  jobs of the selected run, keyed by run id
 * @param {{sha: string, ciRunKey: string}} [input.expected]  recheck after approval: the commit and
 *        CI attempt the first gate verified; any difference is a denial
 * @returns {{decision: 'deploy'|'wait'|'deny', reason: string, sha?: string}}
 */
export function evaluateStagingGate(input) {
  const { eventName, ref, sha, repository, developHeadSha, runs, jobsByRunId, expected } =
    input ?? {}

  if (!ALLOWED_EVENTS.includes(eventName))
    return deny(`event "${eventName}" may not deploy staging`)
  if (ref !== `refs/heads/${STAGING_BRANCH}`) {
    return deny(`ref "${ref}" is not ${STAGING_BRANCH}; staging only deploys ${STAGING_BRANCH}`)
  }
  if (typeof sha !== 'string' || !SHA_PATTERN.test(sha))
    return deny('commit SHA is missing or malformed')
  if (typeof repository !== 'string' || !repository.includes('/')) {
    return deny('repository is missing or malformed')
  }
  if (typeof developHeadSha !== 'string' || !SHA_PATTERN.test(developHeadSha)) {
    return deny('could not determine the current develop tip')
  }
  if (developHeadSha !== sha) {
    return deny(`stale: ${sha} is no longer the tip of ${STAGING_BRANCH} (${developHeadSha})`)
  }
  if (expected !== undefined) {
    if (typeof expected?.sha !== 'string' || typeof expected?.ciRunKey !== 'string') {
      return deny('recheck is missing the verified commit or CI attempt')
    }
    if (expected.sha !== sha) {
      return deny(`changed: verified ${expected.sha} but this run is for ${sha}`)
    }
  }

  const run = selectLatestCiRun(runs, { sha, repository })
  if (!run) return wait(`no ${CI_WORKFLOW_NAME} push run found yet for ${sha}`)
  if (expected !== undefined && ciRunKey(run) !== expected.ciRunKey) {
    return deny(
      `changed: the newest ${CI_WORKFLOW_NAME} attempt is ${ciRunKey(run)}, not the verified ${expected.ciRunKey}`,
    )
  }
  if (run.status !== 'completed') return wait(`${CI_WORKFLOW_NAME} run ${run.id} is ${run.status}`)
  if (run.conclusion !== 'success') {
    return deny(`${CI_WORKFLOW_NAME} run ${run.id} concluded "${run.conclusion}"`)
  }

  const jobs = jobsByRunId?.[String(run.id)] ?? jobsByRunId?.[run.id]
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return deny(`jobs of ${CI_WORKFLOW_NAME} run ${run.id} are unavailable; cannot verify`)
  }
  for (const name of REQUIRED_CI_JOBS) {
    const matching = jobs.filter((job) => job?.name === name)
    if (matching.length === 0)
      return deny(`required CI job "${name}" is missing from run ${run.id}`)
    const bad = matching.find((job) => job.status !== 'completed' || job.conclusion !== 'success')
    if (bad) {
      return deny(`required CI job "${name}" is ${bad.status}/${bad.conclusion ?? 'no conclusion'}`)
    }
  }
  return deploy(sha, ciRunKey(run))
}

/**
 * Poll until the decision is terminal. `wait` decisions are retried until `waitMs` elapsed and
 * then become a denial (missing/unfinished CI never deploys).
 */
export async function runGate({
  context,
  fetchState,
  sleep,
  now = Date.now,
  waitMs,
  pollMs = 30_000,
}) {
  const deadline = now() + waitMs
  for (;;) {
    const state = await fetchState(context)
    const result = evaluateStagingGate({ ...context, ...state })
    if (result.decision !== 'wait') return result
    if (now() + pollMs > deadline) {
      return deny(`timed out waiting for CI: ${result.reason}`)
    }
    await sleep(pollMs)
  }
}

async function githubGet(path, { apiUrl, token }) {
  const response = await fetch(`${apiUrl}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`GitHub API ${path} returned ${response.status}`)
  return response.json()
}

export function createFetchState({ apiUrl, token }) {
  return async ({ repository, sha }) => {
    const api = (path) => githubGet(path, { apiUrl, token })
    const head = await api(`/repos/${repository}/git/ref/heads/${STAGING_BRANCH}`)
    const runList = await api(
      `/repos/${repository}/actions/workflows/${CI_WORKFLOW_FILE}/runs` +
        `?head_sha=${sha}&branch=${STAGING_BRANCH}&event=push&per_page=100`,
    )
    const runs = runList.workflow_runs ?? []
    const jobsByRunId = {}
    const latest = selectLatestCiRun(runs, { sha, repository })
    if (latest && latest.status === 'completed') {
      const jobList = await api(
        `/repos/${repository}/actions/runs/${latest.id}/jobs?filter=latest&per_page=100`,
      )
      jobsByRunId[String(latest.id)] = jobList.jobs ?? []
    }
    return { developHeadSha: head.object?.sha, runs, jobsByRunId }
  }
}

/**
 * Reads the run context from the environment. `GATE_RECHECK=true` is the post-approval recheck: it
 * never waits (an unfinished CI run is a denial) and needs the commit and CI attempt that the first
 * gate verified. Throws on any inconsistency so the CLI fails closed.
 */
export function parseGateEnv(env) {
  const context = {
    eventName: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF,
    sha: env.GITHUB_SHA,
    repository: env.GITHUB_REPOSITORY,
  }
  const recheck = env.GATE_RECHECK === 'true'
  if (
    env.GATE_RECHECK !== undefined &&
    env.GATE_RECHECK !== '' &&
    !['true', 'false'].includes(env.GATE_RECHECK)
  ) {
    throw new Error('GATE_RECHECK is invalid')
  }
  let waitSeconds = Number.parseInt(env.GATE_WAIT_SECONDS ?? '0', 10)
  if (!Number.isFinite(waitSeconds) || waitSeconds < 0)
    throw new Error('GATE_WAIT_SECONDS is invalid')
  let expected
  if (recheck) {
    waitSeconds = 0
    const expectedSha = env.GATE_EXPECT_SHA
    const expectedRun = env.GATE_EXPECT_CI_RUN
    if (typeof expectedSha !== 'string' || !SHA_PATTERN.test(expectedSha) || !expectedRun) {
      throw new Error('recheck requires GATE_EXPECT_SHA and GATE_EXPECT_CI_RUN from the first gate')
    }
    expected = { sha: expectedSha, ciRunKey: expectedRun }
  }
  return { context: { ...context, ...(expected ? { expected } : {}) }, waitSeconds, recheck }
}

async function main(env = process.env) {
  const token = env.GITHUB_TOKEN
  if (!token) throw new Error('GITHUB_TOKEN is required')
  const { context, waitSeconds, recheck } = parseGateEnv(env)

  const result = await runGate({
    context,
    fetchState: createFetchState({ apiUrl: env.GITHUB_API_URL ?? 'https://api.github.com', token }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    waitMs: waitSeconds * 1000,
  })
  console.log(
    `staging gate${recheck ? ' (recheck after approval)' : ''}: ${result.decision} - ${result.reason}`,
  )
  if (result.decision !== 'deploy') process.exit(1)
  if (!env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required')
  appendFileSync(
    env.GITHUB_OUTPUT,
    `sha=${result.sha}
ci_run=${result.ciRunKey}
verified=true
`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Fail closed on any unexpected error (API outage, bad config).
    console.error(`staging gate: deny - ${error.message}`)
    process.exit(1)
  })
}
