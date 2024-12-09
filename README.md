<div align="center">
    <a href="https://github.com/Neohertz/crate"><img src="./docs/images/CLogo.png" alt="Crate"></a>
</div>

<h4 align="center">
    <b>
        A simple to use, scalable state container built for the <a href="https://roblox-ts.com">roblox-ts</a> ecosystem
    </b>
<h4>

<div align="center">

[![Downloads][downloads-shield]][downloads-url]
[![Contributors][contributors-shield]][contributors-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![License][license-shield]][license-url]

</div>

<p align="center">
    <a href="#📛-notice">Notice</a> •
    <a href="#💻-installation">Installation</a> •
    <a href="#💡-credits">Credits</a> •
    <a href="#⚒️-changelog">Changelog</a> •
    <a href="https://docs.neohertz.dev/docs/crate/about">Documentation</a>
</p>

# 📛 Notice

> [!CAUTION]
> This package is still in **early beta**, expect breaking changes

# 💻 Installation

```bash
npm i @rbxts/crate
yarn add @rbxts/crate
pnpm add @rbxts/crate
```

# 💡 Credits

This software uses the following:

- [Icon](https://www.flaticon.com/free-icons/wooden-box)
- Emojis were taken from [here](https://emojipedia.org/)

# ⚒️ Changelog

## v1.0.0

### Added or Changed

- Rename `.get()` to `.getState()`
- Reflex style state selectors for `.getState()` and `.onUpdate`

## v0.0.5

### Added or Changed

- Second parameter to copy object passed to `.update()`. [#1](https://github.com/Neohertz/crate/issues/1)

### Fixed

- Issue with equality check on update. [#3](https://github.com/Neohertz/crate/issues/3)

## v0.0.4

### Fixed

- `.get()` type issue with key.

## v0.0.3

### Added or Changed

- Internal state is fully immutable.
- `onUpdate()` callback is no longer invoked if the state doesn't truly change.

### Fixed

- Type errors

### Removed

- `reset()` method.

[downloads-shield]: https://img.shields.io/npm/d18m/%40rbxts%2Fcrate?style=for-the-badge
[downloads-url]: https://www.npmjs.com/package/@rbxts/crate
[contributors-shield]: https://img.shields.io/github/contributors/neohertz/crate?style=for-the-badge
[contributors-url]: https://github.com/Neohertz/crate/graphs/contributors
[stars-shield]: https://img.shields.io/github/stars/neohertz/crate?style=for-the-badge
[stars-url]: https://github.com/Neohertz/crate/stargazers
[issues-shield]: https://img.shields.io/github/issues/neohertz/crate?style=for-the-badge
[issues-url]: https://github.com/Neohertz/crate/issues
[license-shield]: https://img.shields.io/github/license/neohertz/crate?style=for-the-badge
[license-url]: https://github.com/Neohertz/crate/blob/master/LICENSE
