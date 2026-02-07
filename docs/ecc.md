# ECC CLI (Engineering Change Conveyor)

ECC turns an "AI-assisted coding" request into a **replayable, auditable, verifiable** engineering workflow:

`init -> doctor -> plan -> exec -> verify -> run`

Core properties:
- **Code sovereignty**: providers output only structured JSON + unified diff patches; ECC applies patches.
- **Isolation**: `exec/verify` run in an **external git worktree**, so your main working tree is never polluted.
- **Evidence chain**: all artifacts are written under `.ecc/runs/<runId>/`.

---

## Install

### Option A: Run from source (this repo)

```bash
node scripts/ecc.js --help
```

## Rust Kernel (Optional, Low-Memory)

ECC can offload the heavy "kernel" operations (worktree / patch apply / verify command runner)
to a small Rust binary: `ecc-kernel`.

### Prebuilt (no Rust required)

When installed via npm, ECC runs a `postinstall` that tries to download a prebuilt `ecc-kernel`
from the GitHub release matching your `package.json` version tag (`vX.Y.Z`).

Controls:
- `ECC_KERNEL_INSTALL=0` disables download
- `ECC_KERNEL_INSTALL=required` fails install if download fails
- `ECC_KERNEL_BASE_URL=...` overrides download base URL

### Build From Source

Build it (from repo root):

```bash
cargo build --release --manifest-path crates/ecc-kernel/Cargo.toml
```

Then rerun `ecc`; `ecc doctor` will report `kernel: rust (...)`.

Environment:
- `ECC_KERNEL=auto|rust|node` (default: `auto`)
- `ECC_KERNEL_PATH=/absolute/path/to/ecc-kernel`

### Option B: Install as a CLI (global)

```bash
# from a local checkout path
npm install -g /path/to/everything-claude-code

ecc --help
```

### Option C: Install into a project (recommended)

```bash
# from a local checkout path
npm install -D /path/to/everything-claude-code

npx ecc --help
```

---

## Quickstart (Mock Provider)

Use the deterministic mock provider to validate the pipeline without calling Codex:

```bash
ecc init

ECC_PROVIDER=mock ECC_FIXTURE=basic ecc run "demo" --run-id demo
```

Artifacts:
- `.ecc/ecc.json`
- `.ecc/locks/registry.lock.json`
- `.ecc/runs/demo/` (plan, patches, apply evidence, verify evidence, report)

---

## Quickstart (Codex Provider)

Prereqs:
- `codex` installed and on `PATH`
- project is a git repo

```bash
ecc init
ecc doctor

ecc run "Add a hello endpoint" --run-id hello-endpoint
```

---

## Commands

```bash
ecc packs
ecc init [--backend codex|claude] [--packs a,b,c]
ecc doctor
ecc plan "<intent>" [--run-id <id>]
ecc exec <runId> [--worktree-root <path>] [--keep-worktree] [--commit]
ecc verify <runId> [--worktree-root <path>]
ecc run "<intent>" [--run-id <id>] [--worktree-root <path>] [--keep-worktree] [--commit]
```

Notes:
- `--commit` commits in the worktree **only after verify passes**.
- If a patch touches files outside a task's `allowedPathPrefixes`, `exec` **fails fast**.
