import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

export interface RuntimeInfo {
  name: "devspace";
  version: string;
  commit: string;
  builtAt?: string;
  startedAt: string;
  pid: number;
}

interface BuildInfo {
  version?: string;
  commit?: string;
  builtAt?: string;
}

const startedAt = new Date().toISOString();

export function loadRuntimeInfo(): RuntimeInfo {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const packageVersion = readJson<{ version?: string }>(join(packageRoot, "package.json"))?.version ?? "unknown";
  const build = readJson<BuildInfo>(join(packageRoot, "build-info.json"));
  const commit = process.env.DEVSPACE_RUNTIME_COMMIT
    ?? build?.commit
    ?? gitCommit(packageRoot)
    ?? "unknown";

  return {
    name: "devspace",
    version: process.env.DEVSPACE_RUNTIME_VERSION ?? build?.version ?? packageVersion,
    commit,
    builtAt: build?.builtAt,
    startedAt,
    pid: process.pid,
  };
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function gitCommit(root: string): string | undefined {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}
