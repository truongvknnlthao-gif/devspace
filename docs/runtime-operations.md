# Runtime Operations

Use this guide for DevSpace runtime builds, releases, upgrades, rollback,
durable-job recovery, and post-release cleanup. Read the general workflow and
security documents first when the task also changes MCP behavior or authority.

## Operating Principle

DevSpace is often used to modify DevSpace itself. The currently serving runtime
must therefore remain recoverable throughout an upgrade.

Do not build over, delete, or partially replace the directory used by the active
process. Prepare an independent candidate, validate it, publish an immutable
release directory, and switch only after rollback is ready.

Reliability changes execution lifetime, not authority. A durable job runs as the
same owner-approved DevSpace operating-system user as synchronous `bash`.

## Canonical Current State

Project instructions and operational documentation describe the latest effective
state. When a newer explicit decision replaces an older rule, update the
canonical text and remove the superseded version. Do not keep duplicate guidance,
obsolete uncommitted patches, local audit archives, or narrative timelines merely
to show how the project evolved.

Use Git commits, pull requests, and release tags for committed history. Keep local
runtime artifacts only when they are required by the current recovery plan.

## Short Commands And Durable Jobs

Use synchronous `bash` for fast, low-latency commands that should complete within
one connector request.

Use the durable job tools for builds, tests, deployments, migrations, downloads,
package installation, large copies, or any operation likely to outlive a request:

1. Call `bash_start` with a stable, unique `requestId`.
2. Save the returned `jobId`.
3. Poll with `bash_status`.
4. Read logs with `bash_logs`, passing `nextCursor` back as the next `cursor`.
5. Use `bash_cancel` when the whole process group must stop.
6. Use `bash_jobs` after reconnecting to recover active or recent work.

A repeated submission with the same `requestId` must return the existing
`jobId`. Use a new ID only when a second execution is intentional.

## Handling Connector Errors

A 502, tunnel error, client timeout, or dropped MCP session does not prove that
the local command stopped.

After an error:

1. Do not immediately resubmit the command.
2. Query `bash_jobs` or `bash_status` when a durable job was used.
3. Otherwise inspect the original process, output file, PID file, or status file.
4. Continue from the existing `jobId` and log cursor.
5. Resubmit with the same `requestId` only when the client must recover the
   original job reference.

This rule prevents duplicate builds, deployments, migrations, and destructive
operations when the connector fails before returning the local result.

## Runtime Identity

`/healthz` is the source of truth for the process currently serving DevSpace. It
should expose at least:

- version
- source commit used for the build
- build time
- process start time
- PID
- active durable-job count

Record the complete health response before and after an upgrade. Do not infer the
running version from a checkout, branch name, package file, or symlink alone.

## Release Layout

Use versioned, immutable runtime directories. A typical layout is:

```text
$HOME/.local/share/
├── devspace-runtime -> devspace-releases/<version>-<commit>
├── devspace-releases/
│   ├── <previous-version>-<commit>/
│   └── <candidate-version>-<commit>/
└── devspace-runtime.pre-<release>-<timestamp>/
```

The stable path used by launchd or another service manager should be the
`devspace-runtime` symlink. Do not point the service directly at a mutable source
checkout.

Sanitized LaunchAgent, wrapper, and Cloudflare Tunnel examples are available in
[`deploy/macos`](../deploy/macos/README.md). Render them outside the repository
and never commit machine-specific paths, tunnel identity, or credentials.

## Safe Upgrade Workflow

### 1. Inspect The Current Runtime

Record:

- current `/healthz`
- active runtime symlink target
- service-manager state
- active jobs
- available disk space
- current rollback assets

Do not begin a switch while an unrelated active job is running unless the job is
known to survive and the upgrade specifically tests that behavior.

### 2. Build In An Independent Worktree

Create a clean worktree from the intended base. Do not mix runtime work with
uncommitted changes from another branch.

Run the normal validation suite:

