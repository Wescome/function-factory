# Pattern: Missing System Dependencies in Container Image

## Problem
A Go binary embeds shell scripts that call external CLI tools (`git`, `bd`,
`dolt`, `bun`, etc.). The Container image doesn't include those tools. The
script runs, hits `command not found`, and the service fails with a vague
`exec beads start` or similar error that doesn't name the missing binary.

## Root Cause
The Go binary's embedded scripts were written and tested in a full development
environment where these tools are present. The Container image is a minimal
Debian base. The Dockerfile never explicitly listed the tool as a dependency
because it wasn't part of the primary `apt-get` install or the explicit binary
download block.

## Solution
1. **Read the error message all the way.** The shell script error is usually
   buried in a city status `.error` field: look for `command not found` or
   `not found` after the script name.
2. **Trace back to the upstream `deps.env`** — `gastownhall/gascity/deps.env`
   lists `BD_VERSION`, `BR_VERSION`, and similar. Every entry there is a
   required binary. If it's in `deps.env`, it must be in the Dockerfile.
3. **Add missing tools to the Dockerfile's apt-get or curl block** — match the
   version from `deps.env`. For Go-distributed binaries (like `bd`), download
   from the GitHub releases page using the same `linux_amd64.tar.gz` pattern.

## Reference pattern for Dockerfile additions
```dockerfile
# bd — beads CLI required by gc-beads-bd.sh (bd provider bead store management).
&& BD_VERSION=1.0.4 \
&& curl -fsSL "https://github.com/gastownhall/beads/releases/download/v${BD_VERSION}/beads_${BD_VERSION}_linux_amd64.tar.gz" \
   | tar -xz -C /usr/local/bin bd \
```

## Diagnostic
```bash
# City error field will contain the script path and "not found" signal:
curl ... | jq '.items[].error'
# e.g.: "gc-beads-bd: setting git config --global beads.role maintainer\n
#        /path/to/gc-beads-bd.sh: 1646: git: not found\n
#        failed to set git config beads.role"
```

## Known Instances
- **2026-05-30 — `git` missing** — `gc-beads-bd.sh` calls `git config --global
  beads.role maintainer` during bead store init. Container had no `git`.
  Fix: `git` added to apt-get install block.
- **2026-05-30 — `bd` missing** — `gc-beads-bd.sh` calls `bd init` to
  initialize the Dolt-backed bead store. Container had no `bd` CLI.
  Fix: `bd v1.0.4` from `gastownhall/beads` releases added to Dockerfile.

## Required binaries for gascity-supervisor Container (as of 2026-05-30)
| Binary | Source | Required by |
|--------|--------|-------------|
| `dolt` 2.0.3 | dolthub/dolt releases | gc bd provider |
| `git` | apt-get | gc-beads-bd.sh |
| `bd` 1.0.4 | gastownhall/beads releases | gc-beads-bd.sh |
| `bun` 1.3.13 | oven-sh/bun releases | fidelity-release.sh |
| `gc` (fork) | Wescome/gascity eai/cloudflare | supervisor |

## See Also
- `.agent/patterns/container-tool-version-mismatch.md` — version mismatch is the sibling problem
