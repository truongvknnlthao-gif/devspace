import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { ChromeConfig } from "./config.js";
import { isActive, JobManager, type JobRecord } from "./job-manager.js";

const execFileAsync = promisify(execFile);
const CHROME_JOB_WORKSPACE = "__devspace_chrome__";
const STATUS_TIMEOUT_MS = 5_000;
const STATUS_MAX_BUFFER = 4 * 1024 * 1024;

export type ChromeTaskMode = "observe" | "act";

export interface ChromeStatus {
  enabled: boolean;
  supported: boolean;
  ready: boolean;
  codex: {
    path: string;
    available: boolean;
    version?: string;
    error?: string;
  };
  plugin: {
    root: string;
    available: boolean;
    error?: string;
  };
  extension?: {
    extensionId?: string;
    installed: boolean;
    enabled: boolean;
    selectedProfileDirectory?: string;
    profiles: Array<{
      profileDirectory: string;
      installed: boolean;
      enabled: boolean;
      selected: boolean;
      versions: string[];
    }>;
    error?: string;
  };
  nativeHost?: {
    manifestPath?: string;
    exists: boolean;
    correct: boolean;
    actualHostName?: string;
    problem?: string | null;
    error?: string;
  };
  chrome?: {
    running: boolean;
    processCount: number;
    error?: string;
  };
}

export interface ChromeTaskStatus {
  taskId: string;
  requestId: string;
  mode: ChromeTaskMode;
  status: JobRecord["status"];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  timeoutSeconds?: number;
  message?: string;
  error?: string;
}

export class ChromeController {
  private startBarrier = Promise.resolve();

  constructor(
    private readonly config: ChromeConfig,
    private readonly stateDir: string,
    private readonly jobs: JobManager,
  ) {}

  async status(): Promise<ChromeStatus> {
    const supported = process.platform === "darwin";
    const codex = await this.codexStatus();
    const plugin = await this.pluginStatus();

    let extension: ChromeStatus["extension"];
    let nativeHost: ChromeStatus["nativeHost"];
    let chrome: ChromeStatus["chrome"];

    if (plugin.available) {
      const scripts = join(this.config.pluginRoot, "scripts");
      const [extensionResult, nativeHostResult, chromeResult] = await Promise.all([
        runJsonScript(join(scripts, "check-extension-installed.js")),
        runJsonScript(join(scripts, "check-native-host-manifest.js")),
        runJsonScript(join(scripts, "chrome-is-running.js")),
      ]);

      extension = normalizeExtensionStatus(extensionResult);
      nativeHost = normalizeNativeHostStatus(nativeHostResult);
      chrome = normalizeChromeStatus(chromeResult);
    }

    const ready = Boolean(
      this.config.enabled &&
        supported &&
        codex.available &&
        plugin.available &&
        extension?.installed &&
        extension.enabled &&
        nativeHost?.correct &&
        chrome?.running,
    );

    return {
      enabled: this.config.enabled,
      supported,
      ready,
      codex,
      plugin,
      extension,
      nativeHost,
      chrome,
    };
  }

  async startTask(input: {
    requestId: string;
    instruction: string;
    mode: ChromeTaskMode;
    timeoutSeconds?: number;
  }): Promise<{ task: ChromeTaskStatus; deduplicated: boolean }> {
    const previousStart = this.startBarrier;
    let releaseStart!: () => void;
    this.startBarrier = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    await previousStart;
    try {
      return await this.startTaskLocked(input);
    } finally {
      releaseStart();
    }
  }

