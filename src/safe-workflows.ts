import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, copyFile, readFile } from "node:fs/promises";
import { basename, relative, sep } from "node:path";
import { promisify } from "node:util";
import { git, getGitEligibility } from "./git.js";
import {
  assertAllowedExistingPath,
  resolveAllowedExistingPath,
  resolveAllowedProspectivePath,
} from "./roots.js";

const execFileAsync = promisify(execFile);

export interface GitPreflightInput {
  fetch?: boolean;
  remote?: string;
  remoteTrackingRef?: string;
}

export interface GitPreflightResult {
  gitRoot: string;
  status: string;
  fetchedRemote?: string;
  fetchOutput?: string;
  head: string;
  remoteTrackingRef?: string;
  remoteHead?: string;
  branch: string;
}

export interface ToolContext {
  cwd: string;
  root: string;
}

export interface CopyWorkspaceFileInput {
  source: string;
  target: string;
  overwrite?: boolean;
}

export interface CopyWorkspaceFileResult {
  source: string;
  target: string;
  status: "copied" | "overwritten" | "exists";
}

export interface GitCheckIgnoreInput {
  paths: string[];
}

export interface GitCheckIgnoreResult {
  gitRoot: string;
  ignored: string[];
  notIgnored: string[];
  output: string;
}

export async function runGitPreflight(
  input: GitPreflightInput,
  context: ToolContext,
): Promise<GitPreflightResult> {
  const eligibility = await getGitEligibility(context.cwd);
  if (!eligibility.ok || !eligibility.gitRoot) {
    throw new Error(eligibility.message ?? "workspace is not inside a Git repository");
  }

  const gitRoot = assertAllowedExistingPath(eligibility.gitRoot, [context.root]);
  const status = (await git(gitRoot, ["status", "--short", "--branch"])).stdout.trimEnd();
  const remote = input.remote ?? "origin";
  let fetchOutput: string | undefined;
  let fetchedRemote: string | undefined;

  if (input.fetch) {
    assertSafeGitRemote(remote);
    const fetch = await git(gitRoot, ["fetch", remote]);
    fetchOutput = [fetch.stdout, fetch.stderr].filter(Boolean).join("").trimEnd();
    fetchedRemote = remote;
  }

  const head = (await git(gitRoot, ["rev-parse", "HEAD"])).stdout.trim();
  let remoteHead: string | undefined;
  if (input.remoteTrackingRef) {
    assertSafeGitRef(input.remoteTrackingRef);
    remoteHead = (await git(gitRoot, ["rev-parse", input.remoteTrackingRef])).stdout.trim();
  }
  const branch = (await git(gitRoot, ["branch", "--show-current"])).stdout.trim();

  return {
    gitRoot,
    status,
    fetchedRemote,
    fetchOutput,
    head,
    remoteTrackingRef: input.remoteTrackingRef,
    remoteHead,
    branch,
  };
}

export async function readGitignore(
  input: { path?: string },
  context: ToolContext,
): Promise<{ path: string; content: string }> {
  const requestedPath = input.path ?? ".gitignore";
  if (basename(requestedPath) !== ".gitignore") {
    throw new Error("read_gitignore only reads files named .gitignore");
  }

  const path = await resolveAllowedExistingPath(requestedPath, context.cwd, [context.root]);
  return {
    path,
    content: await readFile(path, "utf8"),
  };
}

export async function copyWorkspaceFile(
  input: CopyWorkspaceFileInput,
  context: ToolContext,
): Promise<CopyWorkspaceFileResult> {
  const root = assertAllowedExistingPath(context.root, [context.root]);
  const source = await resolveAllowedExistingPath(input.source, context.cwd, [context.root]);
  const target = await resolveAllowedProspectivePath(input.target, context.cwd, [context.root]);
  const exists = await fileExists(target);

  if (exists && !input.overwrite) {
    return {
      source: workspaceRelativePath(source, root),
      target: workspaceRelativePath(target, root),
      status: "exists",
    };
  }

  await copyFile(source, target, input.overwrite ? 0 : constants.COPYFILE_EXCL);
  return {
    source: workspaceRelativePath(source, root),
    target: workspaceRelativePath(target, root),
    status: exists ? "overwritten" : "copied",
  };
}

export async function gitCheckIgnore(
  input: GitCheckIgnoreInput,
  context: ToolContext,
): Promise<GitCheckIgnoreResult> {
  if (input.paths.length === 0) {
    throw new Error("git_check_ignore requires at least one path");
  }

  const eligibility = await getGitEligibility(context.cwd);
  if (!eligibility.ok || !eligibility.gitRoot) {
    throw new Error(eligibility.message ?? "workspace is not inside a Git repository");
  }

  const gitRoot = assertAllowedExistingPath(eligibility.gitRoot, [context.root]);
  const workspacePaths = await Promise.all(
    input.paths.map(async (path) => {
      const absolutePath = await resolveAllowedProspectivePath(path, context.cwd, [context.root]);
      return workspaceRelativePath(absolutePath, gitRoot);
    }),
  );
  const output = await runGitCheckIgnore(gitRoot, workspacePaths);
  const ignored = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const ignoredSet = new Set(ignored);

  return {
    gitRoot,
    ignored,
    notIgnored: workspacePaths.filter((path) => !ignoredSet.has(path)),
    output,
  };
}

