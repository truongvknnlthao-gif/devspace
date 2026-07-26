import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobManager, isActive, type JobRecord } from "./job-manager.js";

const root = await mkdtemp(join(tmpdir(), "devspace-job-manager-test-"));

try {
  const manager = new JobManager(root);
  const first = await manager.start({
    requestId: "request-deduplication-1",
    workspaceId: "ws_test",
    cwd: root,
    command: "printf 'hello\\n'; sleep 0.2; printf 'done\\n'",
    timeoutSeconds: 10,
  });
  assert.equal(first.deduplicated, false);
  assert.equal(isActive(first.job.status), true);

  const duplicate = await manager.start({
    requestId: "request-deduplication-1",
    workspaceId: "ws_test",
    cwd: root,
    command: "printf 'this must not run\\n'",
  });
  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.job.jobId, first.job.jobId);

  const completed = await waitForTerminal(manager, first.job.jobId);
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.exitCode, 0);
  const logs = await manager.logs(first.job.jobId, 0, 1024);
  assert.match(logs.text, /hello/);
  assert.match(logs.text, /done/);
  assert.doesNotMatch(logs.text, /must not run/);

  const processJob = await manager.startProcess({
    requestId: "request-process-stdin-1",
    workspaceId: "ws_test",
    kind: "test:process",
    cwd: root,
    executable: process.execPath,
    arguments: [
      "-e",
      "let input=''; process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => console.log(`received:${input}`));",
    ],
    stdin: "private-input",
    displayCommand: "node [private stdin]",
    timeoutSeconds: 10,
  });
  const processCompleted = await waitForTerminal(manager, processJob.job.jobId);
  assert.equal(processCompleted.status, "succeeded");
  assert.equal(processCompleted.kind, "test:process");
  assert.equal(processCompleted.command, "node [private stdin]");
  const processLogs = await manager.logs(processJob.job.jobId, 0, 1024);
  assert.match(processLogs.text, /received:private-input/);
  await assert.rejects(
    access(join(root, "jobs", processJob.job.jobId, "stdin")),
  );

  const long = await manager.start({
    requestId: "request-cancel-1",
    workspaceId: "ws_test",
    cwd: root,
    command: "printf 'started\\n'; sleep 30; printf 'unexpected\\n'",
    timeoutSeconds: 60,
  });
  await waitForStatus(manager, long.job.jobId, "running");
  await waitForLog(manager, long.job.jobId, /started/);
  const canceled = await manager.cancel(long.job.jobId);
  assert.equal(canceled.status, "canceled");
  const canceledLogs = await manager.logs(long.job.jobId, 0, 1024);
  assert.match(canceledLogs.text, /started/);
  assert.doesNotMatch(canceledLogs.text, /unexpected/);

  const timeout = await manager.start({
    requestId: "request-timeout-1",
    workspaceId: "ws_test",
    cwd: root,
    command: "sleep 10",
    timeoutSeconds: 1,
  });
  const timedOut = await waitForTerminal(manager, timeout.job.jobId, 8_000);
  assert.equal(timedOut.status, "timed_out");

  const active = await manager.list({ activeOnly: true });
  assert.equal(active.length, 0);
} finally {
  await rm(root, { recursive: true, force: true });
}

async function waitForLog(
  manager: JobManager,
  jobId: string,
  pattern: RegExp,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const logs = await manager.logs(jobId, 0, 4096);
    if (pattern.test(logs.text)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${jobId} logs to match ${pattern}`);
}

async function waitForStatus(
  manager: JobManager,
  jobId: string,
  expected: JobRecord["status"],
  timeoutMs = 5_000,
): Promise<JobRecord> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await manager.require(jobId);
    if (job.status === expected) return job;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${jobId} to reach ${expected}`);
}

async function waitForTerminal(
  manager: JobManager,
  jobId: string,
  timeoutMs = 8_000,
): Promise<JobRecord> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await manager.require(jobId);
    if (!isActive(job.status)) return job;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${jobId} to finish`);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
