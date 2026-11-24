#!/usr/bin/env bash
# Build the sideload APK and write releases/latest.json.
# Host the APK yourself (any HTTPS URL) and set YUME_APK_URL before running,
# or edit apkUrl in the manifest afterward. No Expo account is used.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
bash scripts/build-apk.sh
APK="dist/yume-1.4.1.apk"
SHA="$(sha256sum "$APK" | awk '{print $1}')"
URL="${YUME_APK_URL:-}"
mkdir -p releases
cat > releases/latest.json <<EOF
{
  "version": "1.4.1",
  "versionCode": 6,
  "apkUrl": "${URL}",
  "sha256": "${SHA}",
  "notes": "Salad setup wizard, one Connect screen, and auto-stop for an idle GPU."
}
EOF
echo "Wrote releases/latest.json"
echo "sha256 ${SHA}"
if [[ -z "$URL" ]]; then
  echo "apkUrl is empty. Upload $APK somewhere the phone can download, then put that HTTPS address in apkUrl and in the app's update setting."
fi
