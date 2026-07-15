#!/bin/sh
set -e
export HOMEBREW_NO_INSTALL_CLEANUP=TRUE
export HOMEBREW_NO_AUTO_UPDATE=1
export NODE_OPTIONS=--max_old_space_size=8192

# Pinned Ruby for the iOS toolchain. CocoaPods + modern bundler require Ruby >= 3.2;
# Ruby 2.7.x is EOL and breaks against the current Xcode Cloud image (its Homebrew
# Ruby leaks into `bundle exec`, and rubygems.org rejects the old client). 3.3.x is the
# stable, CocoaPods-safe line and satisfies the Gemfile's `ruby ">= 2.6.10"` requirement.
# Use Homebrew's pre-built ruby@3.3 bottle instead of compiling via rbenv/ruby-build —
# the Tahoe Xcode Cloud image no longer ships openssl@3/libyaml, which made the
# source build fail while configuring the openssl and psych extensions.

# Install the toolchain via Homebrew.
brew install cocoapods ruby@3.3 node@24 yarn
brew link --overwrite node@24

echo ">>> ACTIVATE RUBY 3.3 (Homebrew bottle)"
RUBY_PREFIX="$(brew --prefix ruby@3.3)"
export PATH="${RUBY_PREFIX}/bin:${PATH}"
ruby -v

# The Tahoe image runs this x86_64 Homebrew ruby under Rosetta, but clang
# invoked from gem native-extension builds targets the host's native arm64,
# producing .bundle files the x86_64 ruby cannot dlopen (and making mkmf's
# link-time have_func checks fail). mkmf honors ARCHFLAGS — force x86_64.
export ARCHFLAGS="-arch x86_64"

echo ">>> INSTALL BUNDLER"
gem install bundler
export PATH="$(gem environment gemdir)/bin:${PATH}"
bundle -v

echo ">>> INSTALL DEPENDENCIES"
yarn
# rubygems.org's compact-index host (index.rubygems.org) is intermittently unreachable from
# Xcode Cloud runners. Retry, then fall back to the full index served from rubygems.org
# itself (which is reachable — the `gem install bundler` above succeeds against it).
bundle install --retry 3 || bundle install --retry 3 --full-index
yarn podinstall
