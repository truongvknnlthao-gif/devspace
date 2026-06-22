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

  const defaultTools = await listToolNames(loadConfig(baseEnv));
  assert.equal(defaultTools.has("bash"), false);
  assert.equal(defaultTools.has("run_shell"), false);
  assert.equal(defaultTools.has("grep"), true);
  assert.equal(defaultTools.has("glob"), true);
  assert.equal(defaultTools.has("ls"), true);

  const shellTools = await listToolNames(loadConfig({
    ...baseEnv,
    DEVSPACE_SHELL_ENABLED: "1",
    DEVSPACE_TOOL_MODE: "minimal",
  }));
  assert.equal(shellTools.has("bash"), true);
  assert.equal(shellTools.has("grep"), false);
  assert.equal(shellTools.has("glob"), false);
  assert.equal(shellTools.has("ls"), false);
} finally {
  await rm(fixture, { recursive: true, force: true });
}

async function listToolNames(config: ReturnType<typeof loadConfig>): Promise<Set<string>> {
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
    return new Set((await client.listTools()).tools.map((tool) => tool.name));
  } finally {
    await client.close();
    await server.close();
  }
}