export type CloudflareStagingFile = "wrangler" | "devVars";

export interface PrepareCloudflareStagingInput {
  files?: CloudflareStagingFile[];
}

export interface PreparedCloudflareStagingFile {
  key: CloudflareStagingFile;
  source: string;
  target: string;
  status: "created" | "exists";
}

export interface PrepareCloudflareStagingResult {
  files: PreparedCloudflareStagingFile[];
}

const CLOUDFLARE_STAGING_FILES: Record<
  CloudflareStagingFile,
  { source: string; target: string }
> = {
  wrangler: {
    source: "cloudflare/worker/wrangler.staging.example.toml",
    target: "cloudflare/worker/wrangler.staging.local.toml",
  },
  devVars: {
    source: "cloudflare/worker/.dev.vars.staging.example",
    target: "cloudflare/worker/.dev.vars.staging",
  },
};

export async function prepareCloudflareStaging(
  input: PrepareCloudflareStagingInput,
  context: ToolContext,
): Promise<PrepareCloudflareStagingResult> {
  const requestedFiles = input.files && input.files.length > 0
    ? uniqueFiles(input.files)
    : (Object.keys(CLOUDFLARE_STAGING_FILES) as CloudflareStagingFile[]);
  const files: PreparedCloudflareStagingFile[] = [];

  for (const key of requestedFiles) {
    const entry = CLOUDFLARE_STAGING_FILES[key];
    const source = await resolveAllowedExistingPath(entry.source, context.cwd, [context.root]);
    const target = await resolveAllowedProspectivePath(entry.target, context.cwd, [context.root]);
    const exists = await fileExists(target);

    if (exists) {
      files.push({ key, source: entry.source, target: entry.target, status: "exists" });
      continue;
    }

    await copyFile(source, target, constants.COPYFILE_EXCL);
    files.push({
      key,
      source: entry.source,
      target: entry.target,
      status: "created",
    });
  }

  return { files };
}

export function formatGitPreflight(result: GitPreflightResult): string {
  return [
    "Git preflight",
    `Git root: ${result.gitRoot}`,
    `Current branch: ${result.branch || "(detached)"}`,
    `HEAD: ${result.head}`,
    result.remoteTrackingRef
      ? `${result.remoteTrackingRef}: ${result.remoteHead ?? "(unavailable)"}`
      : undefined,
    result.fetchedRemote ? `Fetched remote: ${result.fetchedRemote}` : undefined,
    result.fetchOutput ? `Fetch output:\n${result.fetchOutput}` : undefined,
    "Status:",
    result.status || "(clean)",
  ].filter(Boolean).join("\n");
}

export function formatPreparedCloudflareStaging(result: PrepareCloudflareStagingResult): string {
  const lines = result.files.map((file) => `${file.status}: ${file.target} from ${file.source}`);
  return ["Cloudflare local staging files", ...lines].join("\n");
}

export function formatGitCheckIgnore(result: GitCheckIgnoreResult): string {
  return [
    "Git check-ignore",
    `Git root: ${result.gitRoot}`,
    result.ignored.length > 0
      ? `Ignored:\n${result.ignored.map((path) => `- ${path}`).join("\n")}`
      : "Ignored: (none)",
    result.notIgnored.length > 0
      ? `Not ignored:\n${result.notIgnored.map((path) => `- ${path}`).join("\n")}`
      : "Not ignored: (none)",
  ].join("\n");
}

function uniqueFiles(files: CloudflareStagingFile[]): CloudflareStagingFile[] {
  return Array.from(new Set(files));
}

function assertSafeGitRemote(remote: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(remote) || remote.startsWith("-")) {
    throw new Error(`Unsafe Git remote name: ${remote}`);
  }
}

function assertSafeGitRef(ref: string): void {
  if (
    !/^[A-Za-z0-9._/-]+$/.test(ref) ||
    ref.startsWith("-") ||
    ref.includes("..") ||
    ref.includes("@{") ||
    ref.includes("//") ||
    ref.includes(`\\`) ||
    ref.endsWith("/") ||
    ref.endsWith(".lock")
  ) {
    throw new Error(`Unsafe Git ref: ${ref}`);
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function runGitCheckIgnore(gitRoot: string, paths: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["check-ignore", "--", ...paths], {
      cwd: gitRoot,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trimEnd();
  } catch (error) {
    if (isExitCode(error, 1)) {
      return "";
    }
    throw error;
  }
}

function isExitCode(error: unknown, code: number): boolean {
  return Boolean(
    typeof error === "object" &&
      error &&
      "code" in error &&
      (error as { code?: unknown }).code === code,
  );
}

export function workspaceRelativePath(path: string, root: string): string {
  const relationship = relative(root, path);
  if (
    relationship === "" ||
    relationship.startsWith("..") ||
    relationship === ".." ||
    relationship.includes(`..${sep}`)
  ) {
    return path.split(sep).join("/");
  }

  return relationship.split(sep).join("/");
}
