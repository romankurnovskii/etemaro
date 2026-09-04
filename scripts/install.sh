#!/bin/sh
set -e

# Etemaro CLI + Desktop installer

install_via_npm() {
    if command -v npm >/dev/null 2>&1; then
        echo "Installing Etemaro CLI via npm..."
        npm install -g @etemaro/cli
        echo "Etemaro CLI installed."
    else
        echo "Error: npm is required to install Etemaro CLI globally."
        echo "Install Node.js 22+ first: https://nodejs.org/"
        exit 1
    fi
}

install_desktop() {
    case "$OS_NAME" in
        darwin)
            if command -v brew >/dev/null 2>&1; then
                echo "Checking for etemaro desktop cask..."
                if brew info --cask etemaro >/dev/null 2>&1; then
                    echo "Installing via Homebrew Cask..."
                    brew install --cask etemaro
                else
                    echo "No official cask yet. Download from GitHub releases:"
                    echo "  https://github.com/romankurnovskii/etemaro-desktop/releases/latest"
                fi
            else
                echo "Homebrew not found. Download from GitHub releases:"
                echo "  https://github.com/romankurnovskii/etemaro-desktop/releases/latest"
            fi
            ;;
        linux)
            echo "Download Linux build (AppImage/.deb) from GitHub releases:"
            echo "  https://github.com/romankurnovskii/etemaro-desktop/releases/latest"
            ;;
        *)
            echo "Desktop app not available for $OS_NAME yet."
            echo "Track progress: https://github.com/romankurnovskii/etemaro-desktop"
            ;;
    esac
}

if [ "$OS" = "Windows_NT" ]; then
    echo "Windows is not supported by this script yet. Please use npm to install."
    exit 1
fi

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
    Linux)
        OS_NAME="linux"
        ;;
    Darwin)
        OS_NAME="darwin"
        ;;
    *)
        echo "Unsupported OS: $OS"
        exit 1
        ;;
esac

case "$ARCH" in
    x86_64)
        ARCH_NAME="x64"
        ;;
    arm64 | aarch64)
        ARCH_NAME="arm64"
        ;;
    *)
        echo "Unsupported architecture: $ARCH"
        exit 1
        ;;
esac

echo "Determining latest release..."
LATEST_RELEASE=$(curl -fsSL https://api.github.com/repos/romankurnovskii/etemaro/releases/latest | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$LATEST_RELEASE" ]; then
    echo "Failed to fetch the latest release."
    exit 1
fi

echo "Found latest release: $LATEST_RELEASE"

# --- CLI Install ---
if [ "$OS_NAME" = "darwin" ] && command -v brew >/dev/null 2>&1; then
    echo "Homebrew detected. Checking for etemaro formula..."
    if brew info --formula etemaro >/dev/null 2>&1; then
        echo "Installing Etemaro CLI via Homebrew..."
        brew install etemaro
    else
        echo "No official Homebrew formula found. Falling back to npm..."
        install_via_npm
    fi
else
    install_via_npm
fi

# --- Desktop App Install (interactive) ---
echo ""
echo "Etemaro also has a cross-platform desktop app."
printf "Install desktop app? [y/N] "
read -r REPLY
case "$REPLY" in
    [yY]|[yY][eE][sS])
        install_desktop
        ;;
    *)
        echo "Skipping desktop app."
        ;;
esac

echo ""
echo "Done! Next steps:"
echo "  etemaro init"
echo "  etemaro start --dry-run"
