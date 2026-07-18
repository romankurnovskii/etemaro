# Build & Release Desktop Application via GitHub Actions

This guide explains how to configure a GitHub Actions workflow to build and release the Etemaro desktop application (`apps/desktop`) for macOS, Windows, and Linux.

---

## 1. Prerequisites & Secrets Configuration

Since `apps/desktop` is a submodule pointing to a private repository (`etemaro-desktop`), the GitHub Actions runner needs explicit permission to clone it.

In your GitHub repository settings, go to **Settings > Secrets and variables > Actions** and add the following:

### `SUBMODULE_PAT` (Required)
- A Personal Access Token (PAT) with `repo` scope (for classic PATs) or Read-only access to repository contents (for fine-grained PATs) for the private `etemaro-desktop` repository.
- Used by `actions/checkout` to recursively clone the submodules.

### Apple Code Signing (Optional, for macOS notarization)
If you want to sign and notarize the macOS application so users do not see Gatekeeper warnings:
- `APPLE_CERTIFICATE`: Base64-encoded `Developer ID Application` certificate (in `.p12` format).
- `APPLE_CERTIFICATE_PASSWORD`: The password for the certificate.
- `APPLE_SIGNING_IDENTITY`: The common name of the certificate (e.g. `Developer ID Application: Your Name (ID)`).
- `APPLE_API_ISSUER`: Apple API Issuer ID.
- `APPLE_API_KEY_ID`: Apple API Key ID.
- `APPLE_API_KEY_CONTENT`: The content of the Apple App Store Connect API Private Key (`.p8` file).

---

## 2. GitHub Actions Workflow Configuration

Create a file at `.github/workflows/release-desktop.yml` with the following content:

```yaml
name: Release Desktop App

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: 'macos-latest'
            args: '--target universal-apple-darwin'
          - platform: 'windows-latest'
            args: ''
          - platform: 'ubuntu-22.04'
            args: ''

    runs-on: ${{ matrix.platform }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          submodules: 'recursive'
          token: ${{ secrets.SUBMODULE_PAT }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install pnpm
        uses: pnpm/action-setup@v3
        with:
          version: 9

      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}

      - name: Install Linux dependencies (Ubuntu only)
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf

      - name: Install frontend dependencies
        run: pnpm install --no-frozen-lockfile

      - name: Build frontend
        run: pnpm run build

      - name: Build and Publish Tauri Desktop App
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # Apple signing keys (omit or leave empty if unsigned macOS builds are preferred)
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
          APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
          APPLE_API_KEY_CONTENT: ${{ secrets.APPLE_API_KEY_CONTENT }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'Etemaro Desktop ${{ github.ref_name }}'
          releaseBody: 'Release binaries for Etemaro Desktop version ${{ github.ref_name }}.'
          releaseDraft: true
          prerelease: false
          args: ${{ matrix.args }}
          projectPath: './apps/desktop'
```

---

## 3. How It Works

1. **Matrix Strategy**: The workflow launches three parallel runners (`macos-latest`, `windows-latest`, `ubuntu-22.04`).
2. **Submodule Resolution**: `actions/checkout` checks out the main repository and uses the `SUBMODULE_PAT` secret to authenticate and recursively clone the private `apps/desktop` submodule.
3. **Linux Prerequisites**: On the Ubuntu runner, it installs GTK, WebKit, and AppIndicator dependencies required by Tauri to interface with the GNOME window manager/system tray.
4. **Rust Compilation**: Compiles the Rust backend for the target platform (including cross-compilation target `universal-apple-darwin` for macOS support on both Intel and Apple Silicon architectures).
5. **Release Creation**: Once built, `tauri-apps/tauri-action` uploads all built installers (`.dmg`, `.msi`, `.deb`/`.AppImage`) to a drafted release in your GitHub Repository.
