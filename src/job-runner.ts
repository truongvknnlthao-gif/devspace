import { closeSync, openSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

interface RunnerInput {
  jobId: string;
  cwd: string;
  commandFile: string;
  logFile: string;
  stateFile: string;
  cancelFile: string;
  timeoutSeconds?: number;
}

interface RunnerState {
  status: "running" | "succeeded" | "failed" | "canceled" | "timed_out";
  startedAt: string;
  completedAt?: string;
  childPid?: number;
  processGroupId?: number;
  exitCode?: number | null;
  signal?: string | null;
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error("Job runner input path is required.");
  const input = JSON.parse(await readFile(inputPath, "utf8")) as RunnerInput;
  const command = await readFile(input.commandFile, "utf8");
  const startedAt = new Date().toISOString();
  const logFd = openSync(input.logFile, "a");
  let timedOut = false;
  let timeoutHandle: NodeJS.Timeout | undefined;
  let killHandle: NodeJS.Timeout | undefined;

  const child = spawn("/bin/bash", ["-lc", command], {
    cwd: input.cwd,
    detached: true,
    env: process.env,
    stdio: ["ignore", logFd, logFd],
  });

  await writeState(input.stateFile, {
    status: "running",
    startedAt,
    childPid: child.pid,
    processGroupId: child.pid,
  });

  if (input.timeoutSeconds && input.timeoutSeconds > 0) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      signalProcessGroup(child.pid, "SIGTERM");
      killHandle = setTimeout(() => signalProcessGroup(child.pid, "SIGKILL"), 5_000);
      killHandle.unref();
    }, input.timeoutSeconds * 1_000);
    timeoutHandle.unref();
  }

  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("error", () => resolve({ code: 127, signal: null }));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });

  if (timeoutHandle) clearTimeout(timeoutHandle);
  if (killHandle) clearTimeout(killHandle);
  closeSync(logFd);

  const canceled = await fileExists(input.cancelFile);
  const status: RunnerState["status"] = timedOut
    ? "timed_out"
    : canceled
      ? "canceled"
      : result.code === 0
        ? "succeeded"
        : "failed";

  await writeState(input.stateFile, {
    status,
    startedAt,
    completedAt: new Date().toISOString(),
    childPid: child.pid,
    processGroupId: child.pid,
    exitCode: result.code,
    signal: result.signal,
  });
}

function signalProcessGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") throw error;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function writeState(path: string, state: RunnerState): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

main().catch(async (error) => {
  const inputPath = process.argv[2];
  if (inputPath) {
    try {
      const input = JSON.parse(await readFile(inputPath, "utf8")) as RunnerInput;
      await writeState(input.stateFile, {
        status: "failed",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        exitCode: 127,
        signal: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // The server can still report a missing/invalid runner state.
    }
  }
  process.exitCode = 1;
});
