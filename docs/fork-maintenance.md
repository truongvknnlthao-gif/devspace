# Fork Maintenance

This repository is an independently maintained macOS-focused fork of
[`Waishnav/devspace`](https://github.com/Waishnav/devspace). The upstream
repository is a reference and patch source, not a runtime dependency or an
automatic source of changes.

## Policy

- Keep Git history, the MIT license, original copyright, and concise upstream
  attribution.
- Keep the `upstream` remote fetchable but disable its push URL locally.
- Do not configure automatic upstream synchronization.
- Do not merge or rebase the complete upstream branch into this fork.
- Review individual upstream security and reliability fixes, then port the
  smallest relevant change with attribution and fork-specific tests.
- Do not import upstream local-subagent providers, extra SDK/CLI adapters, or
  other architecture that conflicts with DevSpace's direct-execution mission.

The fork's durable jobs, runtime identity, immutable releases, and rollback
workflow were added after it diverged. Upstream did not delete those features;
they simply do not exist in the upstream history. A whole-tree comparison can
make them appear as deletions, which is not evidence of an upstream removal
decision.

## Upstream Review

For each candidate upstream change:

1. Fetch without merging.
2. Identify the exact commit and the user-visible problem it solves.
3. Confirm that the problem exists in this fork.
4. Inspect new dependencies, authority, state, and tool-surface changes.
5. Port only the required code on an `agent/*` branch.
6. Add tests that prove the fork-specific behavior.
7. Run typecheck, tests, build, candidate health, and the relevant MCP/OAuth
   acceptance checks.
8. Merge only after the macOS CI checks pass.

## Dependency Security

GitHub vulnerability alerts and Dependabot security updates are discovery
mechanisms, not merge authority.

Every dependency security pull request must receive an independent subagent
review that:

- verifies the advisory and complete dependency path
- rejects audit suggestions that require an unrelated downgrade
- identifies API, native ABI, OAuth/MCP, shell, database, and UI risks
- confirms that only dependency manifests and lockfiles changed
- gives an explicit approve or reject result after CI

Do not auto-merge Dependabot pull requests based only on labels or a green
installation step.

Published dependency shrinkwrap files can prevent root-level `overrides` from
changing nested packages. Treat an override as ineffective unless a clean
`npm ci`, `npm ls`, and `npm audit --omit=dev` all show the patched version.
Never use `npm audit fix --force` when it proposes an unrelated SDK downgrade.

## Instruction File Symlinks

An untrusted repository could point a root `AGENTS.md` symlink at another
readable file and cause its contents to be loaded as instructions. A blanket
realpath boundary check would also reject legitimate setups that deliberately
share instructions from a central directory, and it can change path identity,
deduplication, and file-watching behavior.

The current single-owner deployment therefore does not import upstream's blanket
symlink rejection. Revisit this only if the service moves to narrower workspace
roots or multiple trust domains. Any future change should support explicit
trusted instruction roots and test both intentional shared links and escaped
repository-controlled links.

## Release Identity

The source package version, Git tag, GitHub Release, and `/healthz` commit should
describe the same candidate source. A deployed service may remain on an older
verified release until a separate atomic runtime switch is approved and
validated.
