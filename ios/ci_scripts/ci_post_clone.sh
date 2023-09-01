#!/bin/sh
export HOMEBREW_NO_INSTALL_CLEANUP=TRUE
export NODE_OPTIONS=--max_old_space_size=8192

# Install CocoaPods and yarn using Homebrew.
brew install cocoapods
brew install node@18
brew install ruby
brew link node@18
brew install yarn

# Install dependencies
yarn
which ruby
ruby -v
sudo gem install bundler:2.1.4
which ruby
ruby -v
sudo bundle update --bundler
which ruby
ruby -v
yarn bundleinstall
yarn podprod