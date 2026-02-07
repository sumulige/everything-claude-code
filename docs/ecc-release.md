# ECC Release Guide

This repo ships ECC as a Node CLI with an optional Rust kernel (`ecc-kernel`).

The release chain is designed to make installs reliable:
- Tag push builds and uploads prebuilt kernels to a GitHub Release
- npm publish validates those assets exist (so installs can download them)
- Release smoke tests validate real install + download + run across OSes

---

## Versioning

- `package.json.version` must match the git tag: `v${version}`
- Use patch bumps by default.

---

## Release Steps (vX.Y.Z)

1. Ensure `main` is green (CI passes).
2. Bump version (on `main`):

   ```bash
   npm version patch --no-git-tag-version
   ```

3. Commit:

   ```bash
   git commit -am "chore(release): vX.Y.Z"
   ```

4. Tag + push:

   ```bash
   git tag vX.Y.Z
   git push origin main
   git push origin vX.Y.Z
   ```

5. Verify GitHub Release:
- Workflow: `.github/workflows/release.yml`
- Assets must include `ecc-kernel-<os>-<arch>[.exe]` plus `.sha256` files.

6. Verify Release Smoke:
- Workflow: `.github/workflows/release-smoke.yml`
- Runs a real install from a packed tarball and exercises:
  - `ECC_KERNEL_INSTALL=required` + `ECC_KERNEL=rust`
  - `ECC_KERNEL_INSTALL=0` + `ECC_KERNEL=node`

7. Publish to npm:
- Workflow: `.github/workflows/publish-npm.yml`
- Uses npm Trusted Publishing (OIDC) if configured, with optional `NPM_TOKEN` fallback.

---

## Troubleshooting

### Release created but assets missing / 404 during install
- Kernel upload can be briefly eventual-consistent.
- Re-run smoke (workflow_dispatch) after a minute:

  ```bash
  gh workflow run "Release Smoke" -f tag=vX.Y.Z
  ```

### npm publish fails (OIDC not configured)
- Configure npm "Trusted Publisher" for:
  - owner: `sumulige`
  - repo: `ecc-conveyor`
  - workflow file: `publish-npm.yml`
- Re-run publish:

  ```bash
  gh workflow run "Publish (npm)" -f tag=vX.Y.Z
  ```

### Rollback
- If a bad version is published to npm: publish a new patch version.
- If a GitHub Release is broken: re-run `Release` workflow for the same tag, or create a new tag.

