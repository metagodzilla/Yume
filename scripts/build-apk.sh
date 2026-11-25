#!/usr/bin/env bash
# Builds a standalone release APK. No Expo account and no EAS.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}"
export ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/android-sdk}}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

if [[ ! -x "$JAVA_HOME/bin/java" ]]; then
  echo "JDK 17 not found at $JAVA_HOME. Install openjdk-17-jdk and set JAVA_HOME." >&2
  exit 1
fi
if [[ ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" && ! -d "$ANDROID_HOME/platforms" ]]; then
  echo "Android SDK not found at $ANDROID_HOME." >&2
  echo "Install command-line tools, platforms;android-37.0, build-tools;37.0.0, ndk;27.1.12297006, and cmake;3.22.1." >&2
  exit 1
fi

# compileSdk 37 looks for platforms/android-37. The SDK package is named android-37.0.
if [[ -d "$ANDROID_HOME/platforms/android-37.0" && ! -e "$ANDROID_HOME/platforms/android-37" ]]; then
  ln -sfn android-37.0 "$ANDROID_HOME/platforms/android-37"
fi

if [[ ! -x android/gradlew ]]; then
  CI=1 npx expo prebuild --platform android --no-install
fi

node scripts/patch-android-release-signing.mjs

KS="android/app/yume-release.keystore"
PROPS="android/keystore.properties"
if [[ ! -f "$KS" ]]; then
  if [[ -f "$PROPS" ]]; then
    echo "keystore.properties exists but $KS does not. Delete android/keystore.properties and run again." >&2
    exit 1
  fi
  # PKCS12 uses one password for the store and the key.
  STORE_PASS="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"
  keytool -genkeypair -v \
    -storetype PKCS12 \
    -keystore "$KS" \
    -alias yume \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$STORE_PASS" \
    -keypass "$STORE_PASS" \
    -dname "CN=Yume, OU=Yume, O=Yume, L=Local, ST=Local, C=US"
  cat > "$PROPS" <<EOF
storePassword=$STORE_PASS
keyPassword=$STORE_PASS
keyAlias=yume
storeFile=yume-release.keystore
EOF
  chmod 600 "$PROPS" "$KS"
  echo "Created a new release keystore. Passwords are in $PROPS (not committed)."
fi

if [[ ! -f "$PROPS" ]]; then
  echo "Missing $PROPS. Delete $KS and run again to regenerate both." >&2
  exit 1
fi

printf 'sdk.dir=%s\n' "$ANDROID_HOME" > android/local.properties

# Gradle's default 10s download timeout is too short for the wrapper zip.
sed -i 's/networkTimeout=10000/networkTimeout=600000/' android/gradle/wrapper/gradle-wrapper.properties

ARCHES="${YUME_ABIS:-arm64-v8a,armeabi-v7a,x86_64}"
cd android
./gradlew assembleRelease --no-daemon -PreactNativeArchitectures="$ARCHES"
cd "$ROOT"

APK="android/app/build/outputs/apk/release/app-release.apk"
OUT="dist/yume-1.5.3.apk"
mkdir -p dist
cp "$APK" "$OUT"
ls -lh "$OUT"
echo "Standalone release APK: $ROOT/$OUT"
