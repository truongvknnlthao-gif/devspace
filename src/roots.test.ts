import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assertAllowedPath,
  expandHomePath,
  resolveAllowedExistingPath,
  resolveAllowedPath,
  resolveAllowedProspectivePath,
} from "./roots.js";

const home = homedir();

assert.equal(expandHomePath("~"), home);
assert.equal(expandHomePath("~/personal/devspace"), resolve(home, "personal", "devspace"));
assert.equal(expandHomePath("~user/project"), "~user/project");
assert.equal(expandHomePath("$HOME/project"), "$HOME/project");

assert.equal(
  assertAllowedPath("~/personal/devspace", [join(home, "personal")]),
  resolve(home, "personal", "devspace"),
);

assert.equal(
  assertAllowedPath("~/personal/devspace", ["~/personal"]),
  resolve(home, "personal", "devspace"),
);

assert.equal(
  resolveAllowedPath("~/file.txt", "/workspace", ["/workspace"]),
  resolve("/workspace", "~/file.txt"),
);

const fixture = await mkdtemp(join(tmpdir(), "devspace-roots-test-"));
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
    resolveAllowedExistingPath("escape/outside.txt", allowedRoot, [allowedRoot]),
    /escapes allowed roots through a symbolic link/,
  );
  await assert.rejects(
    resolveAllowedProspectivePath("escape/new.txt", allowedRoot, [allowedRoot]),
    /escapes allowed roots through a symbolic link/,
  );
  await assert.rejects(
    resolveAllowedProspectivePath("dangling-file", allowedRoot, [allowedRoot]),
    /Unresolvable symbolic link/,
  );

  assert.equal(
    await resolveAllowedProspectivePath("nested/new.txt", allowedRoot, [allowedRoot]),
    join(await realpath(allowedRoot), "nested", "new.txt"),
  );
} finally {
  await rm(fixture, { recursive: true, force: true });
}
