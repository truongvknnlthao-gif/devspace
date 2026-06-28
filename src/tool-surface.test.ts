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
  assert.equal(defaultTools.has("bash"), false);
  assert.equal(defaultTools.has("run_shell"), false);
  assert.equal(defaultTools.has("git_preflight"), true);
  assert.equal(defaultTools.has("read_gitignore"), true);
  assert.equal(defaultTools.has("copy_file"), true);
  assert.equal(defaultTools.has("git_check_ignore"), true);
  assert.equal(defaultTools.has("prepare_cloudflare_staging"), true);
  assert.equal(defaultTools.has("grep"), true);
  assert.equal(defaultTools.has("glob"), true);
  assert.equal(defaultTools.has("ls"), true);

  const shellTools = await listTools(loadConfig({
    ...baseEnv,
    DEVSPACE_SHELL_ENABLED: "1",
    DEVSPACE_TOOL_MODE: "minimal",
  }));
  assert.equal(shellTools.has("bash"), true);
  assert.equal(shellTools.has("git_preflight"), true);
  assert.equal(shellTools.has("read_gitignore"), true);
  assert.equal(shellTools.has("copy_file"), true);
  assert.equal(shellTools.has("git_check_ignore"), true);
  assert.equal(shellTools.has("prepare_cloudflare_staging"), true);
  assert.equal(shellTools.has("grep"), false);
  assert.equal(shellTools.has("glob"), false);
  assert.equal(shellTools.has("ls"), false);
  assert.match(shellTools.get("bash")?.description ?? "", /trusted local command runner/);
  assert.match(shellTools.get("bash")?.description ?? "", /Wrangler deploy/);
  assert.match(shellTools.get("bash")?.description ?? "", /Cloudflare API calls/);
  assert.doesNotMatch(shellTools.get("bash")?.description ?? "", /never invokes|does not read real|do not run/i);
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
    return new Map((await client.listTools()).tools.map((tool) => [tool.name, tool]));
  } finally {
    await client.close();
    await server.close();
  }
}
