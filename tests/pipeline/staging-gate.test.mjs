import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import {
  CI_WORKFLOW_PATH,
  REQUIRED_CI_JOBS,
  ciRunKey,
  evaluateStagingGate,
  parseGateEnv,
  runGate,
  selectLatestCiRun,
} from '../../scripts/staging-gate.mjs'

const REPO = 'owner/chb-tet-2027'
const SHA = 'a'.repeat(40)
const OTHER_SHA = 'b'.repeat(40)

function ciRun(overrides = {}) {
  return {
    id: 100,
    name: 'CI',
    path: CI_WORKFLOW_PATH,
    event: 'push',
    head_branch: 'develop',
    head_sha: SHA,
    head_repository: { full_name: REPO },
    repository: { full_name: REPO },
    status: 'completed',
    conclusion: 'success',
    run_number: 7,
    run_attempt: 1,
    ...overrides,
  }
}

const greenJobs = () =>
  REQUIRED_CI_JOBS.map((name) => ({ name, status: 'completed', conclusion: 'success' }))

function input(overrides = {}) {
  return {
    eventName: 'push',
    ref: 'refs/heads/develop',
    sha: SHA,
    repository: REPO,
    developHeadSha: SHA,
    runs: [ciRun()],
    jobsByRunId: { 100: greenJobs() },
    ...overrides,
  }
}

const decide = (overrides) => evaluateStagingGate(input(overrides))

test('push and manual dispatch both deploy when CI is green for the develop tip', () => {
  for (const eventName of ['push', 'workflow_dispatch']) {
    const result = decide({ eventName })
    assert.equal(result.decision, 'deploy', eventName)
    assert.equal(result.sha, SHA)
  }
})

test('required CI jobs match the real CI workflow so the gate cannot drift', () => {
  const ci = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8')
  assert.match(ci, /^name: CI$/m)
  const jobs = [...ci.slice(ci.indexOf('\njobs:')).matchAll(/^ {2}([a-z][\w-]*):\s*$/gm)].map(
    (m) => m[1],
  )
  assert.deepEqual([...REQUIRED_CI_JOBS].sort(), [...jobs].sort())
})

test('missing CI run waits and is never a deploy', () => {
  assert.equal(decide({ runs: [] }).decision, 'wait')
  assert.equal(decide({ runs: undefined }).decision, 'wait')
})

test('CI run for a different SHA is not evidence', () => {
  const result = decide({ runs: [ciRun({ head_sha: OTHER_SHA })] })
  assert.equal(result.decision, 'wait')
})

test('unfinished CI waits, failed or cancelled CI is denied', () => {
  assert.equal(
    decide({ runs: [ciRun({ status: 'in_progress', conclusion: null })] }).decision,
    'wait',
  )
  assert.equal(decide({ runs: [ciRun({ status: 'queued', conclusion: null })] }).decision, 'wait')
  for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out', 'neutral', null]) {
    assert.equal(decide({ runs: [ciRun({ conclusion })] }).decision, 'deny', String(conclusion))
  }
})

test('a green run is still denied when a required job is failed, skipped, or missing', () => {
  for (const name of REQUIRED_CI_JOBS) {
    for (const conclusion of ['failure', 'skipped', 'cancelled', null]) {
      const jobs = greenJobs().map((job) => (job.name === name ? { ...job, conclusion } : job))
      assert.equal(decide({ jobsByRunId: { 100: jobs } }).decision, 'deny', `${name}/${conclusion}`)
    }
    const without = greenJobs().filter((job) => job.name !== name)
    assert.equal(decide({ jobsByRunId: { 100: without } }).decision, 'deny', `missing ${name}`)
  }
})

test('unavailable job data fails closed', () => {
  assert.equal(decide({ jobsByRunId: {} }).decision, 'deny')
  assert.equal(decide({ jobsByRunId: { 100: [] } }).decision, 'deny')
  assert.equal(decide({ jobsByRunId: undefined }).decision, 'deny')
})

