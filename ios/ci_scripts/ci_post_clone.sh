#!/bin/sh
set -e
export HOMEBREW_NO_INSTALL_CLEANUP=TRUE
export HOMEBREW_NO_AUTO_UPDATE=1
export NODE_OPTIONS=--max_old_space_size=8192

# Pinned Ruby for the iOS toolchain. CocoaPods + modern bundler require Ruby >= 3.2;
# Ruby 2.7.x is EOL and breaks against the current Xcode Cloud image (its Homebrew
# Ruby leaks into `bundle exec`, and rubygems.org rejects the old client). 3.3.x is the
# stable, CocoaPods-safe line and satisfies the Gemfile's `ruby ">= 2.6.10"` requirement.
RUBY_VERSION=3.3.6

# Install the toolchain via Homebrew.
brew install cocoapods rbenv ruby-build node@24 yarn
brew link --overwrite node@24

echo ">>> INSTALL RUBY ${RUBY_VERSION} (rbenv)"
eval "$(rbenv init - sh)"
rbenv install --skip-existing "${RUBY_VERSION}"
rbenv global "${RUBY_VERSION}"
rbenv rehash
ruby -v

echo ">>> INSTALL BUNDLER"
gem install bundler
rbenv rehash
bundle -v

echo ">>> INSTALL DEPENDENCIES"
yarn
bundle install
yarn podinstall