  private async startTaskLocked(input: {
    requestId: string;
    instruction: string;
    mode: ChromeTaskMode;
    timeoutSeconds?: number;
  }): Promise<{ task: ChromeTaskStatus; deduplicated: boolean }> {
    if (!this.config.enabled) {
      throw new Error("Chrome control is disabled. Set DEVSPACE_CHROME_ENABLED=1 and restart DevSpace.");
    }

    const normalizedRequestId = `chrome:${input.requestId.trim()}`;
    const activeChromeJobs = (await this.jobs.list({ activeOnly: true, limit: 100 }))
      .filter((job) => job.workspaceId === CHROME_JOB_WORKSPACE && job.kind?.startsWith("chrome:"));
    const duplicate = activeChromeJobs.find((job) => job.requestId === normalizedRequestId);
    if (duplicate) {
      return { task: await this.toTaskStatus(duplicate), deduplicated: true };
    }
    if (activeChromeJobs.length > 0) {
      throw new Error(
        `Another Chrome task is already active: ${activeChromeJobs[0]!.jobId}. Wait for it to finish or cancel it.`,
      );
    }

    const preflight = await this.status();
    if (!preflight.ready) {
      throw new Error(`Chrome control is not ready: ${summarizeReadiness(preflight)}`);
    }

    const timeoutSeconds = Math.min(
      input.timeoutSeconds ?? this.config.taskTimeoutSeconds,
      this.config.taskTimeoutSeconds,
    );
    const started = await this.jobs.startProcess({
      requestId: normalizedRequestId,
      workspaceId: CHROME_JOB_WORKSPACE,
      kind: `chrome:${input.mode}`,
      cwd: this.stateDir,
      executable: this.config.codexPath,
      arguments: [
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--json",
        "-",
      ],
      stdin: chromeTaskPrompt(input.instruction, input.mode),
      displayCommand: `${basename(this.config.codexPath)} exec [official Chrome task via private stdin]`,
      timeoutSeconds,
    });

    return {
      task: await this.toTaskStatus(started.job),
      deduplicated: started.deduplicated,
    };
  }

  async taskStatus(taskId: string): Promise<ChromeTaskStatus> {
    return this.toTaskStatus(await this.requireChromeJob(taskId));
  }

  async cancelTask(taskId: string): Promise<ChromeTaskStatus> {
    await this.requireChromeJob(taskId);
    return this.toTaskStatus(await this.jobs.cancel(taskId));
  }

  private async requireChromeJob(taskId: string): Promise<JobRecord> {
    const job = await this.jobs.require(taskId);
    if (job.workspaceId !== CHROME_JOB_WORKSPACE || !job.kind?.startsWith("chrome:")) {
      throw new Error(`Unknown Chrome taskId: ${taskId}`);
    }
    return job;
  }

  private async toTaskStatus(job: JobRecord): Promise<ChromeTaskStatus> {
    const mode = job.kind === "chrome:observe" ? "observe" : "act";
    const output = isActive(job.status) ? {} : await this.extractTaskOutput(job);
    return {
      taskId: job.jobId,
      requestId: job.requestId.replace(/^chrome:/, ""),
      mode,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      timeoutSeconds: job.timeoutSeconds,
      ...output,
    };
  }

  private async extractTaskOutput(
    job: JobRecord,
  ): Promise<{ message?: string; error?: string }> {
    const maxBytes = 256 * 1024;
    const cursor = Math.max(0, job.logBytes - maxBytes);
    const log = await this.jobs.logs(job.jobId, cursor, maxBytes);
    const parsed = extractCodexResult(log.text);
    if (parsed.message) return { message: parsed.message };
    if (parsed.error) return { error: parsed.error };
    if (job.status === "canceled") return { error: "Chrome task was canceled." };
    if (job.status === "timed_out") return { error: "Chrome task timed out." };
    if (job.status === "failed") return { error: "Chrome task failed without a final Codex message." };
    return {};
  }

  private async codexStatus(): Promise<ChromeStatus["codex"]> {
    try {
      const { stdout } = await execFileAsync(this.config.codexPath, ["--version"], {
        timeout: STATUS_TIMEOUT_MS,
        maxBuffer: STATUS_MAX_BUFFER,
        encoding: "utf8",
      });
      return {
        path: this.config.codexPath,
        available: true,
        version: stdout.trim(),
      };
    } catch (error) {
      return {
        path: this.config.codexPath,
        available: false,
        error: commandError(error),
      };
    }
  }

  private async pluginStatus(): Promise<ChromeStatus["plugin"]> {
    try {
      await readFile(join(this.config.pluginRoot, "scripts", "extension-id.json"), "utf8");
      return { root: this.config.pluginRoot, available: true };
    } catch (error) {
      return {
        root: this.config.pluginRoot,
        available: false,
        error: commandError(error),
      };
    }
  }
}

