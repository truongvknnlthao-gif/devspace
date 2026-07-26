import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "./config.js";
import { createReviewCheckpointManager } from "./review-checkpoints.js";
import { createMcpServer } from "./server.js";
import { WorkspaceRegistry } from "./workspaces.js";

const fixture = await mkdtemp(join(tmpdir(), "devspace-tool-surface-"));

try {
  const baseEnv = {
    DEVSPACE_CONFIG_DIR: join(fixture, "config"),
    DEVSPACE_ALLOWED_ROOTS: fixture,
    DEVSPACE_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    DEVSPACE_STATE_DIR: join(fixture, "state"),
    DEVSPACE_AGENT_DIR: join(fixture, "agent"),
    DEVSPACE_WORKTREE_ROOT: join(fixture, "worktrees"),
    DEVSPACE_WIDGETS: "off",
  };

  const defaultTools = await listTools(loadConfig(baseEnv));
  for (const tool of [
    "device_status",
    "screen_capture",
    "open_workspace",
    "read",
    "write",
    "edit",
    "grep",
    "glob",
    "ls",
  ]) {
    assert.equal(defaultTools.has(tool), true, `${tool} should be present`);
  }
  assert.match(defaultTools.get("device_status")?.description ?? "", /Device Helper/);
  assert.match(defaultTools.get("screen_capture")?.description ?? "", /PNG image/);
  for (const removed of [
    "git_preflight",
    "read_gitignore",
    "copy_file",
    "git_check_ignore",
    "prepare_cloudflare_staging",
    "read_file",
    "write_file",
    "edit_file",
    "grep_files",
    "find_files",
    "list_directory",
    "run_shell",
  ]) {
    assert.equal(defaultTools.has(removed), false, `${removed} should be absent`);
  }
  assert.equal(defaultTools.has("bash"), false);
  assert.match(defaultTools.get("read")?.description ?? "", /local config files/);
  assert.match(defaultTools.get("write")?.description ?? "", /local config files/);
  assert.match(defaultTools.get("edit")?.description ?? "", /local config files/);

  const shellTools = await listTools(loadConfig({ ...baseEnv, DEVSPACE_SHELL_ENABLED: "1" }));
  for (const tool of ["bash", "bash_start", "bash_status", "bash_logs", "bash_cancel", "bash_jobs"]) {
    assert.equal(shellTools.has(tool), true, `${tool} should be present`);
  }
  assert.match(shellTools.get("bash")?.description ?? "", /trusted local command runner/);
  assert.match(shellTools.get("bash")?.description ?? "", /Wrangler deploy/);
  assert.match(shellTools.get("bash_start")?.description ?? "", /idempotency key/);
  assert.match(shellTools.get("bash_start")?.description ?? "", /does not filter/);
} finally {
  await rm(fixture, { recursive: true, force: true });
}

async function listTools(config: ReturnType<typeof loadConfig>): Promise<Map<string, { description?: string }>> {
  const server = createMcpServer(
    config,
    new WorkspaceRegistry(config),
    createReviewCheckpointManager(),
  );
  const client = new Client(
    { name: "devspace-tool-surface-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    assert.match(client.getInstructions() ?? "", /deterministic command-line or application APIs/);
    assert.match(client.getInstructions() ?? "", /mouse and keyboard automation is a last resort/);
    return new Map((await client.listTools()).tools.map((tool) => [tool.name, tool]));
  } finally {
    await client.close();
    await server.close();
  }
}
