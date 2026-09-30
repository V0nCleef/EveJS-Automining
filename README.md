# AutoMining for EveJS

**Mining, Hauling, Boosting and PVE in one in-game window.** Give each pilot a job, choose its settings, and coordinate the fleet without repeating every lock, drone order, pickup or restock by hand.

[**Download AutoMining 1.2.14**](https://github.com/V0nCleef/EveJS-Automining/releases/tag/v1.2.14)



| Mining | Hauling | Boosting | PVE |
| --- | --- | --- | --- |
| ![Hulk — Mining](assets/jobs/mining.png) | ![Miasmos — Hauling](assets/jobs/hauling.png) | ![Orca — Boosting](assets/jobs/boosting.png) | ![Raven — PVE](assets/jobs/pve.png) |
| Pick resources and manage yield. | Collect fleet ore and deliver it. | Run industrial equipment and receive ore. | Patrol belts, escort pilots or answer calls. |

The ship cards are illustrated job artwork. AutoMining assists the configured jobs using EveJS's native movement, modules, inventory and fleet operations. Fitting, skills, range, capacity and access permissions still matter.

## Compatibility

- **Current live confirmation:** Native **EveJS 0.12.9**, EVE client **3396210**, AutoMining **1.2.14**.
- **Launcher:** package minimum **1.0.69**, using Launcher API **v1** and client-menu API **v1**. Use an **up-to-date Launcher** for the current Neocom Mods icon and category.
- **Also declared by the mod:** EveJS **0.12.8** and Launcher-managed **Docker**. This release has no fresh live gameplay coverage on those paths.

The shared Mods menu comes from the Launcher. AutoMining provides its menu adapter and window.

## Install or update

1. Download **AutoMining-1.2.14.zip** from the release.
2. Stop the server and close EVE clients before changing the mod. Keep the previous ZIP and back up the existing server configuration and Launcher profile settings.
3. In the Launcher, open **Mods > Add ZIP**, select the ZIP and enable **AutoMining**. For an existing installation, update the same AutoMining entry; its configured GitHub update channel also points to this repository.
4. Start the server with that profile and log in again so the client receives the current companion.
5. Open **Neocom > Mods > AutoMining**, **Insider > MODS > AutoMining**, or enter `!automining` in chat.

If the shared menu API is unavailable, the older **Insider > Tools > MODS** entry remains available. GM characters can also use `/automining`.

Preserve these files in the EveJS root when upgrading or moving the installation:

- `config/autoMining.players.json` — character settings and saved job profiles.
- `config/autoMining.statistics.json` — pilot counters and archived runs.
- `config/autoMining.fleetGroups.json` — shared fleet presets.
- The Launcher's AutoMining profile mod-data `preferences.json` — Launcher-side defaults.

**Apply Launcher settings** controls whether changed Launcher settings apply at the next login. In-game settings remain saved until you change those Launcher settings again. Leave that checkbox off when managing the job in game.

To roll back, stop clients/server, restore the previous mod version through the Launcher and retain the backed-up settings. To unload the mod, disable it in the Launcher and restart the server; stopping a job in game does not unload its hooks.

## Choose a job

A stopped pilot opens on **Jobs** and **Statistics**. Choose a ship card to reveal that job's pages and settings. An already-running pilot opens on its active job page.

**Apply settings** saves changes across pages; changing pages keeps your drafts. **Start / Resume** starts the chosen job. Each job remembers its own options and drone groups. Switching a running job asks to stop it, then leaves the new job waiting for Start. Search finds settings available to the selected job. **Show AutoMining action messages** controls the extra activity messages.

Labels follow the client's English, Chinese, German, French, Spanish, Italian, Russian, Japanese or Korean setting. Resource, station and belt searches accept localized names.

## Mining

Mine compatible **ore, ice or gas** with fitted modules. Optional mining-drone orders target ore alongside the job.

| Setting | What it controls |
| --- | --- |
| **Mining Filter** | Click/search resources to include them; move entries up/down to set priority. Empty means all compatible resources. Filter order and highest grade come first. |
| **Target priority** | Nearest, furthest, largest or smallest remaining volume within a grade. Volume is cubic metres, not ISK value. Volume priorities require an available Mining Surveyor or equivalent; a scan is not required. |
| **Lock targets automatically** | Turn off to work only with targets you have locked yourself. |
| **Approach out-of-range ore** | On searches the whole current belt and travels toward the preferred target. Off keeps selection within effective mining range. |
| **Automatic survey** | Enable/disable and set **6–86400 seconds**, default **60**. Waits outside mining locations and resumes on an eligible mining grid. |
| **Automatic compression** | Uses an active compressor you can access in range, under native fleet/resource rules. |
| **Mining drones** | Enable ore-mining orders for drones launched by AutoMining; choose a separate target priority and **focus/spread** mode. Uses the same resource filter. |
| **Ore handling** | Leave aboard, jettison, unload at station and return, request fleet pickup, or put ore into a booster's fleet hangar. |
| **Ore hold trigger** | **1–100%**, default **95%**, for modes that use a fullness trigger. |
| **Pickup style** | Jettison a bin first, or keep ore aboard until the hauler arrives and jettison then. |
| **Jettison controls** | Reuses a suitable nearby bin. Optional **Abandon jetcan** opens it to other pilots and compatible NPC collectors. **Jettison now** uses saved settings. |
| **Stacking** | Separate automatic ore-hold and fleet-hangar switches. |
| **Unload destination** | Choose station/Upwell and accessible storage on Defense; the destination is shared with emergency retreat. |

**Request pickup now** requires a running Mining job, saved fleet-pickup mode, ore available in space and native fleet membership.

Jettison, fleet pickup and booster collection handle **ore, including compressed ore**; they exclude ice and gas. Station unload uses the mining hold. Automatic unload returns to the saved mining position; manual travel cancels that trip. Automatic returns from instanced or gated sites are unsupported. The Mining job works on the current grid rather than searching the universe for new sites.

## Hauling

Use a **Miasmos, Porpoise, Orca or Rorqual** to collect ore from the shared request pool. Quafe Miasmos variants are excluded.

| Setting | What it controls |
| --- | --- |
| **Enable shared hauling** | Makes this pilot available for fleet pickup assignments. |
| **Transport station/storage** | A separate station or dockable Upwell destination; choose personal hangar, containers or accessible corporation storage. |
| **Unload at hold fullness** | **1–100%**, default **95%**. |
| **Unload partial cargo after idle seconds** | **1–3600 seconds**, default **60**. A finished assigned pickup can proceed directly to delivery. |
| **Stacking and drones** | Saved hold-stacking preferences plus the shared drone-launch, rat-response and travel-recall controls. |

Pickups can be in another system. Haulers travel through the client, reserve the assigned bin and temporarily join the requesting native fleet when needed. Existing manual fleets are preserved. Ore transfer happens locally with current loot rights; the ship then delivers to its selected storage. The queue and current phase appear on the Hauling page.

Hauling suspends mining, bursts, cores and compressors while retaining their settings. This is **public-space ore transport**; ice/gas and instanced/gated pickups are unsupported. Native permissions and confirmed transfers govern loading/unloading, and the client must remain online.

## Boosting

Run the fleet's mining support with optional mining drones.

| Setting | What it controls |
| --- | --- |
| **Mining command bursts** | Automatically activate fitted, online mining bursts with their charges. Boosts begin five seconds after arrival. |
| **Industrial Core** | Enable automatic supported Core activations. |
| **Asteroid Ore Compressor** | Enable automatic supported compressor activations. |
| **Equipment intervals** | Set an interval for each listed Core/compressor type, or reset to its fitted default. Intervals follow successful starts and cannot be shorter than the native cycle. |
| **Heavy Water restocking** | Enable, choose fuel station/source storage and set reserve/refill targets in Core cycles. Defaults: **2** reserve, **20** refill. The target must exceed the reserve. |
| **Allow Heavy Water in cargo** | Permit cargo as fuel storage alongside the supported fuel hold. |
| **Receive fleet ore** | Enable nearby fleet miners to transfer accepted ore into the fleet hangar. |
| **Ore acceptance** | Independent **compressed** and **uncompressed** switches: both on accepts both; both off accepts none. |
| **Mining drones/filter** | Optional drone mining with ordered filters, its own target priority and focus/spread mode. |
| **Compression/stacking** | Accessible automatic compression and separate hold-stacking controls. |

For collection, miners choose **Put into booster's fleet hangar**. Both ships must share a fleet, have hangar access and be within **2500 m** transfer range. Accepted ore can move from the fleet hangar into the booster's mining hold when space permits. Compressed-only reception waits for configured compression, including between timed activations; raw ore stays aboard until acceptable.

Collection stays on grid. The booster does not chase bins or automatically unload received ore. Heavy Water restocking takes **existing accessible stock**; nothing is bought or created. Missing fuel or access can leave the ship docked. An active Core cycle can block travel; Stop prevents future cycles rather than ending the current native cycle instantly.

## PVE

Choose one of three assignments:

| Assignment | Setup and behavior |
| --- | --- |
| **Belt patrol** | Find/select an asteroid belt by belt or system name. Travel to that belt and engage eligible native belt rats. |
| **Fleet escort** | Select the fleet and preferred pilot. Idle orbit defaults to **2500 m**; combat switches to a rat, then returns to a fleet pilot. Another eligible fleetmate on grid can replace a missing anchor. When none remains, the escort stops its own orbit and stays **ON**, waiting. |
| **Reinforcement standby** | Choose home station and a **0–50 jump** range, default **2**. Respond to valid fleet calls, then return home after **60 seconds** without threats. **0 jumps means the same system**, including other grids. |

| Setting | What it controls |
| --- | --- |
| **Weapon fire mode** | Focus fire or spread fire. |
| **Hostile priority** | Strongest or weakest first. |
| **Orbit range override** | **0** follows the highest-DPS supported weapon's range, ammunition and skills; enter a distance to override it. |
| **PVE drones** | Enable and select the combat drone group. |
| **Restock ammo when docked** | Move compatible ammunition from selected accessible station storage. |
| **Ammo targets** | Search ammo and set extra rounds to keep in cargo; loaded rounds are shown separately. **0 disables restocking** for that ammunition type. |

Weapons reload through native operations using cargo ammunition. Restocking uses **existing stock and never buys ammo**. This does not provide an ammo-shopping route.

PVE targets public-grid native belt rats/pirate NPCs. Supported direct weapons are laser, hybrid, projectile and precursor turrets plus missile launchers; defender and auto-targeting missile charges are excluded. This is assisted belt/fleet combat, not general mission automation or player/neutral targeting. Fitting, native weapon/drone limits, current fleet participants and an online client still matter.

## Shared Fleet, Defense, Drones and Statistics

**Fleet:** Manual mode uses a selected saved roster preset. Automatic mode groups participating pilots on a settled public grid and preserves existing manually formed fleets. Refresh/edit the roster and save/delete shared presets. Call reinforcements manually, or enable calls when attacked; choose **1–8 responders**, default **1**. Only the current native **fleet boss** can confirm **Stop fleet AutoMining**. It stops current online members' jobs and orders their deployed drones home; an order is not guaranteed recovery.

**Defense:** Enable retreat, independently watch shield/armor and set **1–100%** thresholds, default **30%**. Uses the shared retreat/mining-unload destination and storage. Shield retreat initially waits for drones, escalating if shield is lost or armor takes damage. Armor retreat orders recall and departs urgently, so drones may remain outside. Active Core cycles can delay travel. A completed retreat leaves AutoMining **off**.

**Drones:** Choose an existing launch group and optionally launch on arrival at a mining site. For Mining/Boosting, select mining and fighter groups for rat response: recall miners, launch fighters, then restore miners when rats clear. New waves can interrupt that return. **Recall before warp/dock** is on by default, works while the job is off and lets fleet warp wait for members' drones. Stop cancels a pending departure. PVE uses its own combat-drone group controls.

**Statistics:** View pilot current run, today UTC, last seven days UTC or since tracking began, plus the fleet's current operation and roster. Track harvested units/m³, module versus drone yield, residue, docks/unloads, collected/delivered ore and rat kills/damage. Hauling, compression and stacking do not become newly mined yield. **Start new run** archives and resets your own run; other pilots keep theirs. **Sessions** retains the latest **50** archived runs.

## Chat commands

Commands are **case-insensitive**. The examples use `!`; unprefixed commands also work. The slash form follows native permissions and is available to GM characters. Known translated command/action aliases and localized resource names are accepted.

| Example | Action |
| --- | --- |
| `!automining` | Open the settings window. |
| `!automining on` / `!automining off` | Start or stop the selected job. |
| `!automining status` | Show current status/settings. |
| `!automining help` | Open the window when the companion is ready, otherwise show help. |
| `!automining veldspar,scordite` | Replace the filter with this ordered list. |
| `!automining clear` | Clear the filter; allow all compatible resources. |
| `!automining nearest` / `furthest` / `largest` / `smallest` | Set target priority; prefix each choice with `!automining`. |
| `!automining approach on` | Enable approach; use `off` to disable. |
| `!automining lock off` | Use manual locks; use `on` to enable automatic locking. |
| `!automining survey on` | Enable automatic survey; use `off` to disable. |
| `!automining survey 30` | Set a 30-second survey interval; `survey interval 30` also works. |
| `!automining compress on` | Enable accessible automatic compression; use `off` to disable. |

Configure assignments in the in-game window. Advanced compression commands remain available alongside saved job preferences.

## If a job pauses

Read its status line, correct the destination, stock, permissions or missing group, apply the settings and use **Start / Resume**. Reconnect after an update if the client companion is outdated. Failed unloading stays docked instead of assuming the cargo arrived.

Report the AutoMining version, EveJS/backend version, client build, selected job and exact status message with relevant server/client logs.

[MIT license](LICENSE).
