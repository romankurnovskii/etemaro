#!/bin/sh
set -e

# Etemaro CLI installer

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

# Construct download URL (assuming we publish binaries to GitHub releases in the future)
# For now, this points to npm install globally as the fallback method, since standalone binaries might require pkg/pkg-like tools.
echo "Installing Etemaro CLI via npm..."
if command -v npm >/dev/null 2>&1; then
    npm install -g @etemaro/cli
    echo "Etemaro CLI installed successfully!"
    echo "Run 'etemaro help' to get started."
else
    echo "Error: npm is required to install Etemaro CLI globally."
    echo "Please install Node.js and npm first: https://nodejs.org/"
    exit 1
fi
