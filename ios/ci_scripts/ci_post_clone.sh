#!/bin/sh
export HOMEBREW_NO_INSTALL_CLEANUP=TRUE
export NODE_OPTIONS=--max_old_space_size=8192

/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install.sh)"

# Install CocoaPods and yarn using Homebrew.
brew install cocoapods
brew install ruby
brew install rails
brew install node@18
brew link node@18
brew install yarn

# Install dependencies
yarn
gem install bundler:2.1.4
bundle update --bundler
yarn bundleinstall
yarn podprod