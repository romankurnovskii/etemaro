# Build & Release Desktop Application via GitHub Actions

This document describes the release workflow for the Etemaro desktop application. The implementation lives in `.github/workflows/release-desktop.yml`. This page only explains the design and required secrets.

---

## 1. Secrets

| Secret          | Purpose                                               |
| --------------- | ----------------------------------------------------- |
| `SUBMODULE_PAT` | PAT for cloning the private `apps/desktop` submodule. |

macOS code-signing secrets are **not required** for now. Unsigned macOS builds are produced by default.

---

## 2. Design

- **Release first**: `create_release` creates a draft release before any build starts.
- **Parallel platform jobs**: `build_macos`, `build_windows`, `build_linux` run in parallel.
- **Failure tolerant**: Each platform job uses `continue-on-error: true`.
- **Aggregated result**: `aggregate_results` succeeds if at least one platform builds; otherwise fails. It updates the release body with built platforms and warnings.

---

## 3. Required runner packages

Ubuntu runner installs: `libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf`.
