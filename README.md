# AutoMining for EveJS

Automatic mining with an in-game settings window. **EveJS Launcher only.**

Your modules choose separate asteroids where possible. When there aren't enough suitable targets in reach, they share. Normal range, crystals, target limits, capacitor and hold capacity still apply.

**First public release: v1.0.4.**

![AutoMining settings window with target controls, survey timer and ore filter](docs/automining-window.png)

## Install

Requires **EveJS Launcher 1.0.56 or newer**, **EveJS 0.12.8**, **Native server mode**, and the supported copied **EVE client build 3396210**.

1. Download `AutoMining-<version>.zip` from [Releases](https://github.com/V0nCleef/EveJS-Automining/releases). Choose the mod ZIP, not GitHub's Source code download.
2. Close all EVE clients and stop the EveJS server.
3. In the Launcher, open **Mods**, choose your EveJS installation, then **Add ZIP**.
4. Select the ZIP and enable **AutoMining**. The Launcher installs the included client companion.
5. Start the server and character through the Launcher.
6. Type `/automining` in chat to open settings. Choose your settings and click **Start / Resume**.

Undock with online mining modules and suitable resources nearby. The mod handles locking and mining. Use **Stop** in the window to turn it off.

## The settings window

Open it with `/automining`. Capital letters don't matter; `!automining` and plain `automining` also work.

- **Start / Resume** saves your choices and turns mining on. **Stop** turns it off.
- **Target order:** nearest or furthest suitable resource in reach.
- **Lock targets automatically:** off means you must lock targets yourself.
- **Approach out-of-range ore:** approach matching resources in the scene when none are in mining range.
- **Automatic survey:** use the built-in Mining Surveyor. Set the interval in seconds.
- **Automatic compression:** compress resources aboard when a compressor your pilot can use is active and in range.
- **Apply settings:** save changes without changing whether AutoMining is on or off.
- **Reload:** discard unsaved changes and load the current saved settings.

### Choose which ores to mine

The left list contains available resources. The right list is your active filter.

1. Search or select an ore on the left, then click **>** to add it.
2. Select an ore on the right and click **<** to remove it.
3. Click **Apply settings**.

Ctrl/Shift selects several entries. **Clear filter**, then **Apply settings**, allows every compatible resource again. An empty filter means mine all.

The list comes from the server's published resource catalog and includes ore, ice and gas. An ore family such as **Veldspar** also matches its named variants, including Dense Veldspar. Selecting a specific variant narrows that entry to the variant.

Applying a filter immediately unlocks excluded resource targets and stops their mining cycles. Matching targets keep working. Interrupted cycles follow normal EveJS yield rules; incomplete ice or crystal cycles may produce nothing.

## Saved settings and defaults

Settings are saved separately for each character, including **On / Off**. If left on, AutoMining resumes after docking, logging back in or restarting the server when the character has a suitable ship in space. Travel and cloak pause it. Click **Stop** when you want it to stay off.

| Setting | New-character default |
| --- | --- |
| AutoMining | Off |
| Ore filter | Empty: all compatible resources |
| Target order | Nearest first |
| Automatic locking | On |
| Automatic survey | Off |
| Survey interval | 60 seconds |
| Automatic approach | Off |
| Automatic compression | Off |

**Updating the mod keeps saved settings.** Existing survey choices stay as you set them; changing the default does not turn a saved survey setting off.

To preconfigure a character, use **Mods > AutoMining > Configure**, choose its Launcher profile, enable **Apply Launcher settings**, then save. A changed preset applies at the next login. An unchanged preset will not overwrite later in-game choices.

## Useful details

**Full hold:** resource targets whose destination hold cannot accept another unit are unlocked, ending unnecessary cycles. Making space allows mining to resume automatically.

**Survey:** uses the same native Mining Surveyor action as the ship HUD button. Your ship must support it; Mining Survey chipsets keep their usual effects. With both AutoMining and survey on, the first scan runs when ready, then at your chosen interval. Allowed values are whole seconds from 6 to 86,400. Six seconds is the minimum because detailed scans have a native ten-per-minute limit. Busy scans are skipped, and scanning pauses during travel. Changing the timer alone does not turn scanning on.

**Approach:** stays within the current scene; it does not travel to another belt or system. Manual steering switches automatic approach off.

**Compression:** checks every ten seconds while AutoMining is on. Normal access, fleet, range and resource restrictions apply. It uses an already active compressor and does not activate another ship's modules or fly toward it. The mining filter does not restrict compression of resources already aboard.

**Performance:** healthy cycles reuse existing targets instead of searching the entire field repeatedly. Empty searches retry every five seconds. The ore catalog is cached, and the window polls status only while open. Survey scanning follows its separate timer.

Supports online mining lasers, strip miners, ice miners and gas harvesters. Mining drones are outside this mod's scope.

## Optional command shortcuts

You only need `/automining` to use the window. These shortcuts remain available, with `/`, `!`, or no prefix:

| Command | Action |
| --- | --- |
| `/automining` | Open settings |
| `/automining status` | Show settings and status as text |
| `/automining on` / `off` | Start or stop; saved per character |
| `/automining veldspar,scordite` | Replace the filter with these ores |
| `/automining clear` | Allow all compatible resources |
| `/automining nearest` / `furthest` | Set target order; current cycles finish normally |
| `/automining lock on` / `off` | Toggle automatic locking |
| `/automining approach on` / `off` | Toggle approach |
| `/automining survey on` / `off` | Toggle survey |
| `/automining survey 30` | Set a 30-second interval |
| `/automining compress on` / `off` | Toggle compression |

Aliases: `/automining closest` means nearest, `/automining farthest` means furthest, and `/automining survey interval 30` is the same as `/automining survey 30`. Replace `30` with your chosen whole number of seconds (6–86,400).

Settings commands leave the main On / Off choice unchanged. Commands provide a direct in-game notification as well as the chat acknowledgement when available.

## Updates and removal

The Launcher checks [this repository](https://github.com/V0nCleef/EveJS-Automining) for compatible releases. You can also use **Check mod updates** in Mods.

Close EVE clients and stop the server before updating, disabling or removing AutoMining. Install updates through the Launcher, then restart the server and clients. Your settings remain saved. The Launcher offers updates; it does not interrupt a running game to install them.

Disabling or removing the mod restores its original client module from backup. Preferences remain available if you reinstall.

## Troubleshooting

- **No Configure button:** check Launcher version 1.0.56 or newer, install the correct package, then refresh Mods.
- **Window won't open or command feedback is missing:** fully restart both server and clients after updating. Launch through the Launcher. Use AutoMining's **Actions > Install / Update** with clients closed if the companion needs reinstalling.
- **Survey doesn't run:** enable both AutoMining and Automatic survey, check the window's status, and verify the ship can use its normal Mining Surveyor button.
- **Nothing is mined:** check online modules, filter, range, free hold space, capacitor and target slots. With locking off, lock a suitable resource yourself.
- **Compression waits:** a nearby ship alone isn't enough. Its compressor must be active, support your resource and be accessible to your pilot.
- **Unsupported build:** use the listed compatible server and client. Do not bypass compatibility checks.

Report problems in [GitHub Issues](https://github.com/V0nCleef/EveJS-Automining/issues). Include Launcher/EveJS versions, mining modules and `/automining status` output.
