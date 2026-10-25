# Changelog

## [2.1.0](https://github.com/tbaur/homebridge-pagerduty/compare/v2.0.2...v2.1.0) (2026-10-25)


### Documentation

* add the verified by Homebridge badge ([e26ecc3](https://github.com/tbaur/homebridge-pagerduty/commit/e26ecc35ab43b1dcfa55fa63ca0b758b7f53ce82))

## [2.0.2](https://github.com/tbaur/homebridge-pagerduty/compare/v2.0.1...v2.0.2) (2026-10-25)


### Bug Fixes

* correct dry-run recovery, timers, and alert logging ([2ff1591](https://github.com/tbaur/homebridge-pagerduty/commit/2ff1591972ebd854677fc35b7c810b0f34b78696))

## [2.0.1](https://github.com/tbaur/homebridge-pagerduty/compare/v2.0.0...v2.0.1) (2026-10-25)


### Bug Fixes

* **config:** stop the blank alert from saving an invalid entry ([#17](https://github.com/tbaur/homebridge-pagerduty/issues/17)) ([3133a36](https://github.com/tbaur/homebridge-pagerduty/commit/3133a364756ec2b07a98ad4439e7a3d696ea87d7))

## [2.0.0](https://github.com/tbaur/homebridge-pagerduty/compare/v1.1.2...v2.0.0) (2026-10-25)


### ⚠ BREAKING CHANGES

* signals.sources, the alert signal field and level names are removed. Allow each plugin under Plugin Signals instead. Plugins that write signals must copy the new module from docs/SIGNALS-AGENT.md, which writes to the signals-2026-10-24 directory.

### Features

* let other plugins page through Plugin Signals settings ([#15](https://github.com/tbaur/homebridge-pagerduty/issues/15)) ([ad7d0bc](https://github.com/tbaur/homebridge-pagerduty/commit/ad7d0bcf2b66b52474647960ca8e7a8eb995793b))

## [1.1.2](https://github.com/tbaur/homebridge-pagerduty/compare/v1.1.1...v1.1.2) (2026-10-24)


### Bug Fixes

* make Follow Signal clearer and list available signals at startup ([#12](https://github.com/tbaur/homebridge-pagerduty/issues/12)) ([1ab8fba](https://github.com/tbaur/homebridge-pagerduty/commit/1ab8fba90f373cd3ee52e68220d3efcb8e3c1fe0))

## [1.1.1](https://github.com/tbaur/homebridge-pagerduty/compare/v1.1.0...v1.1.1) (2026-10-24)


### Bug Fixes

* mark new alert switches in the startup report ([#10](https://github.com/tbaur/homebridge-pagerduty/issues/10)) ([fc81da4](https://github.com/tbaur/homebridge-pagerduty/commit/fc81da435f58f2bdf8a65de5a40e3b72fc559e62))

## [1.1.0](https://github.com/tbaur/homebridge-pagerduty/compare/v1.0.0...v1.1.0) (2026-10-24)


### Features

* simpler settings, custom accessory names and a startup report ([#8](https://github.com/tbaur/homebridge-pagerduty/issues/8)) ([f1cb3de](https://github.com/tbaur/homebridge-pagerduty/commit/f1cb3dec07d215cfac8c741fb02f8e7b65eadbb9))

## [1.0.0](https://github.com/tbaur/homebridge-pagerduty/compare/v0.1.1...v1.0.0) (2026-10-24)


### Miscellaneous Chores

* set the next release to 1.0.0 ([db8cd3f](https://github.com/tbaur/homebridge-pagerduty/commit/db8cd3ff0c6caffe6a02fba51e14fdad731f4d79))

## [0.1.1](https://github.com/tbaur/homebridge-pagerduty/compare/v0.1.0...v0.1.1) (2026-10-24)


### Features

* add Homebridge PagerDuty plugin ([a7194ca](https://github.com/tbaur/homebridge-pagerduty/commit/a7194ca037c02d9250e29c0a72b075ae012d82c6))

## Changelog

All notable changes to this project are documented here. Releases are managed by release-please from Conventional Commits.
