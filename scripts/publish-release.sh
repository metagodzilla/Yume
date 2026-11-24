#!/usr/bin/env bash
# Upload an already signed APK to GitHub Releases.
# This does not sign. The release keystore stays on the machine that built the APK.
#
# Usage:
#   scripts/publish-release.sh dist/yume-1.4.1.apk 6
#   scripts/publish-release.sh /path/to/uploaded.apk 6 v1.4.1
#
# The release body includes "versionCode: N" so the phone can compare it.
# The APK is attached as a release asset. gh must be logged in with contents:write.
set -euo pipefail

APK="${1:-}"
CODE="${2:-}"
TAG="${3:-}"

if [[ -z "$APK" || -z "$CODE" ]]; then
  echo "Usage: scripts/publish-release.sh <signed.apk> <versionCode> [vX.Y.Z]" >&2
  exit 1
fi
if [[ ! -f "$APK" ]]; then
  echo "APK not found: $APK" >&2
  exit 1
fi
if [[ -z "$TAG" ]]; then
  BASE="$(basename "$APK" .apk)"
  VERSION="${BASE#yume-}"
  TAG="v${VERSION}"
fi

NOTES="$(printf 'versionCode: %s\n\nSigned APK for %s. Install over the current Yume build.' "$CODE" "$TAG")"
gh release create "$TAG" "$APK" --repo metagodzilla/Yume --title "$TAG" --notes "$NOTES" || gh release upload "$TAG" "$APK" --repo metagodzilla/Yume --clobber
echo "Published $APK on $TAG"
