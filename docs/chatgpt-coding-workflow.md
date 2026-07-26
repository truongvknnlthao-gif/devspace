# ChatGPT Coding Workflow

DevSpace brings a Codex-style coding-agent loop to ChatGPT and other MCP hosts:
inspect the repo, follow local instructions, make scoped edits, run
verification, and show the user what changed.

## Open One Workspace

ChatGPT should call `open_workspace` once for a project folder:

```json
{
  "path": "~/work/my-project"
}
```

The result includes a `workspaceId`. All later file, search, edit, show-changes,
and shell calls should reuse that same `workspaceId`.

Do not reopen the same folder unless:

- the `workspaceId` is rejected as unknown
- the user switches to another folder
- the user switches between checkout and worktree mode
- the user explicitly asks to reopen

## Checkout Mode

Checkout mode is the default. DevSpace opens the actual directory:

```json
{
  "path": "~/work/my-project"
}
```

Use this when the user wants ChatGPT to work in the current checkout.

## Worktree Mode

Use worktree mode for isolated parallel work:

```json
{
  "path": "~/work/my-project",
  "mode": "worktree"
}
```

Managed worktrees are created under:

```text
~/.devspace/worktrees
```

Worktree mode requires a Git repository with at least one commit. It starts from
`HEAD` unless `baseRef` is provided.

Uncommitted source checkout changes are not copied into the managed worktree.
DevSpace reports when the source checkout was dirty so the model can decide how
to proceed with the user.

## Project Instructions

When a workspace opens, DevSpace loads root-level instruction files:

- `AGENTS.md`
- `AGENTS.MD`
- `CLAUDE.md`
- `CLAUDE.MD`

Nested instruction files are returned as `availableAgentsFiles`. The model
should read the relevant nested file before working under that directory.

This keeps instructions explicit and inspectable instead of silently injecting
new context during later tool calls.

## Tool Surface

DevSpace uses one canonical short-name surface:

- `open_workspace`
- `read`, `write`, and `edit`
- `grep`, `glob`, and `ls`
- `bash`, `bash_start`, `bash_status`, `bash_logs`, `bash_cancel`, and
  `bash_jobs` when shell execution is enabled
- `chrome_status`, `chrome_task_start`, `chrome_task_status`, and
  `chrome_task_cancel` when supervised Chrome control is enabled
- `show_changes` when `DEVSPACE_WIDGETS=changes`

Use the structured file and search tools when they make the operation clearer.
Use `bash` for complete terminal workflows rather than adding narrow wrappers.

## Show Changes

By default, `DEVSPACE_WIDGETS=full`.

In that mode, DevSpace attaches widget UI to the exposed workspace, file, edit,
and shell tools. The aggregate `show_changes` tool is not exposed by default.

Use `DEVSPACE_WIDGETS=off` to disable widget UI, or `DEVSPACE_WIDGETS=changes`
to expose the aggregate show-changes flow.

## Shell Use

The shell tool is for commands that belong in a terminal:

- tests
- builds
- Git and GitHub CLI workflows
- package scripts
- code generation
- development servers
- ordinary command-line file operations
- environment checks

The edit/write tools remain useful for precise changes and review cards, but
they are not a restriction on shell usage.

## Chrome Through DevSpace

When a workflow depends on the user's existing Chrome login state, keep
DevSpace as the single control plane:

1. Call `chrome_status` and require `ready: true`.
2. Call `chrome_task_start` once with the complete desired result, boundaries,
   a stable `requestId`, and `mode=observe` or `mode=act`.
3. Save the returned `taskId`.
4. Poll `chrome_task_status` until it is terminal.
5. Use `chrome_task_cancel` if the user stops the workflow.

Internally the route is:

```text
ChatGPT Web
  -> DevSpace OAuth and Chrome task manager
  -> local Codex CLI
  -> official Chrome plugin and native host
  -> official Chrome extension
  -> the user's Chrome session
```

Submit one high-level workflow instead of remote click/type calls. This keeps
session setup, retries, timeouts, cancellation, and final-result filtering
inside DevSpace while allowing the official Chrome component to perform the
browser interaction.

## macOS Action Order

Use the most structured interface that can complete and verify the task:

1. Use DevSpace file tools for workspace reads and precise edits.
2. Use `bash` with an application-specific CLI or a deterministic macOS command
   such as `open`, `osascript`, `shortcuts`, or `defaults`.
3. For the user's existing Chrome session, use the supervised DevSpace Chrome
   task tools; for other matching connectors, use their semantic APIs.
4. Use `screen_capture` to observe or verify visible state when command output
   is insufficient.
5. Use Accessibility actions, simulated mouse input, or simulated keyboard
   input only when the application exposes no reliable structured interface.

For directories outside the configured workspace roots, structured file tools
remain unavailable. An owner-approved client may use enabled shell execution
with the permissions of the DevSpace operating-system user.

## Durable Shell Jobs

Use synchronous `bash` for short commands that are expected to finish within one
connector request. Use durable jobs for builds, tests, deployments, migrations,
downloads, or any command that may run for more than a few seconds:

1. Call `bash_start` with the workspace, command, and a stable `requestId`.
2. Save the returned `jobId`.
3. Poll `bash_status` and read incremental output with `bash_logs`.
4. Pass `nextCursor` back to `bash_logs` to avoid repeating previous output.
5. Use `bash_cancel` to terminate the whole process group.
6. After reconnecting, use `bash_jobs` to recover active or recent jobs.

`requestId` is an idempotency key, not a permission boundary. Retrying the same
intended execution with the same ID returns the existing job. Use a new ID when
you intentionally want to run the same command again.

Jobs are stored under the configured DevSpace state directory and run through a
small detached runner. They continue if the MCP request, client session, tunnel,
or DevSpace server process disconnects. The next server process can read their
status and logs.
