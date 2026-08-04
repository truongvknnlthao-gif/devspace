import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "./config.js";
import { createReviewCheckpointManager } from "./review-checkpoints.js";
import { createMcpServer } from "./server.js";
import {
  MacOSDeviceClient,
  defaultDeviceHelperPath,
  deviceHelperApplicationPath,
} from "./macos-device.js";
import { WorkspaceRegistry } from "./workspaces.js";

const fixture = await mkdtemp(join(tmpdir(), "devspace-macos-device-test-"));
const helperPath = join(fixture, "fake-device-helper.mjs");
const bundledApplicationPath = join(fixture, "DevSpace Device Helper.app");
const bundledHelperPath = join(
  bundledApplicationPath,
  "Contents",
  "MacOS",
  "DevSpace Device Helper",
);
const applicationLauncherPath = join(fixture, "fake-open.sh");
const applicationLaunchLogPath = join(fixture, "application-launches.jsonl");
const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlEUAAAAASUVORK5CYII=";

try {
  await writeFile(
    helperPath,
    `#!/usr/bin/env node
import { chmodSync, writeFileSync } from "node:fs";

const [command, ...args] = process.argv.slice(2);
if (command === "status") {
  console.log(JSON.stringify({
    ok: true,
    protocolVersion: 1,
    helperVersion: "test",
    bundleIdentifier: "com.devspace.device-helper.test",
    executablePath: process.argv[1],
    screenCaptureAuthorized: true,
    accessibilityAuthorized: false,
  }));
  process.exit(0);
}

if (command === "capture") {
  const outputIndex = args.indexOf("--output");
  const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
  if (!outputPath) {
    console.log(JSON.stringify({ ok: false, protocolVersion: 1, error: "missing output" }));
    process.exit(1);
  }
  writeFileSync(outputPath, Buffer.from("${pngBase64}", "base64"));
  chmodSync(outputPath, 0o600);
  console.log(JSON.stringify({
    ok: true,
    protocolVersion: 1,
    displayId: 42,
    width: 1,
    height: 1,
    mimeType: "image/png",
  }));
  process.exit(0);
}

console.log(JSON.stringify({ ok: false, protocolVersion: 1, error: "unknown command" }));
process.exit(1);
`,
  );
  await chmod(helperPath, 0o700);

  await mkdir(join(bundledApplicationPath, "Contents", "MacOS"), {
    recursive: true,
  });
  await writeFile(
    bundledHelperPath,
    `#!/usr/bin/env node
import { chmodSync, writeFileSync } from "node:fs";

const rawArgs = process.argv.slice(2);
const responseIndex = rawArgs.indexOf("--response");
const responsePath = responseIndex >= 0 ? rawArgs[responseIndex + 1] : undefined;
const args = rawArgs.filter((_, index) => index !== responseIndex && index !== responseIndex + 1);
const [command, ...commandArgs] = args;

function respond(value, status = 0) {
  if (!responsePath) process.exit(65);
  writeFileSync(responsePath, JSON.stringify(value) + "\\n");
  chmodSync(responsePath, 0o600);
  process.exit(status);
}

if (command === "status") {
  respond({
    ok: true,
    protocolVersion: 1,
    helperVersion: "bundled-test",
    bundleIdentifier: "com.devspace.device-helper.bundled-test",
    executablePath: process.argv[1],
    screenCaptureAuthorized: true,
    accessibilityAuthorized: true,
  });
}

if (command === "capture") {
  const outputIndex = commandArgs.indexOf("--output");
  const outputPath = outputIndex >= 0 ? commandArgs[outputIndex + 1] : undefined;
  if (!outputPath) {
    respond({ ok: false, protocolVersion: 1, error: "missing output" }, 1);
  }
  writeFileSync(outputPath, Buffer.from("${pngBase64}", "base64"));
  chmodSync(outputPath, 0o600);
  respond({
    ok: true,
    protocolVersion: 1,
    displayId: 84,
    width: 1,
    height: 1,
    mimeType: "image/png",
  });
}

respond({ ok: false, protocolVersion: 1, error: "unknown command" }, 1);
`,
  );
  await chmod(bundledHelperPath, 0o700);

  await writeFile(
    applicationLauncherPath,
    `#!/bin/sh
set -eu
printf '%s\\t' "$@" >> "${applicationLaunchLogPath}"
printf '\\n' >> "${applicationLaunchLogPath}"
[ "$1" = "-n" ]
shift
[ "$1" = "-g" ]
shift
application_path="$1"
shift
[ "$1" = "--args" ]
shift
"$application_path/Contents/MacOS/DevSpace Device Helper" "$@"
`,
  );
  await chmod(applicationLauncherPath, 0o700);

  const client = new MacOSDeviceClient({
    helperPath,
    platform: "darwin",
    temporaryDirectory: fixture,
  });
  const status = await client.status();
  assert.equal(status.supported, true);
  assert.equal(status.helperInstalled, true);
  assert.equal(status.helperVersion, "test");
  assert.equal(status.bundleIdentifier, "com.devspace.device-helper.test");
  assert.equal(status.screenCaptureAuthorized, true);
  assert.equal(status.accessibilityAuthorized, false);

  const capture = await client.capture();
  assert.equal(capture.displayId, 42);
  assert.equal(capture.width, 1);
  assert.equal(capture.height, 1);
  assert.equal(capture.mimeType, "image/png");
  assert.equal(capture.data, pngBase64);
  assert.ok(capture.bytes > 8);

  const bundledClient = new MacOSDeviceClient({
    helperPath: bundledHelperPath,
    platform: "darwin",
    temporaryDirectory: fixture,
    applicationLauncherPath,
  });
  assert.equal(
    deviceHelperApplicationPath(bundledHelperPath),
    bundledApplicationPath,
  );
  assert.equal(deviceHelperApplicationPath(helperPath), undefined);

  const bundledStatus = await bundledClient.status();
  assert.equal(bundledStatus.helperVersion, "bundled-test");
  assert.equal(
    bundledStatus.bundleIdentifier,
    "com.devspace.device-helper.bundled-test",
  );
  assert.equal(bundledStatus.screenCaptureAuthorized, true);
  assert.equal(bundledStatus.accessibilityAuthorized, true);

  const bundledCapture = await bundledClient.capture();
  assert.equal(bundledCapture.displayId, 84);
  assert.equal(bundledCapture.data, pngBase64);

  const applicationLaunches = (await readFile(applicationLaunchLogPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => line.split("\t").filter(Boolean));
  assert.equal(applicationLaunches.length, 2);
  for (const launch of applicationLaunches) {
    assert.deepEqual(launch.slice(0, 3), ["-n", "-g", bundledApplicationPath]);
    assert.equal(launch[3], "--args");
    assert.equal(launch[4], "--response");
    assert.match(launch[5] ?? "", /response\.json$/);
  }

  await assert.rejects(client.capture(-1), /non-negative integer/);

  const missing = new MacOSDeviceClient({
    helperPath: join(fixture, "missing-helper"),
    platform: "darwin",
  });
  const missingStatus = await missing.status();
  assert.equal(missingStatus.supported, true);
  assert.equal(missingStatus.helperInstalled, false);
  assert.match(missingStatus.error ?? "", /not installed/);

  const unsupported = new MacOSDeviceClient({
    helperPath,
    platform: "linux",
  });
  assert.equal((await unsupported.status()).supported, false);
  await assert.rejects(unsupported.capture(), /only on macOS/);

  assert.match(defaultDeviceHelperPath(), /DevSpace Device Helper\.app/);

  const config = loadConfig({
    DEVSPACE_CONFIG_DIR: join(fixture, "config"),
    DEVSPACE_ALLOWED_ROOTS: fixture,
    DEVSPACE_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    DEVSPACE_STATE_DIR: join(fixture, "state"),
    DEVSPACE_AGENT_DIR: join(fixture, "agent"),
    DEVSPACE_WORKTREE_ROOT: join(fixture, "worktrees"),
    DEVSPACE_DEVICE_HELPER_PATH: helperPath,
    DEVSPACE_WIDGETS: "off",
  });
  const server = createMcpServer(
    config,
    new WorkspaceRegistry(config),
    createReviewCheckpointManager(),
  );
  const mcpClient = new Client(
    { name: "devspace-device-tools-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await mcpClient.connect(clientTransport);

    const statusResult = await mcpClient.callTool({
      name: "device_status",
      arguments: {},
    });
    assert.equal(statusResult.isError, undefined);
    assert.equal(
      (statusResult.structuredContent as { helperInstalled?: boolean })
        .helperInstalled,
      true,
    );

    const captureResult = await mcpClient.callTool({
      name: "screen_capture",
      arguments: {},
    });
    assert.equal(captureResult.isError, undefined);
    const content = captureResult.content as Array<{
      type: string;
      data?: string;
      mimeType?: string;
    }>;
    const image = content.find((item) => item.type === "image");
    assert.equal(image?.type, "image");
    if (image?.type === "image") {
      assert.equal(image.mimeType, "image/png");
      assert.equal(image.data, pngBase64);
    }
  } finally {
    await mcpClient.close();
    await server.close();
  }
} finally {
  await rm(fixture, { recursive: true, force: true });
}