test('stale commit (develop moved on) is denied, including for manual runs', () => {
  for (const eventName of ['push', 'workflow_dispatch']) {
    const result = decide({ eventName, developHeadSha: OTHER_SHA })
    assert.equal(result.decision, 'deny', eventName)
    assert.match(result.reason, /stale/)
  }
  assert.equal(decide({ developHeadSha: undefined }).decision, 'deny')
})

test('wrong branch is denied, including a manual dispatch from another branch', () => {
  for (const ref of [
    'refs/heads/main',
    'refs/heads/feature/x',
    'refs/pull/1/merge',
    'refs/tags/v1',
    'develop',
  ]) {
    assert.equal(decide({ ref }).decision, 'deny', ref)
    assert.equal(
      decide({ ref, eventName: 'workflow_dispatch' }).decision,
      'deny',
      `dispatch ${ref}`,
    )
  }
})

test('pull request style events are denied', () => {
  for (const eventName of [
    'pull_request',
    'pull_request_target',
    'workflow_run',
    'schedule',
    undefined,
  ]) {
    assert.equal(decide({ eventName }).decision, 'deny', String(eventName))
  }
})

test('malformed SHA or repository is denied', () => {
  for (const sha of [undefined, '', 'abc123', 'A'.repeat(40), `${SHA}0`]) {
    assert.equal(decide({ sha }).decision, 'deny', String(sha))
  }
  assert.equal(decide({ repository: undefined }).decision, 'deny')
  assert.equal(decide({ repository: 'no-slash' }).decision, 'deny')
})

test('runs from forks, pull requests, other branches or other workflows are ignored', () => {
  const untrusted = [
    ciRun({ head_repository: { full_name: 'attacker/chb-tet-2027' } }),
    ciRun({ repository: { full_name: 'attacker/chb-tet-2027' } }),
    ciRun({ head_repository: undefined }),
    ciRun({ event: 'pull_request' }),
    ciRun({ event: 'workflow_dispatch' }),
    ciRun({ head_branch: 'feature/x' }),
    ciRun({ path: '.github/workflows/other.yml' }),
    ciRun({ name: 'Not CI' }),
  ]
  for (const run of untrusted) {
    assert.equal(decide({ runs: [run] }).decision, 'wait', JSON.stringify(run))
  }
})

test('an untrusted green run cannot hide a failed trusted run', () => {
  const forgedGreen = ciRun({
    id: 999,
    run_number: 99,
    head_repository: { full_name: 'attacker/x' },
  })
  const realRed = ciRun({ id: 100, conclusion: 'failure' })
  assert.equal(
    decide({ runs: [forgedGreen, realRed], jobsByRunId: { 999: greenJobs() } }).decision,
    'deny',
  )
})

test('the newest attempt decides: a green re-run supersedes a red one and not the reverse', () => {
  const red = ciRun({ id: 100, run_number: 7, conclusion: 'failure' })
  const green = ciRun({ id: 101, run_number: 8 })
  assert.equal(selectLatestCiRun([red, green], { sha: SHA, repository: REPO }).id, 101)
  assert.equal(decide({ runs: [red, green], jobsByRunId: { 101: greenJobs() } }).decision, 'deploy')
  const redAgain = ciRun({ id: 102, run_number: 8, run_attempt: 2, conclusion: 'failure' })
  assert.equal(
    decide({ runs: [red, green, redAgain], jobsByRunId: { 101: greenJobs() } }).decision,
    'deny',
  )
})

function gateHarness({ states, waitMs, pollMs = 1000, context }) {
  let clock = 0
  const sleeps = []
  let call = 0
  return {
    sleeps,
    run: () =>
      runGate({
        context: context ?? {
          eventName: 'push',
          ref: 'refs/heads/develop',
          sha: SHA,
          repository: REPO,
        },
        fetchState: async () => {
          const state = states[Math.min(call, states.length - 1)]
          call += 1
          if (state instanceof Error) throw state
          return state
        },
        sleep: async (ms) => {
          sleeps.push(ms)
          clock += ms
        },
        now: () => clock,
        waitMs: waitMs,
        pollMs,
      }),
  }
}

