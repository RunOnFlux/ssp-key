#!/bin/sh
set -e
export HOMEBREW_NO_INSTALL_CLEANUP=TRUE
export HOMEBREW_NO_AUTO_UPDATE=1
export NODE_OPTIONS=--max_old_space_size=8192

# Use the Xcode Cloud image's Homebrew CocoaPods instead of the Gemfile/bundler
# toolchain. Building gem native extensions on this image is broken: the Tahoe
# runners are arm64 but ship the x86_64 (Rosetta) Homebrew in /usr/local, and
# clang emits arm64 .bundle files that the x86_64 ruby cannot dlopen. macOS
# extensions link with `-undefined dynamic_lookup`, so the arch mismatch only
# surfaces at require time — it is also why mkmf's link-based have_func checks
# misdetect and made the json gem fall into broken fallback code. Homebrew's
# cocoapods formula is self-contained (its own ruby + prebuilt gems, nothing
# compiled on the runner), so none of that applies to it.
# Local development keeps using bundler via `yarn podinstall`.
brew install cocoapods node@24 yarn
brew link --overwrite node@24

echo ">>> INSTALL JS DEPENDENCIES"
yarn

echo ">>> POD INSTALL"
cd ..
pod --version
# dl.google.com intermittently resets connections on Xcode Cloud runners
# while downloading GoogleMLKit/Firebase tarballs (known flaky issue).
# CocoaPods caches pods that already downloaded, so each retry only
# re-fetches the ones still missing.
n=0
until RCT_NEW_ARCH_ENABLED=1 pod install; do
  n=$((n+1))
  if [ "$n" -ge 4 ]; then
    echo ">>> pod install failed after $n attempts"
    exit 1
  fi
  echo ">>> pod install failed (attempt $n), retrying in 15s"
  sleep 15
done
