#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
toolchain="$HOME/.local/share/delta-stream/toolchain"
if [ -z "${JAVA_HOME:-}" ] && [ -d "$toolchain/jdk-21" ]; then
  JAVA_HOME="$toolchain/jdk-21"
  export JAVA_HOME
fi
ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$toolchain/sdk}}"
export ANDROID_HOME
if [ ! -d "$ANDROID_HOME/platforms/android-36" ]; then
  printf '%s\n' 'Android SDK 36 missing. Set ANDROID_HOME; install JDK 21 and SDK 36 first.' >&2
  exit 1
fi
# Compilation only; no automatic SDK license acceptance or release signing.
exec sh android/gradlew -p android --no-daemon "$@"