const green = { developHeadSha: SHA, runs: [ciRun()], jobsByRunId: { 100: greenJobs() } }
const pending = { developHeadSha: SHA, runs: [], jobsByRunId: {} }

test('push path waits for CI to appear and finish, then deploys', async () => {
  const running = {
    developHeadSha: SHA,
    runs: [ciRun({ status: 'in_progress', conclusion: null })],
    jobsByRunId: {},
  }
  const harness = gateHarness({ states: [pending, running, green], waitMs: 10_000 })
  const result = await harness.run()
  assert.equal(result.decision, 'deploy')
  assert.equal(harness.sleeps.length, 2)
})

test('CI that never shows up before the deadline is denied', async () => {
  const harness = gateHarness({ states: [pending], waitMs: 3_000 })
  const result = await harness.run()
  assert.equal(result.decision, 'deny')
  assert.match(result.reason, /timed out/)
})

test('manual path does not wait: missing CI is denied immediately', async () => {
  const harness = gateHarness({ states: [pending, green], waitMs: 0 })
  const result = await harness.run()
  assert.equal(result.decision, 'deny')
  assert.equal(harness.sleeps.length, 0)
})

test('a failed CI run stops the wait at once', async () => {
  const red = { developHeadSha: SHA, runs: [ciRun({ conclusion: 'failure' })], jobsByRunId: {} }
  const harness = gateHarness({ states: [red, green], waitMs: 60_000 })
  assert.equal((await harness.run()).decision, 'deny')
  assert.equal(harness.sleeps.length, 0)
})

test('develop moving while waiting makes the run stale and denies it', async () => {
  const moved = { developHeadSha: OTHER_SHA, runs: [], jobsByRunId: {} }
  const harness = gateHarness({ states: [pending, moved, green], waitMs: 60_000 })
  assert.equal((await harness.run()).decision, 'deny')
})

test('API errors propagate so the CLI fails closed', async () => {
  const harness = gateHarness({ states: [new Error('GitHub API returned 500')], waitMs: 60_000 })
  await assert.rejects(harness.run, /500/)
})

// --- workflow structure -------------------------------------------------------------------

// Comment lines are documentation; assertions look at the executable YAML only.
const staging = readFileSync(resolve('.github/workflows/staging.yml'), 'utf8')
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n')
const gateStart = staging.indexOf('\n  gate:')
const pushStart = staging.indexOf('\n  db-push:')
const gateSection = staging.slice(gateStart, pushStart)
const pushSection = staging.slice(pushStart)

