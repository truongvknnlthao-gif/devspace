import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

export type JobStatus =
  | "starting"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled"
  | "timed_out";

export interface JobRecord {
  jobId: string;
  requestId: string;
  workspaceId: string;
  cwd: string;
  command: string;
  timeoutSeconds?: number;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  runnerPid?: number;
  childPid?: number;
  processGroupId?: number;
  exitCode?: number | null;
  signal?: string | null;
  logBytes: number;
}

export interface StartJobInput {
  requestId: string;
  workspaceId: string;
  cwd: string;
  command: string;
  timeoutSeconds?: number;
}

export interface JobLogChunk {
  jobId: string;
  cursor: number;
  nextCursor: number;
  totalBytes: number;
  text: string;
  hasMore: boolean;
}

interface JobMetadata {
  jobId: string;
  requestId: string;
  workspaceId: string;
  cwd: string;
  command: string;
  timeoutSeconds?: number;
  status: "starting";
  createdAt: string;
  runnerPid?: number;
}

interface RunnerState {
  status: Exclude<JobStatus, "starting">;
  startedAt: string;
  completedAt?: string;
  childPid?: number;
  processGroupId?: number;
  exitCode?: number | null;
  signal?: string | null;
}

export class JobManager {
  private readonly jobsDir: string;
  private readonly requestIndex = new Map<string, string>();
  private initialized = false;

  constructor(private readonly stateDir: string) {
    this.jobsDir = join(stateDir, "jobs");
  }

