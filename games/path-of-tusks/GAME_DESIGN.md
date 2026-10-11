# Path of Tusks — Game Design Document

**One-line pitch:** A dark, hand-crafted 2D action-exploration game (in the style of Hollow Knight) where you play Hannibal Barca, riding a war elephant from Carthaginian Spain across the Alps to bring down Rome.

**Platform:** Phone first (iOS + Android, played in landscape), with PC/web as a bonus.
**Genre:** 2D action platformer / "Metroidvania": one big connected world, where new abilities open up new paths.
**Status:** Playable demo, see `index.html` in this folder.

---

## 1. What we're borrowing vs. what's ours

We borrow the *concept*: game mechanics and structure aren't copyrighted. Everything you see and hear is original.

| Hollow Knight idea (borrowed concept) | Path of Tusks version (ours) |
|---|---|
| A silent knight with a nail | Hannibal on a war elephant with a spear |
| Health "masks" | **Shields**: round Carthaginian shields |
| "Soul" meter, spent to heal | **Fury**: filled by striking enemies, spent to **Rally** (heal) |
| Geo currency | **Silver** (Carthaginian shekels) |
| Benches to save | **Campfires** with Carthaginian banners |
| Dying leaves your Shade holding your Geo | Dying leaves your **Fallen Standard** holding your silver |
| Downward nail "pogo" | **Downward spear strike** that bounces off enemies and spikes |
| Mothwing Cloak dash | **Elephant Charge**: a rush that breaks cracked stone walls |
| Bug kingdom of Hallownest | Real history: the Second Punic War, 218–216 BC |

**Our twist:** you are *one rider on one huge animal*. The elephant is the main character as much as Hannibal is. Its weight, size and strength drive the abilities (charging, trampling, trumpeting), and later the elephant itself can level up and get armored.

---

## 2. Core loop

1. **Explore** a connected region and find paths you can't take yet.
2. **Fight** Roman soldiers to earn silver and fury.
3. **Find an ability** (e.g. Elephant Charge), which opens paths you saw earlier.
4. **Beat the region's boss**, a historical Roman commander.
5. **Rest at a campfire**, spend silver on upgrades, and march on to the next region.

---

## 3. The world (based on Hannibal's real route)

| # | Region | Real event | Ability gained | Boss |
|---|---|---|---|---|
| 1 | New Carthage (hub camp) | Hannibal's base in Spain, 218 BC | — | — |
| 2 | The Pyrenees | Crossing into Gaul | Elephant Charge | Gaulish chieftain |
| 3 | The Rhône River | Elephants rafted across the river | **Trunk Grab**: swing from branches and ropes | River warlord |
| 4 | The Alps | Snow, cliffs, rockslides, the famous crossing | **Trumpet Roar**: stuns enemies, shakes loose rockfalls | Mountain tribe king |
| 5 | The River Trebia | First big victory (Dec 218 BC) | **Ice Stride**: walk on frozen water | Consul Sempronius Longus |
| 6 | Lake Trasimene | The fog ambush (217 BC) | **War Paint**: see through the fog and hidden walls | Consul Flaminius |
| 7 | Cannae | The famous encirclement (216 BC) | **Double Tusk**: a second jump | Consuls Varro & Paullus |
| 8 | Gates of Rome | The march Hannibal never finished | — | Final boss: Scipio |

**Ending idea:** history says Hannibal never took Rome. A secret "true ending" lets the player rewrite history by collecting all the lost war elephants.

---

## 4. Player abilities

| Ability | Controls (phone) | What it does | Unlocked |
|---|---|---|---|
| Move / Jump | D-pad / Jump | Hold Jump to jump higher | Start |
| Spear Strike | Strike | Forward thrust; hits enemies and knocks thrown stones out of the air | Start |
| Down Strike | Hold ▼ + Strike in the air | Bounces off enemies and spikes | Start |
| Rally | Hold Rally | Spend 1/3 fury to restore 1 shield | Start |
| Elephant Charge | Charge | Fast rush; damages enemies and breaks cracked walls | Region 2 (in the demo: the Shrine) |
| Trunk Grab | Grab | Swing from hooks and ropes | Region 3 |
| Trumpet Roar | Roar | Stuns enemies around you; brings down rockfalls | Region 4 |
| Double Tusk | Jump in the air | Second jump | Region 7 |

---

## 5. Enemies

- **Legionary**: patrols, raises his shield, then lunges with his short sword. Watch for the glint above his head.
- **Slinger**: stands on high ledges and throws stones in an arc. Strike the stones to knock them out of the air.
- **Velite** (planned): light skirmisher who throws javelins and runs away.
- **Centurion** (planned): blocks frontal attacks; hit him from above with the down strike.
- **Roman cavalry** (planned): charges across the screen; jump over it.

**Demo boss, Sempronius Longus:** three attacks, each with a warning glint first:
1. Shield rush across the arena. He's stunned if he hits a wall, which is your chance to hit back.
2. Leap and slam, which sends shockwaves along the ground. Jump over them.
3. Volley of javelins (pila) thrown at your position.

Below half health he gets faster and throws more javelins.

---

## 6. Look and sound

- **Art direction:** dark, moody, snowy night tones, with gold, Carthaginian purple and Roman red as the only bright colors. Hannibal's purple cloak and bronze helmet should stand out in every scene.
- **Production art plan:** hand-drawn 2D sprites. Generate concept art with AI, then have a pixel or 2D artist clean it up for consistent style.
- **Music:** low drums, horns, an elephant-trumpet motif for big moments.
- **Each area name appears on screen when you first enter**, like in Hollow Knight.

---

## 7. Making money (options)

1. **Premium game** ($4.99–$9.99, one-time purchase). Best fit for this genre; Hollow Knight sold this way.
2. **Free demo + unlock full game** (first two regions free, a one-time in-app purchase for the rest). Usually the best choice for phones.
3. Avoid ads during gameplay. They ruin this kind of atmospheric game.

---

## 8. Roadmap

| Phase | What | Result |
|---|---|---|
| ✅ 1. Playable demo | 5 rooms, combat, Elephant Charge, Trebia boss, save system, phone controls | `index.html` (done) |
| 2. Feel and feedback | Playtest on real phones, tune jump and attack feel, add sound and music | A demo that feels good to play |
| 3. Build the real game | Port to **Godot** (free engine, exports to iOS and Android), real sprite art, full Region 1–2 | A vertical slice (one finished region) |
| 4. Content | Regions 3–8, all abilities, upgrades shop, all bosses | Full game |
| 5. Launch | Google Play ($25 one-time) and Apple App Store ($99/year) | Live in stores |

**Faster path to the stores:** the current web demo can also be wrapped as a phone app (with a tool called Capacitor) for an early test release, before the Godot version is ready.

---

## 9. Demo controls

| Action | Keyboard | Phone |
|---|---|---|
| Move | ← → (or A / D) | Left d-pad |
| Jump | Space (or Z) | Jump |
| Strike | X (or J) | Strike |
| Down strike | Hold ↓ + X in the air | Hold ▼ + Strike in the air |
| Charge (after the shrine) | C (or K, Shift) | Charge |
| Rally / heal | Hold V (or L) | Hold Rally |
| Drop through a wooden platform | ↓ + Space | ▼ + Jump |

Progress is saved automatically in your browser at each campfire.