test('staging workflow is triggered only by develop pushes and an input-less manual dispatch', () => {
  const triggers = staging.slice(staging.indexOf('\non:'), staging.indexOf('\npermissions:'))
  assert.match(triggers, /push:\s*\n\s*branches: \[develop\]/)
  assert.match(triggers, /workflow_dispatch:\s*$/m)
  assert.doesNotMatch(triggers, /inputs:/)
  assert.doesNotMatch(staging, /pull_request|pull_request_target|workflow_run|head_ref|pull\//)
})

test('permissions are least-privilege and concurrency is preserved', () => {
  assert.match(staging, /^permissions: \{\}$/m)
  assert.doesNotMatch(staging, /: write/)
  assert.match(gateSection, /permissions:\s*\n\s*contents: read\s*\n\s*actions: read/)
  assert.match(pushSection, /permissions:\s*\n\s*contents: read/)
  assert.match(staging, /concurrency:\s*\n\s*group: staging-db\s*\n\s*cancel-in-progress: false/)
})

test('gate job holds no secrets or environment and refuses non-develop refs before checkout', () => {
  assert.doesNotMatch(gateSection, /secrets\./)
  assert.doesNotMatch(gateSection, /environment:/)
  assert.doesNotMatch(gateSection, /supabase/)
  assert.ok(gateSection.indexOf('refs/heads/develop') < gateSection.indexOf('actions/checkout'))
  assert.match(gateSection, /STAGING_CONFIGURED == 'true'/)
  assert.match(gateSection, /node scripts\/staging-gate\.mjs/)
  assert.match(gateSection, /persist-credentials: false/)
})

test('deploy job needs the gate, keeps the approval environment and checks out the verified SHA', () => {
  assert.match(pushSection, /needs: gate/)
  assert.match(pushSection, /needs\.gate\.outputs\.verified == 'true'/)
  assert.match(pushSection, /environment: staging/)
  assert.match(pushSection, /ref: \$\{\{ needs\.gate\.outputs\.sha \}\}/)
  assert.match(pushSection, /persist-credentials: false/)
  assert.match(pushSection, /git rev-parse HEAD/)
  assert.ok(pushSection.indexOf('actions/checkout') < pushSection.indexOf('npm ci'))
})

test('staging secrets appear only in the deploy job and never in job-wide env', () => {
  assert.doesNotMatch(staging.slice(0, pushStart), /secrets\./)
  assert.doesNotMatch(pushSection, /^ {4}env:/m)
  const secretLines = pushSection.split('\n').filter((line) => line.includes('secrets.'))
  assert.ok(secretLines.length > 0)
  // `npm ci` (third-party lifecycle scripts) must not see them.
  const npmCi = pushSection.indexOf('- run: npm ci')
  const firstSecret = pushSection.indexOf('secrets.')
  assert.ok(npmCi > -1 && npmCi < firstSecret)
  assert.doesNotMatch(pushSection, /--project-ref "\$\{\{/)
})

// --- recheck after the environment approval (review of INF-008, RV-10 follow-up) ------------

// What the first gate verified: this commit and this CI attempt.
const VERIFIED = Object.freeze({ sha: SHA, ciRunKey: ciRunKey(ciRun()) })
const recheckContext = (overrides = {}) => ({
  eventName: 'push',
  ref: 'refs/heads/develop',
  sha: SHA,
  repository: REPO,
  expected: VERIFIED,
  ...overrides,
})
// A recheck never waits: waitMs is 0, so an unfinished CI run is a denial at once.
const recheck = (states, overrides = {}) =>
  gateHarness({ states, waitMs: 0, context: recheckContext(overrides) }).run()

test('the first gate reports which CI attempt it verified', () => {
  const result = decide()
  assert.equal(result.decision, 'deploy')
  assert.equal(result.ciRunKey, '100:7:1')
  assert.equal(ciRunKey(ciRun({ run_attempt: undefined, run_number: undefined })), '100:0:1')
})

test('recheck after approval passes when the tip and the CI attempt are unchanged', async () => {
  for (const eventName of ['push', 'workflow_dispatch']) {
    const result = await recheck([green], { eventName })
    assert.equal(result.decision, 'deploy', eventName)
    assert.equal(result.ciRunKey, VERIFIED.ciRunKey)
  }
})

test('approval delay: develop advanced while the deployment waited for approval is denied', async () => {
  const advanced = { ...green, developHeadSha: OTHER_SHA }
  const result = await recheck([advanced])
  assert.equal(result.decision, 'deny')
  assert.match(result.reason, /stale/)
  // also for a manual run, although the old commit's CI is still green
  const manual = await recheck([advanced], { eventName: 'workflow_dispatch' })
  assert.equal(manual.decision, 'deny')
})

test('a newer CI attempt of the same commit denies even when it is green', async () => {
  const states = [
    // a new run for the same commit
    {
      developHeadSha: SHA,
      runs: [ciRun(), ciRun({ id: 101, run_number: 8 })],
      jobsByRunId: { 101: greenJobs() },
    },
    // a re-run of the same workflow run: same id, next attempt
    { developHeadSha: SHA, runs: [ciRun({ run_attempt: 2 })], jobsByRunId: { 100: greenJobs() } },
  ]
  for (const state of states) {
    const result = await recheck([state])
    assert.equal(result.decision, 'deny', JSON.stringify(state.runs.map(ciRunKey)))
    assert.match(result.reason, /changed/)
  }
})

test('a newer CI attempt that failed, is running or is queued denies, without waiting', async () => {
  for (const newer of [
    ciRun({ id: 101, run_number: 8, conclusion: 'failure' }),
    ciRun({ id: 101, run_number: 8, status: 'in_progress', conclusion: null }),
    ciRun({ id: 101, run_number: 8, status: 'queued', conclusion: null }),
    ciRun({ run_attempt: 2, status: 'in_progress', conclusion: null }),
  ]) {
    const harness = gateHarness({
      states: [{ developHeadSha: SHA, runs: [ciRun(), newer], jobsByRunId: { 100: greenJobs() } }],
      waitMs: 0,
      context: recheckContext(),
    })
    const result = await harness.run()
    assert.equal(result.decision, 'deny')
    assert.equal(harness.sleeps.length, 0)
  }
})

test('the verified CI attempt turning red, missing or incomplete after approval is denied', async () => {
  const red = { developHeadSha: SHA, runs: [ciRun({ conclusion: 'failure' })], jobsByRunId: {} }
  const missing = { developHeadSha: SHA, runs: [], jobsByRunId: {} }
  const unfinished = {
    developHeadSha: SHA,
    runs: [ciRun({ status: 'in_progress', conclusion: null })],
    jobsByRunId: {},
  }
  const badJob = {
    developHeadSha: SHA,
    runs: [ciRun()],
    jobsByRunId: {
      100: greenJobs().map((job, i) => (i === 0 ? { ...job, conclusion: 'failure' } : job)),
    },
  }
  for (const state of [red, missing, unfinished, badJob]) {
    assert.equal((await recheck([state])).decision, 'deny')
  }
})

test('recheck is denied for another commit, a malformed expectation or an unreadable tip', async () => {
  const otherCommit = { sha: OTHER_SHA, ciRunKey: VERIFIED.ciRunKey }
  assert.equal((await recheck([green], { expected: otherCommit })).decision, 'deny')
  for (const expected of [{}, { sha: SHA }, { ciRunKey: VERIFIED.ciRunKey }, null]) {
    assert.equal((await recheck([green], { expected })).decision, 'deny', JSON.stringify(expected))
  }
  assert.equal((await recheck([{ ...green, developHeadSha: undefined }])).decision, 'deny')
  await assert.rejects(() => recheck([new Error('GitHub API returned 503')]), /503/)
})

test('without an expectation the first gate takes the newest attempt, as before', () => {
  const rerun = [ciRun(), ciRun({ id: 101, run_number: 8 })]
  assert.equal(decide({ runs: rerun, jobsByRunId: { 101: greenJobs() } }).decision, 'deploy')
})

test('recheck settings come from the first gate; missing or malformed values fail closed', () => {
  const base = {
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF: 'refs/heads/develop',
    GITHUB_SHA: SHA,
    GITHUB_REPOSITORY: REPO,
  }
  const first = parseGateEnv({ ...base, GATE_WAIT_SECONDS: '2700' })
  assert.equal(first.recheck, false)
  assert.equal(first.waitSeconds, 2700)
  assert.equal(first.context.expected, undefined)

  const second = parseGateEnv({
    ...base,
    GATE_RECHECK: 'true',
    GATE_WAIT_SECONDS: '2700', // ignored: a recheck never waits
    GATE_EXPECT_SHA: SHA,
    GATE_EXPECT_CI_RUN: '100:7:1',
  })
  assert.equal(second.recheck, true)
  assert.equal(second.waitSeconds, 0)
  assert.deepEqual(second.context.expected, { sha: SHA, ciRunKey: '100:7:1' })

  const recheckEnv = {
    ...base,
    GATE_RECHECK: 'true',
    GATE_EXPECT_SHA: SHA,
    GATE_EXPECT_CI_RUN: '1:1:1',
  }
  assert.throws(() => parseGateEnv({ ...recheckEnv, GATE_EXPECT_SHA: undefined }), /requires/)
  assert.throws(() => parseGateEnv({ ...recheckEnv, GATE_EXPECT_SHA: 'abc' }), /requires/)
  assert.throws(() => parseGateEnv({ ...recheckEnv, GATE_EXPECT_CI_RUN: '' }), /requires/)
  assert.throws(() => parseGateEnv({ ...recheckEnv, GATE_EXPECT_CI_RUN: undefined }), /requires/)
  assert.throws(() => parseGateEnv({ ...recheckEnv, GATE_RECHECK: 'yes' }), /GATE_RECHECK/)
  assert.throws(() => parseGateEnv({ ...base, GATE_WAIT_SECONDS: '-1' }), /GATE_WAIT_SECONDS/)
})

// The two recheck steps of the deploy job, as text blocks (comment lines are already removed).
const recheckSteps = pushSection
  .split('\n      - ')
  .filter((step) => step.startsWith('name: Recheck'))

test('the first gate exports the verified commit and CI attempt for the recheck', () => {
  assert.match(gateSection, /sha: \$\{\{ steps\.gate\.outputs\.sha \}\}/)
  assert.match(gateSection, /ci_run: \$\{\{ steps\.gate\.outputs\.ci_run \}\}/)
})

test('deploy job rechecks after approval: before linking and again before the writing command', () => {
  assert.equal(recheckSteps.length, 2, 'exactly two recheck steps')
  for (const step of recheckSteps) {
    assert.match(step, /GATE_RECHECK: 'true'/)
    assert.match(step, /GATE_EXPECT_SHA: \$\{\{ needs\.gate\.outputs\.sha \}\}/)
    assert.match(step, /GATE_EXPECT_CI_RUN: \$\{\{ needs\.gate\.outputs\.ci_run \}\}/)
    assert.match(step, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/)
    assert.match(step, /run: node scripts\/staging-gate\.mjs/)
    // the recheck holds the read-only token only, never a staging secret
    assert.doesNotMatch(step, /secrets\./)
  }
  const at = (needle) => pushSection.indexOf(needle)
  const [first, second] = recheckSteps.map((step) => pushSection.indexOf(step))
  assert.ok(at('- run: npm ci') < first, 'rechecks after npm ci, closest to the privileged part')
  assert.ok(first < at('npx supabase link'), 'first recheck before the first privileged command')
  assert.ok(at('npx supabase link') < at('npx supabase db push --dry-run'))
  assert.ok(at('npx supabase db push --dry-run') < second, 'second recheck after the dry run')
  const apply = pushSection.lastIndexOf('npx supabase db push')
  assert.ok(second < apply, 'second recheck before the writing command')
  // between the second recheck and the writing step there is nothing but that step itself
  const between = pushSection
    .slice(pushSection.indexOf(recheckSteps[1]) + recheckSteps[1].length, apply)
    .split('\n      - ')
  assert.equal(between.length, 2, 'only the apply step follows the second recheck')
  assert.match(between[1], /^name: Apply migrations/)
})

test('the recheck needs only actions: read besides contents: read, and no write permission', () => {
  assert.match(pushSection, /permissions:\s*\n\s*contents: read\s*\n\s*actions: read/)
  assert.doesNotMatch(staging, /: write/)
  assert.match(staging, /^permissions: \{\}$/m)
  // the token is handed to the two recheck steps only: not job-wide, not to npm ci or supabase steps
  assert.equal([...pushSection.matchAll(/github\.token/g)].length, 2)
  assert.doesNotMatch(pushSection, /^ {4}env:/m)
  const supabaseSteps = pushSection
    .split('\n      - ')
    .filter((step) => step.includes('npx supabase'))
  assert.equal(supabaseSteps.length, 3)
  for (const step of supabaseSteps) assert.doesNotMatch(step, /github\.token|GITHUB_TOKEN/)
})

test('approval protections are preserved: environment, exact SHA, concurrency, no PR trigger', () => {
  assert.match(pushSection, /environment: staging/)
  assert.match(pushSection, /ref: \$\{\{ needs\.gate\.outputs\.sha \}\}/)
  assert.match(pushSection, /git rev-parse HEAD/)
  assert.match(staging, /concurrency:\s*\n\s*group: staging-db\s*\n\s*cancel-in-progress: false/)
  assert.doesNotMatch(staging, /pull_request|pull_request_target|workflow_run|inputs:/)
})