  async start(input: StartJobInput): Promise<{ job: JobRecord; deduplicated: boolean }> {
    await this.initialize();
    const normalizedRequestId = input.requestId.trim();
    if (!normalizedRequestId) throw new Error("requestId is required for reliable job deduplication.");

    const existingId = this.requestIndex.get(normalizedRequestId);
    if (existingId) {
      const existing = await this.get(existingId);
      if (existing) return { job: existing, deduplicated: true };
      this.requestIndex.delete(normalizedRequestId);
    }

    const jobId = `job_${randomUUID()}`;
    const jobDir = this.jobDir(jobId);
    await mkdir(jobDir, { recursive: false, mode: 0o700 });
    const paths = this.paths(jobId);
    const metadata: JobMetadata = {
      jobId,
      requestId: normalizedRequestId,
      workspaceId: input.workspaceId,
      cwd: input.cwd,
      command: input.command,
      timeoutSeconds: input.timeoutSeconds,
      status: "starting",
      createdAt: new Date().toISOString(),
    };
    await writeAtomic(paths.commandFile, input.command, 0o600);
    await writeAtomic(paths.logFile, "", 0o600);
    await writeAtomic(paths.metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, 0o600);
    await writeAtomic(paths.runnerInputFile, `${JSON.stringify({
      jobId,
      cwd: input.cwd,
      commandFile: paths.commandFile,
      logFile: paths.logFile,
      stateFile: paths.stateFile,
      cancelFile: paths.cancelFile,
      timeoutSeconds: input.timeoutSeconds,
    }, null, 2)}\n`, 0o600);

    const invocation = runnerInvocation();
    const runner = spawn(invocation.executable, [...invocation.arguments, paths.runnerInputFile], {
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    runner.unref();
    metadata.runnerPid = runner.pid;
    await writeAtomic(paths.metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, 0o600);
    this.requestIndex.set(normalizedRequestId, jobId);

    return { job: await this.require(jobId), deduplicated: false };
  }

  async get(jobId: string): Promise<JobRecord | undefined> {
    await this.initialize();
    const paths = this.paths(jobId);
    let metadata: JobMetadata;
    try {
      metadata = JSON.parse(await readFile(paths.metadataFile, "utf8")) as JobMetadata;
    } catch {
      return undefined;
    }

    let runnerState: RunnerState | undefined;
    try {
      runnerState = JSON.parse(await readFile(paths.stateFile, "utf8")) as RunnerState;
    } catch {
      runnerState = undefined;
    }
    const logBytes = await fileSize(paths.logFile);

    if (runnerState) {
      return { ...metadata, ...runnerState, logBytes };
    }

    return { ...metadata, status: "starting", logBytes };
  }

  async require(jobId: string): Promise<JobRecord> {
    const job = await this.get(jobId);
    if (!job) throw new Error(`Unknown jobId: ${jobId}`);
    return job;
  }

  async list(options: { workspaceId?: string; activeOnly?: boolean; limit?: number } = {}): Promise<JobRecord[]> {
    await this.initialize();
    const entries = await readdir(this.jobsDir, { withFileTypes: true });
    const jobs = (await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("job_"))
        .map((entry) => this.get(entry.name)),
    )).filter((job): job is JobRecord => Boolean(job));

    return jobs
      .filter((job) => !options.workspaceId || job.workspaceId === options.workspaceId)
      .filter((job) => !options.activeOnly || isActive(job.status))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.min(Math.max(options.limit ?? 20, 1), 100));
  }

  async activeCount(): Promise<number> {
    return (await this.list({ activeOnly: true, limit: 100 })).length;
  }

  async logs(jobId: string, cursor = 0, maxBytes = 64 * 1024): Promise<JobLogChunk> {
    await this.require(jobId);
    const path = this.paths(jobId).logFile;
    const totalBytes = await fileSize(path);
    const safeCursor = Math.min(Math.max(Math.trunc(cursor), 0), totalBytes);
    const safeMaxBytes = Math.min(Math.max(Math.trunc(maxBytes), 1), 256 * 1024);
    const length = Math.min(safeMaxBytes, totalBytes - safeCursor);
    if (length <= 0) {
      return { jobId, cursor: safeCursor, nextCursor: safeCursor, totalBytes, text: "", hasMore: false };
    }

    const handle = await open(path, "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, safeCursor);
      const nextCursor = safeCursor + bytesRead;
      return {
        jobId,
        cursor: safeCursor,
        nextCursor,
        totalBytes,
        text: buffer.subarray(0, bytesRead).toString("utf8"),
        hasMore: nextCursor < totalBytes,
      };
    } finally {
      await handle.close();
    }
  }

  async cancel(jobId: string): Promise<JobRecord> {
    const paths = this.paths(jobId);
    let job = await this.require(jobId);
    if (!isActive(job.status)) return job;
    await writeAtomic(paths.cancelFile, `${new Date().toISOString()}\n`, 0o600);

    for (let attempt = 0; attempt < 10 && !job.processGroupId; attempt += 1) {
      await sleep(100);
      job = await this.require(jobId);
    }

    const processGroupId = job.processGroupId ?? job.childPid;
    if (processGroupId) {
      signalProcessGroup(processGroupId, "SIGTERM");
      await sleep(500);
      if (isProcessGroupAlive(processGroupId)) signalProcessGroup(processGroupId, "SIGKILL");
    } else if (job.runnerPid) {
      signalProcess(job.runnerPid, "SIGTERM");
    }

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await sleep(100);
      job = await this.require(jobId);
      if (!isActive(job.status)) return job;
    }

    return job;
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.jobsDir, { recursive: true, mode: 0o700 });
    const entries = await readdir(this.jobsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("job_")) continue;
      try {
        const metadata = JSON.parse(
          await readFile(this.paths(entry.name).metadataFile, "utf8"),
        ) as JobMetadata;
        this.requestIndex.set(metadata.requestId, metadata.jobId);
      } catch {
        // Ignore incomplete directories; status lookup will report them as unknown.
      }
    }
    this.initialized = true;
  }

  private jobDir(jobId: string): string {
    if (!/^job_[0-9a-f-]{36}$/i.test(jobId)) throw new Error(`Invalid jobId: ${jobId}`);
    return join(this.jobsDir, jobId);
  }

  private paths(jobId: string) {
    const root = this.jobDir(jobId);
    return {
      root,
      metadataFile: join(root, "job.json"),
      runnerInputFile: join(root, "runner-input.json"),
      commandFile: join(root, "command.sh"),
      logFile: join(root, "output.log"),
      stateFile: join(root, "state.json"),
      cancelFile: join(root, "cancel-requested"),
    };
  }
}

export function isActive(status: JobStatus): boolean {
  return status === "starting" || status === "running";
}

function runnerInvocation(): { executable: string; arguments: string[] } {
  const compiled = fileURLToPath(new URL("./job-runner.js", import.meta.url));
  if (existsSync(compiled)) return { executable: process.execPath, arguments: [compiled] };

  const source = fileURLToPath(new URL("./job-runner.ts", import.meta.url));
  return { executable: process.execPath, arguments: ["--import", "tsx", source] };
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function signalProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function isProcessGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function writeAtomic(path: string, content: string, mode: number): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { mode });
  await rename(temporary, path);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
