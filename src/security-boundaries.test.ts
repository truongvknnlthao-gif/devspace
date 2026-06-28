import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileTool, writeFileTool } from "./pi-tools.js";

const fixture = await mkdtemp(join(tmpdir(), "devspace-security-boundaries-"));
const allowedRoot = join(fixture, "allowed");
const outsideRoot = join(fixture, "outside");

try {
  await mkdir(allowedRoot);
  await mkdir(outsideRoot);
  await writeFile(join(outsideRoot, "outside.txt"), "outside\n");
  await symlink(outsideRoot, join(allowedRoot, "escape"));
  await symlink(
    join(outsideRoot, "future.txt"),
    join(allowedRoot, "dangling-file"),
  );

  await assert.rejects(
    readFileTool(
      { path: "escape/outside.txt" },
      { cwd: allowedRoot, root: allowedRoot },
    ),
    /escapes allowed roots through a symbolic link/,
  );
  await assert.rejects(
    writeFileTool(
      { path: "escape/new.txt", content: "escaped\n" },
      { cwd: allowedRoot, root: allowedRoot },
    ),
    /escapes allowed roots through a symbolic link/,
  );
  await assert.rejects(
    writeFileTool(
      { path: "dangling-file", content: "escaped\n" },
      { cwd: allowedRoot, root: allowedRoot },
    ),
    /Unresolvable symbolic link/,
  );

  const safeResult = await writeFileTool(
    { path: "safe.txt", content: "safe\n" },
    { cwd: allowedRoot, root: allowedRoot },
  );
  assert.equal(safeResult.isError, undefined);
  assert.equal(await readFile(join(allowedRoot, "safe.txt"), "utf8"), "safe\n");
  await assert.rejects(readFile(join(outsideRoot, "future.txt"), "utf8"));
} finally {
  await rm(fixture, { recursive: true, force: true });
}
