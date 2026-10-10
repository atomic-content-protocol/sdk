#!/usr/bin/env bash
# Publishes the package in the current directory unless this exact version is
# already on npm. Run from the package directory; extra arguments (e.g.
# --dry-run) go to npm publish.
#
# Skips only when the registry returns this exact version, publishes only when
# it answers "not found", and stops on anything else (auth, rate limit, outage)
# rather than guessing.
set -euo pipefail
NAME=$(node -p "require('./package.json').name")
VERSION=$(node -p "require('./package.json').version")
ERR=$(mktemp)
if FOUND=$(npm view "$NAME@$VERSION" version 2>"$ERR"); then
  if [ "$FOUND" = "$VERSION" ]; then
    echo "$NAME@$VERSION is already on npm, skipping."
    exit 0
  fi
elif ! grep -q "E404" "$ERR"; then
  cat "$ERR" >&2
  echo "::error::Could not check whether $NAME@$VERSION is published; not publishing." >&2
  exit 1
fi
npm publish --access public "$@"
