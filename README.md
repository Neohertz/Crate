<div align="center">
    <a href="https://github.com/Neohertz/crate"><img width="150" height="150" src="public/logo.png" alt="Crate"></a>
	
</div>

<h1 align="center">
	Crate
</h1>

<h4 align="center">
    <b>
        A simple to use, scalable state container built for the <a href="https://roblox-ts.com">roblox-ts</a> ecosystem
    </b>
<h4>

<div align="center">

[![Downloads][downloads-shield]][downloads-url]
[![Contributors][contributors-shield]][contributors-url]
[![Stargazers][stars-shield]][stars-url] [![Issues][issues-shield]][issues-url]
[![License][license-shield]][license-url]

</div>

<p align="center">
    <a href="#-notice">Notice</a> •
    <a href="#-installation">Installation</a> •
    <a href="#-usage">Usage</a> •
    <a href="#-react">React</a> •
    <a href="https://docs.neohertz.dev/docs/crate/about">Documentation</a>
</p>

---

# 📛 Notice

> [!CAUTION]
> While crate appears to be stable, `v1.0.1` has not been thoroughly battle tested. Use at your own risk, as you may encounter breaking bugs.

# 💻 Installation

To install crate, run one of the following commands in your project's directory.

```bash
npm i @rbxts/crate
yarn add @rbxts/crate
pnpm add @rbxts/crate
```

# 💫 Usage

Below is a basic example of using crate to manage player data.

```ts
import { Crate } from "@rbxts/crate";
import { Players } from "@rbxts/services";

enum AUTH_LEVEL {
  USER,
  ADMIN,
}

interface User {
  player: Player;
  authLevel: AUTH_LEVEL;

  stats: {
    cash: 0;
  };
}

// Determine a player's auth level.
function getUserAuthLevel(player: Player) {
  return player.UserId === 1 ? AUTH_LEVEL.ADMIN : AUTH_LEVEL.USER;
}

// Create and return a crate for the provided user.
function createUserCrate(player: Player): Crate<User> {
  const user = new Crate<User>({
    player: player,
    authLevel: getUserAuthLevel(player),

    stats: {
      cash: 0,
    },
  });

  return user;
}

// Listen for player join.
Players.PlayerAdded.Connect((player) => {
  const user = createUserCrate(player);

  // Listen to updates to the player's cash.
  user.onUpdate(
    (state) => state.stats.cash,
    (cash) => print(cash),
  );

  // If the user is an admin, give them a bunch of cash.
  if (user.getState((s) => s.authLevel) === AUTH_LEVEL.ADMIN) => {
    user.update({
      stats: {
        cash: 1000000,
      },
    });
  })  
});
```

> [!NOTE]
> To learn more, visit the [docs](https://docs.neohertz.dev/docs/crate/about).

# ⚛️ React

For more information on using crates with react, see [@rbxts/react-crate](https://github.com/Neohertz/react-crate).


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