function chromeTaskPrompt(instruction: string, mode: ChromeTaskMode): string {
  const modeRules =
    mode === "observe"
      ? "This is observation-only. You may inspect existing Chrome tabs and visible page state, but do not navigate, click, type, submit, upload, download, or otherwise change browser or website state."
      : "Carry out the requested Chrome workflow. Use the official Chrome plugin for browser actions and keep actions within the user's instruction.";

  return [
    "[@Chrome](plugin://chrome@openai-bundled)",
    "You are executing one browser task under DevSpace supervision.",
    modeRules,
    "Use the user's existing Chrome session when available.",
    "Return a concise final result. Do not include unrelated page contents or secrets.",
    "",
    "User instruction:",
    instruction.trim(),
  ].join("\n");
}

async function runJsonScript(path: string): Promise<Record<string, unknown> | { error: string }> {
  try {
    const { stdout } = await execFileAsync(process.execPath, [path, "--json"], {
      timeout: STATUS_TIMEOUT_MS,
      maxBuffer: STATUS_MAX_BUFFER,
      encoding: "utf8",
    });
    return parseJson(stdout);
  } catch (error) {
    const stdout = (error as { stdout?: string | Buffer }).stdout?.toString();
    if (stdout?.trim()) {
      try {
        return parseJson(stdout);
      } catch {
        // Fall through to the stable error shape.
      }
    }
    return { error: commandError(error) };
  }
}

function parseJson(value: string): Record<string, unknown> {
  return JSON.parse(value) as Record<string, unknown>;
}

function normalizeExtensionStatus(raw: Record<string, unknown>): NonNullable<ChromeStatus["extension"]> {
  const profiles = Array.isArray(raw.profiles)
    ? raw.profiles.map((profile) => {
        const value = profile as Record<string, unknown>;
        return {
          profileDirectory: String(value.profileDirectory ?? ""),
          installed: value.installed === true,
          enabled: value.enabled === true,
          selected: value.selected === true,
          versions: Array.isArray(value.versions) ? value.versions.map(String) : [],
        };
      })
    : [];
  return {
    extensionId: stringValue(raw.extensionId),
    installed: raw.installed === true,
    enabled: raw.enabled === true,
    selectedProfileDirectory: stringValue(raw.selectedProfileDirectory),
    profiles,
    error: stringValue(raw.error),
  };
}

function normalizeNativeHostStatus(raw: Record<string, unknown>): NonNullable<ChromeStatus["nativeHost"]> {
  return {
    manifestPath: stringValue(raw.manifestPath),
    exists: raw.exists === true,
    correct: raw.correct === true,
    actualHostName: stringValue(raw.actualHostName),
    problem: raw.problem === null ? null : stringValue(raw.problem),
    error: stringValue(raw.error),
  };
}

function normalizeChromeStatus(raw: Record<string, unknown>): NonNullable<ChromeStatus["chrome"]> {
  return {
    running: raw.running === true,
    processCount: Array.isArray(raw.processes) ? raw.processes.length : 0,
    error: stringValue(raw.error),
  };
}

function extractCodexResult(text: string): { message?: string; error?: string } {
  const lines = text.split(/\r?\n/).filter(Boolean);
  let error: string | undefined;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const event = JSON.parse(lines[index]!) as Record<string, unknown>;
      const item = event.item as Record<string, unknown> | undefined;
      if (item?.type === "agent_message" && typeof item.text === "string") {
        return { message: item.text };
      }
      const eventError = event.error;
      if (!error && typeof eventError === "string") error = eventError;
      if (!error && eventError && typeof eventError === "object") {
        const message = (eventError as Record<string, unknown>).message;
        if (typeof message === "string") error = message;
      }
      if (!error && typeof event.message === "string" && event.type === "error") {
        error = event.message;
      }
    } catch {
      // Codex can emit diagnostic stderr beside JSONL; do not expose it as page content.
    }
  }
  return error ? { error } : {};
}

function summarizeReadiness(status: ChromeStatus): string {
  const missing: string[] = [];
  if (!status.supported) missing.push("unsupported platform");
  if (!status.codex.available) missing.push("Codex CLI unavailable");
  if (!status.plugin.available) missing.push("official Chrome plugin unavailable");
  if (!status.extension?.installed) missing.push("Chrome extension not installed");
  else if (!status.extension.enabled) missing.push("Chrome extension not enabled");
  if (!status.nativeHost?.correct) missing.push("native host manifest not ready");
  if (!status.chrome?.running) missing.push("Chrome not running");
  return missing.join(", ") || "unknown readiness failure";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function commandError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
