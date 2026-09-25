# AutoMining for EveJS

AutoMining mines ore, manages drones and fleet boosts, and can unload at an NPC station or accessible Upwell structure before returning to mine. Settings are saved per character.

**Works with EveJS 0.12.8 and 0.12.9**, EVE client build 3396210, and [EveJS Launcher](https://github.com/V0nCleef/evejs-launcher) 1.0.61 or newer. Native and Launcher-managed Docker are supported.

Version 1.0.10 keeps drone recall active for manual warp, docking and autopilot when another mod loads the travel service through its own loader. If the required travel handlers change, AutoMining reports the incompatibility at startup.

The HUD follows your EVE client's language setting. It supports English, Simplified Chinese, German, French, Spanish, Italian, Russian, Japanese, and Korean. Station search accepts translated station names too.

## Install or update

1. Close your EVE clients and stop the EveJS server.
2. In the Launcher, use **Mods > AutoMining > Update**. For a new install, download [AutoMining-1.0.10.zip](https://github.com/V0nCleef/EveJS-Automining/releases/download/v1.0.10/AutoMining-1.0.10.zip) and use **Mods > Add ZIP**.
3. Restart the server and clients. Type `!automining` in chat to open the HUD. `/automining` also works for GM characters.

## What you can set

- **Mining Filter:** Choose ores in priority order. Each ore group mines its highest grade first.
- **Mining:** Choose target priority, automatic locking, approach, survey, and compression.
- **Mining drones:** Give launched mining drones their own target priority and Spread or Focus mode.
- **Drones:** Launch a named group on arrival, recall before travel, and switch to fighters when rats appear.
- **Defense:** Retreat to your selected station or structure at your shield or armor threshold. After unloading, AutoMining stays off. An urgent armor retreat may leave drones behind.
- **Boosters:** Run mining command bursts and invite nearby AutoMining pilots to fleet.
- **Return to station:** Choose an NPC station or accessible Upwell structure, or use **Use current station** while docked. Select where to unload, including corporation hangar divisions. Return trips reuse the same belt position. The default unload trigger is 95% of the ore hold.

## HUD screenshots

<details>
<summary>Show all seven tabs</summary>

![Mining tab](docs/hud-mining.png)
![Mining drones tab](docs/hud-mining-drones.png)
![Mining Filter tab](docs/hud-mining-filter.png)
![Drones tab](docs/hud-drones.png)
![Defense tab](docs/hud-defense.png)
![Boosters tab](docs/hud-boosters.png)
![Return to station tab](docs/hud-return-to-station.png)

</details>
