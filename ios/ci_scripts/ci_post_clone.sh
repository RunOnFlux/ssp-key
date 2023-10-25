#!/bin/sh
export HOMEBREW_NO_INSTALL_CLEANUP=TRUE
export NODE_OPTIONS=--max_old_space_size=8192

# Install CocoaPods and yarn using Homebrew.
brew install cocoapods
brew install ruby
brew install node@18
brew link node@18
brew install yarn

echo ">>> SETUP ENVIRONMENT"
echo 'export GEM_HOME=$HOME/gems' >>~/.bash_profile
echo 'export PATH=$HOME/gems/bin:$PATH' >>~/.bash_profile
export GEM_HOME=$HOME/gems
export PATH="$GEM_HOME/bin:$PATH"

echo ">>> INSTALL BUNDLER"
gem install bundler --install-dir $GEM_HOME
gem install cocoapods --install-dir $GEM_HOME

# Install dependencies
yarn
bundle update --bundler
yarn bundleinstall
yarn podprod