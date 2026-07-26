import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "./config.js";
import { JobManager } from "./job-manager.js";
import { createReviewCheckpointManager } from "./review-checkpoints.js";
import { createMcpServer } from "./server.js";
import { WorkspaceRegistry } from "./workspaces.js";

const fixture = await mkdtemp(join(tmpdir(), "devspace-job-tools-test-"));
const config = loadConfig({
  DEVSPACE_CONFIG_DIR: join(fixture, "config"),
  DEVSPACE_ALLOWED_ROOTS: fixture,
  DEVSPACE_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
  DEVSPACE_STATE_DIR: join(fixture, "state"),
  DEVSPACE_AGENT_DIR: join(fixture, "agent"),
  DEVSPACE_WORKTREE_ROOT: join(fixture, "worktrees"),
  DEVSPACE_WIDGETS: "off",
  DEVSPACE_SHELL_ENABLED: "1",
});
const workspaces = new WorkspaceRegistry(config);
const jobs = new JobManager(config.stateDir);
const server = createMcpServer(config, workspaces, createReviewCheckpointManager(), jobs);
const client = new Client({ name: "devspace-job-tools-test", version: "1.0.0" }, { capabilities: {} });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const chromeJob = await jobs.startProcess({
    requestId: "chrome-hidden-from-bash-tools",
    workspaceId: "__devspace_chrome__",
    kind: "chrome:observe",
    cwd: fixture,
    executable: process.execPath,
    arguments: ["-e", "console.log('private chrome event')"],
    displayCommand: "codex exec [official Chrome task via private stdin]",
  });
  const hiddenStatus = await client.callTool({
    name: "bash_status",
    arguments: { jobId: chromeJob.job.jobId },
  });
  assert.equal(hiddenStatus.isError, true);

  const opened = await client.callTool({ name: "open_workspace", arguments: { path: fixture } });
  const workspaceId = (opened.structuredContent as { workspaceId?: string } | undefined)?.workspaceId;
  assert.equal(typeof workspaceId, "string");

  const first = JSON.parse(textResult(await client.callTool({
    name: "bash_start",
    arguments: {
      workspaceId: workspaceId!,
      requestId: "mcp-e2e-dedup-1",
      command: "printf 'mcp-started\\n'; sleep 0.2; printf 'mcp-done\\n'",
      timeout: 10,
    },
  }))) as { jobId: string; deduplicated: boolean };
  assert.equal(first.deduplicated, false);

  const duplicate = JSON.parse(textResult(await client.callTool({
    name: "bash_start",
    arguments: {
      workspaceId: workspaceId!,
      requestId: "mcp-e2e-dedup-1",
      command: "printf 'must-not-run\\n'",
    },
  }))) as { jobId: string; deduplicated: boolean };
  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.jobId, first.jobId);

  let terminal = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = JSON.parse(textResult(await client.callTool({
      name: "bash_status",
      arguments: { jobId: first.jobId },
    }))) as { status: string };
    if (!["starting", "running"].includes(status.status)) {
      assert.equal(status.status, "succeeded");
      terminal = true;
      break;
    }
    await sleep(50);
  }
  assert.equal(terminal, true);

  const logs = JSON.parse(textResult(await client.callTool({
    name: "bash_logs",
    arguments: { jobId: first.jobId, cursor: 0, maxBytes: 4096 },
  }))) as { text: string; nextCursor: number };
  assert.match(logs.text, /mcp-started/);
  assert.match(logs.text, /mcp-done/);
  assert.doesNotMatch(logs.text, /must-not-run/);
  assert.equal(logs.nextCursor > 0, true);

  const listed = JSON.parse(textResult(await client.callTool({
    name: "bash_jobs",
    arguments: { workspaceId: workspaceId!, limit: 10 },
  }))) as Array<{ jobId: string }>;
  assert.equal(listed.some((job) => job.jobId === first.jobId), true);
  assert.equal(listed.some((job) => job.jobId === chromeJob.job.jobId), false);
} finally {
  await client.close();
  await server.close();
  await rm(fixture, { recursive: true, force: true });
}

function textResult(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content.find((item) => item.type === "text")?.text ?? "";
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
