# ecc-kernel Protocol

`ecc-kernel` is a small Rust binary that offloads ECC "kernel" operations:
- git worktree creation/removal
- safe patch apply with ownership checks
- verify command runner (writes evidence files)

All commands use:
- **stdin**: JSON
- **stdout**: JSON
- **stderr**: human-readable diagnostics

---

## Versioning and Compatibility

- Node and kernel communicate via a protocol handshake.
- Node expects `protocol=1` and the required command set.
- `ECC_KERNEL=auto` falls back to JS if handshake fails.
- `ECC_KERNEL=rust` fails fast if handshake fails.

---

## Command: `protocol.version`

### Input (stdin JSON)

```json
{}
```

### Output (stdout JSON)

```json
{
  "version": 1,
  "protocol": 1,
  "kernelVersion": "0.1.0",
  "commands": [
    "worktree.ensure",
    "worktree.remove",
    "patch.apply",
    "git.commit_all",
    "verify.run",
    "protocol.version",
    "repo.info"
  ]
}
```

Fields:
- `version`: output schema version (currently `1`)
- `protocol`: protocol version (currently `1`)
- `kernelVersion`: Rust crate version
- `commands`: supported command identifiers

---

## Command: `repo.info`

Returns git repo information for a given `cwd`.

### Input

```json
{ "cwd": "/path/to/dir" }
```

### Output (inside a git repo)

```json
{
  "version": 1,
  "repoRoot": "/path/to/repo",
  "branch": "main",
  "sha": "0123456789abcdef0123456789abcdef01234567",
  "clean": true
}
```

### Output (not a git repo)

```json
{
  "version": 1,
  "repoRoot": null,
  "branch": "",
  "sha": "",
  "clean": false
}
```

Notes:
- `clean` ignores untracked files (equivalent to `git status --porcelain --untracked-files=no`).

---

## Other Commands

The remaining commands are internal engine plumbing and are documented by source:
- `worktree.ensure`
- `worktree.remove`
- `patch.apply`
- `git.commit_all`
- `verify.run`
