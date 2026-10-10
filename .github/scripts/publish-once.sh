#!/usr/bin/env bash
# Publishes the package in the current directory unless this exact version is
# already on npm. Run from the package directory; extra arguments (e.g. --dry-run) go to npm publish.
set -euo pipefail
NAME=$(node -p "require('./package.json').name")
VERSION=$(node -p "require('./package.json').version")
if npm view "$NAME@$VERSION" version >/dev/null 2>&1; then
  echo "$NAME@$VERSION is already on npm, skipping."
else
  npm publish --access public "$@"
fi
