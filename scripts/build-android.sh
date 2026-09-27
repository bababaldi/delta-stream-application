#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
toolchain="$HOME/.local/share/delta-stream/toolchain"
JAVA_HOME="${JAVA_HOME:-$toolchain/jdk-21}"
export JAVA_HOME
if [ ! -x "$JAVA_HOME/bin/java" ]; then
  printf '%s\n' 'JDK 21 missing. Set JAVA_HOME to a standalone JDK 21 installation.' >&2
  exit 1
fi
java_version=$("$JAVA_HOME/bin/java" -version 2>&1)
case "$java_version" in
*'version "21.'*) ;;
*)
  printf '%s\n' 'JDK 21 required; no fallback to system Java or editor extensions.' >&2
  exit 1
  ;;
esac
ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$toolchain/sdk}}"
export ANDROID_HOME
if [ ! -d "$ANDROID_HOME/platforms/android-36" ]; then
  printf '%s\n' 'Android SDK 36 missing. Set ANDROID_HOME; install JDK 21 and SDK 36 first.' >&2
  exit 1
fi
# Compilation only; no automatic SDK license acceptance or release signing.
exec sh android/gradlew -p android --no-daemon "$@"
