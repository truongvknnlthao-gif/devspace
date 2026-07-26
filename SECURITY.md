# Security Policy

## Supported Version

Security fixes target the current `main` branch and the latest fork release.
Older releases are unsupported once a replacement is published.

## Reporting A Vulnerability

Use the repository's
[private vulnerability report](https://github.com/truongvknnlthao-gif/devspace/security/advisories/new).
Do not publish Owner passwords, OAuth tokens, tunnel credentials, machine paths,
or exploit details in a public issue.

Include the affected version or commit, the relevant trust boundary, a minimal
reproduction, and the expected impact. Reports are evaluated against the
single-owner deployment model described in
[docs/security.md](./docs/security.md).

## Trust Boundary

DevSpace is remote access to the operating-system user that runs it. OAuth
approval, redirect/host validation, HTTPS transport, and operating-system
permissions are security boundaries. When shell execution is enabled, workspace
roots organize structured file access but do not sandbox the shell.

Reliability features such as durable jobs and MCP session cleanup do not add
permissions. Dependency alerts and automated security-update pull requests
require an independent review before merge.
