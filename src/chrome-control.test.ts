import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChromeController } from "./chrome-control.js";
import type { ChromeConfig } from "./config.js";
import { isActive, JobManager } from "./job-manager.js";

const root = await mkdtemp(join(tmpdir(), "devspace-chrome-control-test-"));

try {
  const pluginRoot = join(root, "chrome-plugin");
  const scriptsDir = join(pluginRoot, "scripts");
  const codexPath = join(root, "codex");
  const stateDir = join(root, "state");
  await mkdir(scriptsDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    join(scriptsDir, "extension-id.json"),
    `${JSON.stringify({ extensionId: "test-extension" })}\n`,
  );
  await writeExecutable(
    join(scriptsDir, "check-extension-installed.js"),
    `console.log(JSON.stringify({
      extensionId: "test-extension",
      installed: true,
      enabled: true,
      selectedProfileDirectory: "Profile Test",
      profiles: [{
        profileDirectory: "Profile Test",
        installed: true,
        enabled: true,
        selected: true,
        versions: ["1.0.0"]
      }]
    }));`,
  );
  await writeExecutable(
    join(scriptsDir, "check-native-host-manifest.js"),
    `console.log(JSON.stringify({
      manifestPath: "/test/native-host.json",
      exists: true,
      correct: true,
      actualHostName: "com.openai.codexextension",
      problem: null
    }));`,
  );
  await writeExecutable(
    join(scriptsDir, "chrome-is-running.js"),
    `console.log(JSON.stringify({ running: true, processes: [{ pid: 123 }] }));`,
  );
  await writeExecutable(
    codexPath,
    `if (process.argv.includes("--version")) {
      console.log("codex-cli test");
      process.exit(0);
    }
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      if (!input.includes("observation-only")) process.exit(2);
      setTimeout(() => {
        console.log(JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "fake Chrome task complete" }
        }));
      }, 300);
    });`,
  );

  const config: ChromeConfig = {
    enabled: true,
    codexPath,
    pluginRoot,
    taskTimeoutSeconds: 30,
  };
  const jobs = new JobManager(stateDir);
  const controller = new ChromeController(config, stateDir, jobs);

  const status = await controller.status();
  assert.equal(status.ready, true);
  assert.equal(status.codex.version, "codex-cli test");
  assert.equal(status.extension?.selectedProfileDirectory, "Profile Test");
  assert.equal(status.nativeHost?.correct, true);
  assert.equal(status.chrome?.processCount, 1);

  const started = await controller.startTask({
    requestId: "chrome-test-1",
    instruction: "Read the current page title.",
    mode: "observe",
  });
  assert.equal(started.deduplicated, false);
  assert.equal(started.task.mode, "observe");

  const duplicate = await controller.startTask({
    requestId: "chrome-test-1",
    instruction: "This retry must not start another task.",
    mode: "observe",
  });
  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.task.taskId, started.task.taskId);
  await assert.rejects(
    controller.startTask({
      requestId: "chrome-test-2",
      instruction: "A second concurrent browser workflow.",
      mode: "observe",
    }),
    /Another Chrome task is already active/,
  );

  const completed = await waitForTerminal(controller, started.task.taskId);
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.message, "fake Chrome task complete");

  const job = await jobs.require(started.task.taskId);
  assert.doesNotMatch(job.command, /Read the current page title/);
  assert.equal(job.workspaceId, "__devspace_chrome__");

  const disabled = new ChromeController(
    { ...config, enabled: false },
    stateDir,
    new JobManager(join(root, "disabled-state")),
  );
  await assert.rejects(
    disabled.startTask({
      requestId: "disabled",
      instruction: "Do nothing.",
      mode: "observe",
    }),
    /Chrome control is disabled/,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

async function writeExecutable(path: string, source: string): Promise<void> {
  await writeFile(path, `#!/usr/bin/env node\n${source}\n`);
  await chmod(path, 0o755);
}

async function waitForTerminal(
  controller: ChromeController,
  taskId: string,
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await controller.taskStatus(taskId);
    if (!isActive(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for Chrome task ${taskId}`);
}
