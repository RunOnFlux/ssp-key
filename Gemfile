source 'https://rubygems.org'

# You may use http://rbenv.org/ or https://rvm.io/ to install and use this version
ruby ">= 2.6.10"

# Exclude problematic versions of cocoapods and activesupport that causes build failures.
gem 'cocoapods', '>= 1.13', '!= 1.15.0', '!= 1.15.1'
gem 'activesupport', '>= 6.1.7.5', '!= 7.1.0'
gem 'xcodeproj', '< 1.26.0'
gem 'concurrent-ruby', '< 1.3.4'

# json >= 2.10 fails to compile on the Xcode Cloud image: mkmf misdetects
# rb_hash_bulk_insert/rb_str_to_interned_str as missing, and the gem's static
# fallback shims then clash with the real Ruby 3.3 header declarations.
# The 2.x line below 2.10 defines compatible non-static fallbacks instead.
gem 'json', '< 2.10'

# Ruby 3.4.0 has removed some libraries from the standard library.
gem 'bigdecimal'
gem 'logger'
gem 'benchmark'
gem 'mutex_m'
gem 'nkf'