```bash
npm run typecheck
npm test
npm run build
```

Native dependencies such as `better-sqlite3` must be built for the same Node ABI
used by the service runtime.

### 3. Start A Candidate On A Separate Port

Use a separate port and state directory. Validate:

- `/healthz` identity
- OAuth and host boundaries
- real MCP initialization
- expected tool list
- ordinary short shell commands
- durable-job start, status, logs, cancellation, and listing
- duplicate `requestId` handling
- server restart while a detached job continues

The candidate must not share temporary build directories with another build.

### 4. Publish An Immutable Release

Copy or clone the validated candidate into a new versioned release directory.
Use a unique temporary destination and rename it only after verification.

Verify the release directory independently from the worktree. Start it once on a
non-production port to prove that it does not rely on the development checkout.

### 5. Prepare Rollback Before Switching

Create and verify:

- the previous release target
- an exact copy or reference to the pre-switch runtime
- a rollback script
- a deployment status directory
- preflight and post-switch health checks

The switch process must run independently of the DevSpace process being
restarted. A launchd job or equivalent external supervisor is appropriate.

### 6. Switch Atomically

Change the stable runtime symlink atomically, restart the service once, and wait
for the expected version, commit, port, and authentication behavior.

If any required check fails within the defined window, restore the previous
runtime target and restart automatically.

Do not treat a temporary connector failure during the restart window as proof of
upgrade failure. Read the external switch status and local health result.

### 7. Avoid Unnecessary Redeployment After Merge

A squash merge creates a new commit ID even when the merged file tree is exactly
the tree that was already built and deployed.

Compare Git tree IDs. When the merged `main` tree matches the validated candidate
tree, the existing runtime does not need another build or restart merely because
the commit ID changed. Preserve the original build commit in `/healthz` and link
it to the merged release through the tag and deployment record.

When source code changes after a release, build the next candidate from the exact
intended commit. Do not relabel an older runtime or infer that it serves the new
commit merely because the package version or active branch changed.

## Rollback

Keep rollback simple and independent:

1. point `devspace-runtime` back to the previous verified release or exact
   pre-switch backup;
2. restart the service;
3. wait for `/healthz`;
4. verify version, port, OAuth behavior, and the MCP tool surface;
5. record the rollback result.

Never delete the rollback script or its target during the same operation that
activates a new release.

## Cleanup Policy

Cleanup happens in two passes.

### First Pass: After Approval And Freeze

Safe to remove:

- candidate processes and candidate ports
- candidate-only state directories
- abandoned or partial release copies
- completed test jobs that no longer aid diagnosis
- temporary build and copy directories
- merged feature worktrees and local feature branches
- obsolete uncommitted patch archives and stale audit bundles
- intermediate switch scripts, logs, and cleanup timelines that are not needed
  by the active rollback procedure

Also fast-forward the local `main` reference to `origin/main` without disturbing
an unrelated dirty checkout.

Keep only the assets named by the current rollback plan:

- the active release
- the selected rollback release or exact pre-switch backup
- the tested rollback script and its required target reference
- the minimal final health or deployment state needed to verify recovery

Verify `/healthz` after cleanup. Do not keep a separate cleanup narrative once
the resulting state is clear and the cleanup has succeeded.

### Second Pass: After Real-Use Observation

After the new release has handled several real long-running jobs and no recovery
issues have appeared, update the current rollback plan and remove every runtime
copy, backup, log, or deployment artifact that the plan no longer references.
Retain only the active release, the currently selected rollback target when one is
still required, the release tag, and a tested rollback procedure.

## Project Boundaries

DevSpace core should expose general local capabilities. Do not accumulate
hard-coded helpers for a single product, repository, cloud account, bot, or
service. Keep such workflows in their owning repository or package them as a
separate plugin.

The approved client is already inside the DevSpace trust boundary. Reliability
must come from idempotency, durable state, process management, observable health,
and rollback—not from additional command or destination restrictions.
