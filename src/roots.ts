import { realpathSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, relative, resolve, sep } from "node:path";

export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export function expandHomePath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return resolve(homedir(), path.slice(2));
  }

  return path;
}

export function isPathInsideRoot(path: string, root: string): boolean {
  const resolvedPath = resolve(expandHomePath(path));
  const resolvedRoot = resolve(expandHomePath(root));
  const relationship = relative(resolvedRoot, resolvedPath);

  return (
    relationship === "" ||
    (!relationship.startsWith("..") && relationship !== ".." && !relationship.includes(`..${sep}`))
  );
}

export function assertAllowedPath(path: string, allowedRoots: string[]): string {
  const resolvedPath = resolve(expandHomePath(path));
  if (allowedRoots.some((root) => isPathInsideRoot(resolvedPath, root))) {
    return resolvedPath;
  }

  throw new AccessDeniedError(`Path is outside allowed roots: ${path}`);
}

export function resolveAllowedPath(inputPath: string, cwd: string, allowedRoots: string[]): string {
  const absolutePath = resolve(cwd, inputPath);
  return assertAllowedPath(absolutePath, allowedRoots);
}

export function assertAllowedExistingPath(path: string, allowedRoots: string[]): string {
  const logicalPath = resolve(expandHomePath(path));
  let canonicalPath: string;

  try {
    canonicalPath = realpathSync(logicalPath);
  } catch {
    throw new AccessDeniedError(`Path does not exist or cannot be resolved safely: ${path}`);
  }

  return assertCanonicalPathAllowed(logicalPath, canonicalPath, allowedRoots);
}

export async function resolveAllowedExistingPath(
  inputPath: string,
  cwd: string,
  allowedRoots: string[],
): Promise<string> {
  const logicalPath = resolve(cwd, inputPath);
  let canonicalPath: string;

  try {
    canonicalPath = await realpath(logicalPath);
  } catch {
    throw new AccessDeniedError(`Path does not exist or cannot be resolved safely: ${inputPath}`);
  }

  return assertCanonicalPathAllowed(logicalPath, canonicalPath, allowedRoots);
}

export async function resolveAllowedProspectivePath(
  inputPath: string,
  cwd: string,
  allowedRoots: string[],
): Promise<string> {
  const logicalPath = resolve(cwd, inputPath);
  const canonicalPath = await canonicalizeProspectivePath(logicalPath);
  return assertCanonicalPathAllowed(logicalPath, canonicalPath, allowedRoots);
}

function assertCanonicalPathAllowed(
  logicalPath: string,
  canonicalPath: string,
  allowedRoots: string[],
): string {
  for (const allowedRoot of allowedRoots) {
    const logicalRoot = resolve(expandHomePath(allowedRoot));

    let canonicalRoot: string;
    try {
      canonicalRoot = realpathSync(logicalRoot);
    } catch {
      continue;
    }

    if (isPathInsideRoot(canonicalPath, canonicalRoot)) {
      return canonicalPath;
    }
  }

  throw new AccessDeniedError(`Path escapes allowed roots through a symbolic link: ${logicalPath}`);
}

async function canonicalizeProspectivePath(path: string): Promise<string> {
  const missingSegments: string[] = [];
  let candidate = path;

  while (true) {
    try {
      const stats = await lstat(candidate);
      if (stats.isSymbolicLink()) {
        try {
          return resolve(await realpath(candidate), ...missingSegments);
        } catch {
          throw new AccessDeniedError(`Unresolvable symbolic link in path: ${candidate}`);
        }
      }

      return resolve(await realpath(candidate), ...missingSegments);
    } catch (error) {
      if (error instanceof AccessDeniedError) throw error;
      if (!isMissingPathError(error)) {
        throw new AccessDeniedError(`Path cannot be resolved safely: ${path}`);
      }

      const parent = dirname(candidate);
      if (parent === candidate) {
        throw new AccessDeniedError(`Path cannot be resolved safely: ${path}`);
      }
      missingSegments.unshift(basename(candidate));
      candidate = parent;
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(
    typeof error === "object" &&
      error &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT",
  );
}
