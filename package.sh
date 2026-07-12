#!/bin/bash

# TestScribe Chrome Web Store Packaging Script
# This script bundles only the files required to run the extension,
# excluding development configs, documentation, git directories, and cache files.

set -e

ZIP_NAME="TestScribe-release.zip"

echo "=== Packaging TestScribe for Chrome Web Store ==="

# Check if zip is installed
if ! command -v zip &> /dev/null; then
    echo "❌ Error: 'zip' command line utility is not installed."
    echo "Please install it or package the files manually."
    exit 1
fi

# Clean up old packages
if [ -f "$ZIP_NAME" ]; then
    echo "🗑️  Removing old package: $ZIP_NAME"
    rm "$ZIP_NAME"
fi

# Files and folders to include
FILES_TO_ZIP=(
    "manifest.json"
    "background.js"
    "content.js"
    "popup.html"
    "popup.js"
    "popup.css"
    "options.html"
    "options.js"
    "options.css"
    "merge.html"
    "merge.js"
    "merge.css"
    "images"
)

# Verify all required files exist before zipping
echo "🔍 Verifying files..."
for file in "${FILES_TO_ZIP[@]}"; do
    if [ ! -e "$file" ]; then
        echo "❌ Error: Required file or folder '$file' is missing!"
        exit 1
    fi
done

echo "📦 Creating release package..."

# Run zip command excluding system hidden files (like .DS_Store)
zip -r "$ZIP_NAME" "${FILES_TO_ZIP[@]}" -x "*.DS_Store" "*__MACOSX*"

echo "✨ Successfully packaged TestScribe!"
echo "📁 Zip location: $(pwd)/$ZIP_NAME"
echo "ℹ️  You can now upload this file directly to the Chrome Web Developer Dashboard."
