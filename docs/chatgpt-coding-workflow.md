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

## Skills

Skills are enabled by default for coding-agent workflows.

DevSpace discovers skills from:

- `DEVSPACE_AGENT_DIR`, which defaults to `~/.codex`
- project `.pi/skills`
- optional paths from `DEVSPACE_SKILL_PATHS`

When `open_workspace` returns matching skills, the model should read the
advertised `SKILL.md` before following that skill.

Skill paths may be outside the workspace. DevSpace only permits reading:

- advertised `SKILL.md` files
- files under a skill directory after that skill's `SKILL.md` has been read

Set `DEVSPACE_SKILLS=0` to hide skills from workspace output.

## Tool Names

Short names are the default:

- `open_workspace`
- `read`
- `write`
- `edit`
- `bash`

By default, DevSpace also runs in `DEVSPACE_TOOL_MODE=minimal`, so dedicated
`grep`, `glob`, and `ls` tools are hidden. Use `bash` with command-line tools
such as `rg`, `find`, and `ls` for search and directory inspection.

Legacy names are available with `DEVSPACE_TOOL_NAMING=legacy`:

- `open_workspace`
- `read_file`
- `write_file`
- `edit_file`
- `run_shell`

Use `DEVSPACE_TOOL_MODE=full` to restore dedicated search and directory tools.

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
