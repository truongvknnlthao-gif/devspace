import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  copyWorkspaceFile,
  gitCheckIgnore,
  prepareCloudflareStaging,
  readGitignore,
  runGitPreflight,
} from "./safe-workflows.js";

const execFileAsync = promisify(execFile);
const fixture = await mkdtemp(join(tmpdir(), "devspace-safe-workflows-"));
const repo = join(fixture, "repo");
const origin = join(fixture, "origin.git");

try {
  await mkdir(repo);
  await git(fixture, ["init", "--bare", origin]);
  await git(repo, ["init"]);
  await git(repo, ["config", "user.email", "devspace@example.com"]);
  await git(repo, ["config", "user.name", "DevSpace Test"]);
  await writeFile(join(repo, "README.md"), "hello\n");
  await writeFile(join(repo, ".gitignore"), ".dev.vars*\n*.local.toml\n");
  await writeFile(join(repo, ".env"), "SECRET=do-not-read\n");
  await git(repo, ["add", "README.md", ".gitignore"]);
  await git(repo, ["commit", "-m", "Initial commit"]);
  await git(repo, ["remote", "add", "origin", origin]);
  await git(repo, ["push", "origin", "HEAD:refs/heads/cloudflare/main"]);

  const preflight = await runGitPreflight(
    { fetch: true, remote: "origin", remoteTrackingRef: "origin/cloudflare/main" },
    { cwd: repo, root: repo },
  );
  assert.match(preflight.status, /^## /);
  assert.match(preflight.head, /^[0-9a-f]{40}$/);
  assert.match(preflight.remoteHead ?? "", /^[0-9a-f]{40}$/);

  await assert.rejects(
    runGitPreflight(
      { fetch: true, remote: "origin;wrangler", remoteTrackingRef: "origin/cloudflare/main" },
      { cwd: repo, root: repo },
    ),
    /Unsafe Git remote name/,
  );
  await assert.rejects(
    runGitPreflight(
      { remoteTrackingRef: "origin/cloudflare/main;wrangler deploy" },
      { cwd: repo, root: repo },
    ),
    /Unsafe Git ref/,
  );

  const gitignore = await readGitignore({}, { cwd: repo, root: repo });
  assert.equal(gitignore.content, ".dev.vars*\n*.local.toml\n");
  await assert.rejects(
    readGitignore({ path: ".env" }, { cwd: repo, root: repo }),
    /only reads files named \.gitignore/,
  );

  const worker = join(repo, "cloudflare", "worker");
  await mkdir(worker, { recursive: true });
  await writeFile(join(worker, "wrangler.staging.example.toml"), "name = \"staging\"\n");
  await writeFile(join(worker, ".dev.vars.staging.example"), "PLACEHOLDER=1\n");

  const copiedSecretLikeFile = await copyWorkspaceFile(
    {
      source: ".env",
      target: "cloudflare/worker/.dev.vars.secret-copy",
    },
    { cwd: repo, root: repo },
  );
  assert.deepEqual(copiedSecretLikeFile, {
    source: ".env",
    target: "cloudflare/worker/.dev.vars.secret-copy",
    status: "copied",
  });
  assert.equal(await readFile(join(worker, ".dev.vars.secret-copy"), "utf8"), "SECRET=do-not-read\n");

  const created = await prepareCloudflareStaging({}, { cwd: repo, root: repo });
  assert.deepEqual(
    created.files.map((file) => [file.key, file.status, file.target]),
    [
      ["wrangler", "created", "cloudflare/worker/wrangler.staging.local.toml"],
      ["devVars", "created", "cloudflare/worker/.dev.vars.staging"],
    ],
  );
  assert.equal(
    await readFile(join(worker, "wrangler.staging.local.toml"), "utf8"),
    "name = \"staging\"\n",
  );
  assert.equal(await readFile(join(worker, ".dev.vars.staging"), "utf8"), "PLACEHOLDER=1\n");

  const ignoreCheck = await gitCheckIgnore(
    {
      paths: [
        "cloudflare/worker/wrangler.staging.local.toml",
        "cloudflare/worker/.dev.vars.staging",
        "README.md",
      ],
    },
    { cwd: repo, root: repo },
  );
  assert.deepEqual(ignoreCheck.ignored, [
    "cloudflare/worker/wrangler.staging.local.toml",
    "cloudflare/worker/.dev.vars.staging",
  ]);
  assert.deepEqual(ignoreCheck.notIgnored, ["README.md"]);

  await writeFile(join(worker, "wrangler.staging.local.toml"), "local edit\n");
  const skipped = await prepareCloudflareStaging(
    { files: ["wrangler"] },
    { cwd: repo, root: repo },
  );
  assert.equal(skipped.files[0]?.status, "exists");
  assert.equal(await readFile(join(worker, "wrangler.staging.local.toml"), "utf8"), "local edit\n");
} finally {
  await rm(fixture, { recursive: true, force: true });
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}
