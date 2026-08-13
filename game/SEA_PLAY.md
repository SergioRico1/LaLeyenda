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

---

## 5 · EL SONDEO — the extraction beat (owner's idea, 12 Aug)

*"Al acercarte a una isla vas descubriendo por tiempo el botín y dices si
cogerlo o no, así en ese tiempo tienes la intriga de si te vienen a atacar."*

Right, and it is the best decision-per-second the sea can get. Today a site is
taken by contact — sail over it, numbers go up, zero drama. That is the flattest
verb in the game and it is attached to the thing the player sails toward.

**We already have the seed.** Round 12 gave wrecks a boarding beat: the party
rows over and the loot only lands if the ship holds station. This generalises
that to every site and adds the two things that turn a wait into a decision.

### The mechanic

Enter a site's radius and a **sondeo** begins. Loot is revealed in stages
rather than granted — a first tier quickly, the good stuff later — and it only
banks when you break off. Hold station and the survey continues; leave and you
take what has been revealed so far.

Four properties make it work, and three of them are the design rather than the
feature:

**PARTIAL EXTRACTION IS THE TENSION ENGINE.** Bailing with what you have must
always be allowed. The question is never "loot or not" — it is *"is the next
tier worth another twenty seconds"*, asked again every few seconds, with an
answer that changes as the situation does. One decision at the start would be a
menu; a decision that renews is a game.

**THE ATTENTION IS CAUSED, NOT ROLLED.** A sondeo makes noise — smoke, a
signal, whatever reads — and mobs are drawn to it. The danger must be a
consequence of the player's own choice, not a dice roll that happens to land
during it. That is the difference between tension and bad luck, and it is what
makes a player who dies at 90% blame themselves rather than the game.

**IT SPENDS THE ROUND'S OWN CURRENCY.** Time in a sondeo advances *la marea*.
So looting is not free even when nothing attacks: every site you strip makes
the rest of the voyage harder. The tide, the weight and the sondeo then form
one economy — you are always spending pressure to buy cargo, and carrying the
cargo costs speed.

**THE VERB IS THE HELM.** No new button. Staying is steering to stay; leaving
is steering away. The existing thumb does it, and the read is immediate. A
"tomar y huir" affordance can confirm the bank, but the decision itself lives
in the stick where it belongs.

### What the player must see

The tier ladder with what is already secured and what the next stage would add;
a survey clock; and — most important — **the approach of whatever the noise
drew**, early enough to decide with. A player who is surprised at 90% learns
nothing; a player who sees three sails on the horizon at 60% and chooses to
stay has played a game.

### Where it goes

Round 17, not 16. Round 16's builders are inside `src/sim/sea.ts` and the sea
HUD right now, which is exactly the collision this project has spent sixteen
rounds avoiding — and the sondeo genuinely wants the tide to already exist,
because "looting raises the tide" is the sentence that makes it a cost rather
than a free timer.

Sequenced deliberately: 16 gives the voyage an arc and a build, 17 gives its
best moment a decision.
