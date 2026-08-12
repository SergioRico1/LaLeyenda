# The voyage as a game — what is missing and why

The owner, 12 Aug: *"lo importante es mejorar mucho más el gameplay al zarpar,
que ahora mismo es demasiado soso. Es ir con el barco, matar mobs
automáticamente y acercarte a islas. Nada más."*

That is an accurate description of the current loop, and the diagnosis has to
be sharper than "add more things", because adding things is how a flat game
becomes a busy flat game.

## What is actually wrong

**The player has one verb.** Steering. Cannons fire themselves — which is
PLAN.md's *sea survivors* design and stays — loot is taken by contact, and the
mobs die whether or not the player does anything clever. So positioning, the
skill the design says the game is about, is **optional**. Nothing punishes
sailing in a straight line.

**The voyage has no arc.** Minute ten is exactly as tense as minute one.
Pressure is spatial only — it rises when you sail outward and falls when you
sail back — so the only shape a voyage has is one the player draws by leaving.
There is no rising action and no reason to feel the pull of *one more site*.

**Nothing compounds.** Kills produce nothing but loot numbers. A voyage at
minute nine plays identically to minute one, with the same ship, the same
reload, the same everything. There is no build, no growth inside the run, and
therefore no fantasy of becoming powerful.

**Nothing is a trade-off.** A full hold weighs nothing. Turning costs nothing.
Fleeing is free. Every decision the sea offers is currently "yes".

PLAN.md claims survivors DNA, and survivors games work on four legs: passive
attacks plus positioning, **escalating pressure over time**, **an in-run build
from drops**, and **a clock that gives the run a shape**. We built the first
leg and none of the other three. That is the whole problem, and it is why the
answer is systems rather than content.

## The design

Four changes. They are interdependent on purpose — each one is what makes
another matter.

### 1 · LA MAREA — pressure that rises with TIME, not only distance

A tide level that climbs the longer the ship stays out, on top of the existing
ring difficulty. Higher tide means more mobs, tougher mobs, and closer spawns.

This is the arc. It turns *"one more site?"* into a genuine decision, gives
every voyage rising action, and makes leaving a judgement rather than a
shrug. It also finally makes the ring curve legible: distance is the *where*,
the tide is the *when*, and a player learns to read both.

Pure and seeded — the tide is a function of the voyage clock, so the harness
can play a thousand voyages and prove the curve.

### 2 · THE HOLD HAS WEIGHT

Cargo slows the ship and widens its turn, in proportion to how full it is.

The single cheapest change that makes risk physical instead of numerical. A
loaded ship is a slower ship, so running home rich is genuinely harder than
running home empty, and the decision to take one more wreck is felt through
the thumb rather than read off a counter. It also gives the tide teeth: heavy
and late is exactly when the sea should be frightening.

### 3 · PERTRECHOS — a build inside the voyage

Kills and sites drop *pertrechos*. At thresholds the voyage pauses and offers
**one of three** upgrades that last for this voyage only:

- *Metralla* — the broadside spreads, hitting more but each for less
- *Palanqueta* — chain shot, slows what it hits
- *Pólvora fina* — longer range on both sides
- *Fondo de cobre* — faster hull, better against the weight
- *Brigada de artilleros* — faster reload
- *Arpón* — pulls a target into the arc
- *Contramaestre* — the tide rises more slowly
- *Bodega falsa* — part of the hold is safe if you sink

Seeded, so the same voyage offers the same choices; three from a pool so a run
has a shape a player chose. This is the leg that makes kills mean something
and the one that creates the *just one more* pull. It is also where synergy
lives: grape plus range is a different ship from chain plus harpoon.

Pure sim, its own module, its own tests.

### 4 · UN VERBO — something to tap that is not the helm

One active ability on a cooldown. **Zafarrancho**: a short burst of speed and a
tighter turn.

One thumb-reachable button that changes every fight — dodge a telegraphed
strike, close on something fleeing, break a swarm's station-keeping, or run
when the tide has turned against you. It gives the player something to be
*good at* beyond holding a direction, without adding a second stick or a fire
button the design deliberately refuses.

## What this deliberately does NOT do

- **No fire button.** Cannons keep firing themselves. PLAN.md is right that the
  skill is turning your flank to the enemy and your bow to everything else, and
  the fix for "positioning is optional" is making mobs and the tide punish bad
  positioning — not handing the player a trigger.
- **No second stick, no gestures.** One thumb, one helm, one button.
- **No permanent power creep at sea.** Pertrechos die with the voyage. The
  long arc stays where RETENTION.md put it: hulls, the island, the shipyard.
- **No new art direction.** This is a systems round. The water won its blind
  comparison; nothing here touches it.

## How it will be judged

Not by a screenshot. By a playtester who sails three voyages and answers one
question: *did the tenth minute feel different from the first, and did you want
another go?* And by the harness — `tools/voyages.mjs` must show the tide
producing a survival curve that falls with time at sea, and the weight showing
up as a measurable difference between running home loaded and running home
empty.
