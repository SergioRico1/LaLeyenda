import {
  MOBS, SEA_CELL, SEA_RANGE, SEA_STEP, SHIPS, SONDEO_TIERS, holdUsed, ringOf, sitesNear,
  startVoyage, steer, stepVoyage, tideAt, type Loadout, type Site, type Voyage,
} from '../../src/sim/sea';
import { Rng } from '../../src/core/rng';

/**
 * voyages.ts — a fleet of players, in a loop, with no browser.
 *
 * The sea shipped unbalanced for five rounds because there was no way to answer
 * "is this survivable?" other than by opening it on a phone and feeling bad.
 * PRODUCTION.md §3 recorded the symptom twice — "hull nearly gone in six
 * seconds", "nobody has played this" — and a test written the day this file
 * appeared had to be cut from thirty seconds to ten to have a boat left.
 *
 * The simulation is pure and deterministic, so the fix is not to look harder at
 * a screenshot: it is to play a thousand voyages and read the table. This file
 * is the autopilot that plays them. `node tools/voyages.mjs` prints the table;
 * `sea.test.ts` asserts the handful of numbers that must never regress.
 *
 * The autopilot is not an AI and is not trying to be good. It is a MODEL OF A
 * PERSON, and there are two of them, because a balance that only works for one
 * of them is not a balance:
 *
 * - **novato** — the player in their first minute. Thumb pinned, straight at
 *   whatever it wants, steers round rocks because rocks look like rocks and
 *   ploughs into islands because it has not learned they are solid yet, never
 *   thinks about which side the guns are on, never breaks off. If this one
 *   drowns in tutorial water the game is broken however good the ceiling is.
 * - **veterano** — the player who has understood the ship. Treats every island
 *   as solid, stands off a nest at gun range and clears it before going in,
 *   keeps a beam on whatever is closest, and turns for home at 45% hull.
 *
 * The one thing both copy exactly is the CONTROL. `src/ui/stick.ts` reports a
 * world direction and `seaScene` turns it into a helm with
 * `clamp(delta * 2.2)` — so that is what happens here, verbatim. Measuring a
 * pilot that can hold the rudder better than the input device allows would
 * measure a game nobody can play.
 *
 * WHAT THE TABLE SAYS, and it is not what anybody expected. Skill does not buy
 * survival: the two pilots come home at about the same rate. It buys a much
 * healthier hull and roughly twice the kills — which, since `sea.bounty` now
 * exists, is money. What it costs is TIME, and time at sea is itself the risk,
 * so the reckless line is the better rate of return and the careful line is the
 * better insurance. Two real answers to the same question, which is a game.
 * Turn the veteran into someone who clears EVERY defended island and it keeps a
 * beautiful hull and drowns more often than the beginner.
 */

export type Skill = 'novato' | 'veterano';

/** How the pilot steers, which is the same conversion `seaScene` applies to the
 *  stick: a wanted world heading in, a helm out. */
const HELM_GAIN = 2.2;

export interface VoyagePlan {
  /** How far out to push before turning for home. */
  ring: number;
  /** How many sites to take before turning for home. */
  sites: number;
  skill: Skill;
  /** Seconds before the run is abandoned as a timeout. */
  limit?: number;
  /**
   * HOW MANY TIERS OF A SONDEO THIS PILOT HOLDS FOR — round 17's decision, as a
   * dial the harness can sweep.
   *
   * A site is no longer taken by touching it: the survey turns its haul up in
   * tiers and banks whatever is up when the ship breaks off. So "how greedy" is
   * now a real strategy axis and the model needs it, or every row measures the
   * single greediest way to play and the table can no longer answer whether the
   * deep sea is playable at all — only whether STRIPPING it is.
   *
   * Defaults to the whole ladder, which is that greediest line.
   */
  greed?: number;
  /**
   * Seconds to STAY OUT working the band before turning for home, whatever the
   * hold and the quota say.
   *
   * The knob that measures LA MAREA. Everything else about a row is held fixed
   * and only this moves, so the survival column is a function of time at sea and
   * of nothing else — which is the claim SEA_PLAY.md item 1 makes and the one
   * `tools/voyages.mjs` has to be able to print rather than assert.
   *
   * A loitering pilot does not turn round on a full hold either. That is the
   * player the tide is for: the one who has what they came for and is still out
   * there for one more site.
   */
  loiter?: number;
  /**
   * The pertrechos this fleet sails with — SEA_PLAY.md item 3's seam.
   *
   * Undefined is the neutral loadout, which is the shipped ship. Its first use
   * is as the CONTROL for the tide: a fleet with `{ tideRate: 0 }` is the same
   * fleet in a sea where the clock does nothing, so the gap between the two
   * columns is the tide and not the ordinary cost of being out longer.
   */
  loadout?: Partial<Loadout>;
}

export interface VoyageResult {
  seed: string;
  outcome: 'home' | 'sunk' | 'timeout';
  /** Seconds of voyage. For a sinking, the time to sink. */
  seconds: number;
  /** Hull left as a fraction of the ship's maximum, 0..1. */
  hull: number;
  /** Units in the hold at the end — after the sinking penalty, if there was one. */
  cargo: number;
  looted: number;
  kills: number;
  /** The furthest ring the ship actually reached. */
  reached: number;
  /** How far from the harbour the ship ended up, in world units. */
  distance: number;
  damageFromMobs: number;
  damageFromReefs: number;
  /** The tide the voyage ended under, 0..1 — SEA_PLAY.md item 1. */
  tide: number;
  /** How many times the sea put something on the water beside her. */
  swells: number;
}

const TAU = Math.PI * 2;

function angleDelta(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** The ring the ship is standing in. Same query the HUD's zone chip makes. */
function ringAt(v: Voyage): number {
  return ringOf(Math.round(v.x / SEA_CELL), Math.round(v.y / SEA_CELL));
}

interface Pilot {
  /** The compass course this voyage set out on, so a fleet fans out. */
  course: number;
  /** Which way it sweeps the band once it is far enough out. */
  sweep: number;
  home: boolean;
  looted: number;
  /** The furthest ring it has actually stood in. */
  reached: number;
}

/**
 * One step of steering: where the pilot wants to point, and how hard.
 *
 * Everything here is a decision a thumb can make. There is no reading of mob
 * hit points, no path planning and no lookahead — only "what is near me, and
 * which way is that".
 */
function helmFor(v: Voyage, plan: VoyagePlan, pilot: Pilot): { turn: number; throttle: number } {
  const spec = SHIPS[v.shipType];
  const veteran = plan.skill === 'veterano';
  const hullLeft = v.hull / spec.hull;

  // --- when to give up on the trip ----------------------------------------
  // The trip is "sail out to ring N filling the hold on the way, then come
  // back", so BOTH halves have to be true before turning round — otherwise a
  // deep plan quietly becomes a shallow one, the quota fills in ring 2 and the
  // row measures water it never sailed in.
  //
  // A LOITERING pilot stays out until the clock says otherwise. It is the one
  // model of a player the sweep did not have and the one SEA_PLAY.md is about:
  // somebody who has what they came for and takes one more site anyway. Nothing
  // else about the pilot changes, so a row's survival is a function of `loiter`
  // and of nothing else.
  const staying = plan.loiter !== undefined && v.atSea < plan.loiter;
  pilot.reached = Math.max(pilot.reached, ringAt(v));
  if (pilot.looted >= plan.sites && pilot.reached >= plan.ring && !staying) pilot.home = true;
  if (holdUsed(v) >= spec.hold && !staying) pilot.home = true;
  // A novice does not read the hull bar in time. That is the model.
  if (veteran && hullLeft < 0.45) pilot.home = true;

  let aim: number;
  let throttle = 1;
  let avoidExcept = '';
  const near = sitesNear(v.seed, v.x, v.y, SEA_RANGE);

  // --- breaking off a survey ------------------------------------------------
  // The round-17 decision, made by a thumb: hold station for `greed` tiers and
  // then steer away, which is what banks. Everything about this is the helm —
  // there is no button in the sondeo and the model does not pretend there is.
  const greed = plan.greed ?? SONDEO_TIERS.length;
  if (v.sondeo && v.sondeo.tier >= greed) {
    const post = near.find((s) => s.id === v.sondeo?.siteId);
    if (post) {
      return {
        turn: Math.max(-1, Math.min(1, angleDelta(v.heading, Math.atan2(v.y - post.y, v.x - post.x)) * HELM_GAIN)),
        throttle: 1,
      };
    }
  }

  if (pilot.home) {
    aim = Math.atan2(-v.y, -v.x);
  } else {
    // The nearest thing worth touching that is not deeper than the plan and is
    // not a boss lair, which neither model of player is equipped to fight.
    let target: Site | null = null;
    let best = Infinity;
    for (const site of near) {
      if (site.kind === 'reef' || site.kind === 'lair') continue;
      if (site.ring > plan.ring || v.taken.includes(site.id)) continue;
      // Somebody running out to ring 4 does not stop for a ring-1 crate. Without
      // this the hold filled on scraps in tutorial water and the ship turned for
      // home before it had ever been where the plan said — every deep row was
      // secretly measuring ring 2.
      if (site.ring < plan.ring - 1) continue;
      const d = Math.hypot(site.x - v.x, site.y - v.y);
      if (d < best) { best = d; target = site; }
    }

    if (target) {
      // Straight at it, at speed. A site can be taken from ten units off its
      // shore, so there is nothing to slow down FOR — an earlier model of the
      // veteran eased off on the approach and simply arrived late and poorer
      // for it. Knowing when caution buys nothing is skill too.
      aim = Math.atan2(target.y - v.y, target.x - v.x);
      avoidExcept = target.id;

      // The one play that is actually skill: a defended site is CLEARED from
      // outside first. The guards are tethered to their island and the guns
      // out-range everything in the sea, so a ship that stands off at gun range
      // and circles kills them for nothing — while a ship that drives in takes
      // every bite in the ring. That is the whole of "the player plays
      // positioning" from PLAN.md Fase 2, expressed as a thumb on a stick.
      const guards = v.mobs.reduce((n, m) => n + (m.cell === target.id ? 1 : 0), 0);
      // Three or more is a nest and is worth the time; one or two is worth
      // driving through, because time at sea is itself the risk — a pilot that
      // stopped to clear EVERY defended island kept a beautiful hull and drowned
      // more often than one that kept moving.
      if (veteran && guards >= 3) {
        const range = Math.hypot(target.y - v.y, target.x - v.x);
        const standoff = spec.range * 0.8;
        const tangent = aim + pilot.sweep * (Math.PI / 2);
        const lean = Math.max(-0.9, Math.min(0.9, (range - standoff) / standoff));
        aim = tangent + angleDelta(tangent, lean > 0 ? aim : aim + Math.PI) * Math.abs(lean);
      }
    } else if (ringAt(v) < plan.ring) {
      aim = pilot.course; // nothing in sight — keep standing out to sea
    } else {
      // Far enough out, and nothing in sight. Work AROUND the band rather than
      // through it: a player hunting at a chosen distance circles, they do not
      // keep going. Drifting past the band leans the circle back inward, which
      // is what watching the zone chip looks like as a steering input.
      const outward = Math.atan2(v.y, v.x);
      const tangent = outward + pilot.sweep * (Math.PI / 2);
      aim = ringAt(v) > plan.ring
        ? tangent + angleDelta(tangent, outward + Math.PI) * 0.8
        : tangent;
    }
  }

  // --- keeping off the rocks -----------------------------------------------
  // What a player has learned to treat as solid, which is not the same thing
  // for the two of them. A reef LOOKS like a hazard and everybody steers round
  // one from the first minute. That an islet is just as hard, and that the shore
  // of the island you are heading for will turn your bow, is the second lesson —
  // so the beginner ploughs into scenery and the veteran does not, and the gap
  // between them is most of what a hull bar records on a shallow voyage.
  //
  // The site being steered AT is nobody's obstacle: it can be taken from ten
  // units off its shore, so there is no need to touch it at all.
  const watch = veteran ? 40 : 30;
  for (const site of near) {
    if (site.id === avoidExcept) continue;
    if (!veteran && site.kind !== 'reef') continue;
    const d = Math.hypot(site.x - v.x, site.y - v.y);
    const clear = site.radius + spec.radius + watch;
    if (d > clear) continue;
    const bearing = Math.atan2(site.y - v.y, site.x - v.x);
    const off = angleDelta(bearing, aim);
    if (Math.abs(off) > 1.0) continue; // already pointing past it
    aim = bearing + Math.sign(off || 1) * 1.0;
    if (veteran) throttle = Math.min(throttle, 0.55);
  }

  // --- what is chasing -----------------------------------------------------
  // The novice does not react to mobs at all. The veteran turns a beam onto the
  // nearest one, which is the whole skill the automatic broadsides are asking
  // for, and does it as a bias on the course rather than instead of it.
  if (veteran) {
    let threat = null as { x: number; y: number; d: number } | null;
    let crowd = 0;
    for (const mob of v.mobs) {
      const d = Math.hypot(mob.x - v.x, mob.y - v.y);
      if (d > spec.range * 1.3) continue;
      crowd++;
      if (!threat || d < threat.d) threat = { x: mob.x, y: mob.y, d };
    }
    // Knowing when NOT to fight is most of the skill. One or two on the beam is
    // a trade the guns win; four on a guarded site is a mugging, and the answer
    // is to hold the line, take the loot and leave. Measured: a pilot that
    // turned and fought whatever was nearest did WORSE than one that drove
    // straight past, which is exactly the trap a real player falls into.
    if (crowd > 2) threat = null;
    if (threat) {
      // Circle it at a distance that keeps it under the guns and outside its
      // own reach. This is the whole skill the automatic broadsides ask for:
      // the bearing is the tangent, and the range is held by leaning in or out
      // of it. A pilot that simply turns its beam and stops ends up inside the
      // jaws, which measured WORSE than driving straight past.
      const bearing = Math.atan2(threat.y - v.y, threat.x - v.x);
      const port = bearing + Math.PI / 2;
      const starboard = bearing - Math.PI / 2;
      const beam = Math.abs(angleDelta(aim, port)) < Math.abs(angleDelta(aim, starboard)) ? port : starboard;
      const hold = spec.range * 0.85;
      const lean = Math.max(-0.8, Math.min(0.8, (threat.d - hold) / hold));
      const orbit = beam + angleDelta(beam, lean > 0 ? bearing : bearing + Math.PI) * Math.abs(lean);
      const weight = 0.85 * Math.min(1, Math.max(0, (spec.range * 1.3 - threat.d) / (spec.range * 0.9)));
      aim += angleDelta(aim, orbit) * weight;
      throttle = 1;
    }
  }

  const delta = angleDelta(v.heading, aim);
  return { turn: Math.max(-1, Math.min(1, delta * HELM_GAIN)), throttle };
}

/** Plays one voyage end to end and reports what happened to it. */
export function playVoyage(seed: string, plan: VoyagePlan): VoyageResult {
  const spec = SHIPS.skiff;
  const rng = new Rng(`${seed}:pilot`);
  const pilot: Pilot = {
    course: rng.range(-Math.PI, Math.PI),
    sweep: rng.chance(0.5) ? 1 : -1,
    home: false,
    looted: 0,
    reached: 0,
  };

  let v = startVoyage(seed, 'skiff', { loadout: plan.loadout });
  const limit = plan.limit ?? 240;
  const steps = Math.round(limit / SEA_STEP);
  let kills = 0;
  let reached = 0;
  let damageFromMobs = 0;
  let damageFromReefs = 0;
  let outcome: VoyageResult['outcome'] = 'timeout';
  let taken = 0;

  for (taken = 0; taken < steps; taken++) {
    v = steer(v, helmFor(v, plan, pilot));
    const out = stepVoyage(v);
    v = out.voyage;
    reached = Math.max(reached, ringAt(v));
    for (const event of out.events) {
      if (event.kind === 'looted') pilot.looted++;
      if (event.kind === 'mob-killed') kills++;
      if (event.kind === 'hit' && event.target === 'ship') {
        if (event.by === 'reef') damageFromReefs += event.damage;
        else damageFromMobs += event.damage;
      }
    }
    if (v.sunk) { outcome = 'sunk'; break; }
    if (v.home) { outcome = 'home'; break; }
  }

  return {
    seed,
    outcome,
    seconds: (taken + 1) * SEA_STEP,
    hull: v.hull / spec.hull,
    cargo: holdUsed(v),
    looted: pilot.looted,
    kills,
    reached,
    distance: Math.hypot(v.x, v.y),
    damageFromMobs,
    damageFromReefs,
    tide: v.tide,
    swells: v.swells,
  };
}

/** A fleet of `count` voyages under the same plan, each on its own seed. */
export function playFleet(count: number, plan: VoyagePlan, tag = 'v'): VoyageResult[] {
  const out: VoyageResult[] = [];
  for (let i = 0; i < count; i++) out.push(playVoyage(`${tag}${i}`, plan));
  return out;
}

export interface FleetSummary {
  runs: number;
  /** Fraction that made it back to the harbour. */
  survived: number;
  sunk: number;
  timedOut: number;
  /** Median seconds to sink, over the ones that sank. 0 if none did. */
  timeToSink: number;
  /** Median voyage length for the ones that got home. */
  timeHome: number;
  /** Median cargo actually carried into the harbour. */
  cargoHome: number;
  /** Mean cargo per voyage counting the sinkings as what they salvaged. */
  cargoPerVoyage: number;
  /** Cargo actually banked per minute at sea, sinkings and all. The one number
   *  that says whether sailing further out is worth doing. */
  cargoPerMinute: number;
  /** Median hull fraction on arrival, over the ones that arrived. */
  hullHome: number;
  sitesHome: number;
  /** Median furthest ring actually stood in — proof the row sailed where it says. */
  reached: number;
  kills: number;
  /** Mean hull lost to jaws and to scenery, per voyage. */
  mobDamage: number;
  reefDamage: number;
  reefShare: number;
  /** Mean tide the voyages ended under, and mean swells they were sent. */
  tide: number;
  swells: number;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function summarise(runs: VoyageResult[]): FleetSummary {
  const home = runs.filter((r) => r.outcome === 'home');
  const sunk = runs.filter((r) => r.outcome === 'sunk');
  const mobDamage = runs.reduce((a, r) => a + r.damageFromMobs, 0);
  const reefDamage = runs.reduce((a, r) => a + r.damageFromReefs, 0);
  return {
    runs: runs.length,
    survived: home.length / runs.length,
    sunk: sunk.length / runs.length,
    timedOut: runs.filter((r) => r.outcome === 'timeout').length / runs.length,
    timeToSink: median(sunk.map((r) => r.seconds)),
    timeHome: median(home.map((r) => r.seconds)),
    cargoHome: median(home.map((r) => r.cargo)),
    cargoPerVoyage: mean(runs.map((r) => (r.outcome === 'home' ? r.cargo : 0))),
    cargoPerMinute: mean(runs.map((r) => (r.outcome === 'home' ? r.cargo : 0))) * 60
      / Math.max(1, mean(runs.map((r) => r.seconds))),
    hullHome: median(home.map((r) => r.hull)),
    sitesHome: median(home.map((r) => r.looted)),
    reached: median(runs.map((r) => r.reached)),
    kills: mean(runs.map((r) => r.kills)),
    mobDamage: mobDamage / runs.length,
    reefDamage: reefDamage / runs.length,
    reefShare: mobDamage + reefDamage > 0 ? reefDamage / (mobDamage + reefDamage) : 0,
    tide: mean(runs.map((r) => r.tide)),
    swells: mean(runs.map((r) => r.swells)),
  };
}

/**
 * The standard sweep: both pilots, rings 1 to 5, one line each.
 *
 * `sites` rises with the ring because a player who has sailed further expects
 * to fill more of the hold before turning round — going out to ring 4 for one
 * crate is not a trip anybody makes.
 */
export const SWEEP: VoyagePlan[] = ([1, 2, 3, 4, 5] as const).flatMap((ring) =>
  (['novato', 'veterano'] as const).map((skill) => ({
    ring, skill, sites: Math.min(6, 1 + ring), limit: 240,
  }))
);

/** A death-by-misadventure control: full throttle, straight out, never turning.
 *  This is the run PRODUCTION.md §3 says sinks the ship in thirty seconds. */
export function straightOut(seed: string, seconds: number): VoyageResult {
  let v = steer(startVoyage(seed), { turn: 0, throttle: 1 });
  const steps = Math.round(seconds / SEA_STEP);
  let kills = 0;
  let reached = 0;
  let damageFromMobs = 0;
  let damageFromReefs = 0;
  let outcome: VoyageResult['outcome'] = 'timeout';
  let taken = 0;
  for (taken = 0; taken < steps; taken++) {
    const out = stepVoyage(v);
    v = out.voyage;
    reached = Math.max(reached, ringAt(v));
    for (const event of out.events) {
      if (event.kind === 'mob-killed') kills++;
      if (event.kind === 'hit' && event.target === 'ship') {
        if (event.by === 'reef') damageFromReefs += event.damage;
        else damageFromMobs += event.damage;
      }
    }
    if (v.sunk) { outcome = 'sunk'; break; }
  }
  return {
    seed, outcome, seconds: (taken + 1) * SEA_STEP, hull: v.hull / SHIPS.skiff.hull,
    cargo: holdUsed(v), looted: v.taken.length, kills, reached,
    distance: Math.hypot(v.x, v.y), damageFromMobs, damageFromReefs,
    tide: v.tide, swells: v.swells,
  };
}

/**
 * Can a ship in trouble get out of it?
 *
 * This is the measurement behind "losing must be a DECISION". A hull at
 * `hullLeft` deep in ring `ring`, hold full, everything already awake — turn
 * for home and run. If this number is low, breaking off is theatre: the hull
 * bar is a countdown that started when the player left the harbour, nothing
 * they do changes the ending, and being sunk is something that happened to them.
 *
 * `opts` is what round 16 needed on top of it and nothing more. `load` is how
 * full the hold is, 0 to 1 — SEA_PLAY.md item 2's whole claim is that running
 * home rich is a different job from running home empty, and this is the same
 * ship on the same seeds from the same water with only that changed. `atSea`
 * puts the voyage clock forward before the run, so the same escape can be
 * measured at slack water and at the flood. Both default to exactly the run
 * that was measured before either existed: 400 units of gold and no tide.
 */
export function breakOff(
  seed: string, ring: number, hullLeft: number,
  opts: { load?: number; atSea?: number; loadout?: Partial<Loadout> } = {}
): VoyageResult {
  const spec = SHIPS.skiff;
  let v = startVoyage(seed, 'skiff', { loadout: opts.loadout });
  // Put her out there properly: on a bearing, in the band, and already hurt.
  const rng = new Rng(`${seed}:break`);
  const bearing = rng.range(-Math.PI, Math.PI);
  const out = SEA_CELL * (ring * ring + ring) * 0.5;
  v.x = Math.cos(bearing) * out;
  v.y = Math.sin(bearing) * out;
  v.hull = spec.hull * hullLeft;
  v.speed = spec.speed;
  v.heading = bearing + Math.PI;
  v.departed = true;
  v.cargo = { oro: Math.round((opts.load ?? 400 / spec.hold) * spec.hold) };
  // The clock, set before the first step so the water she is running through
  // was stocked at the hour she is actually running.
  v.atSea = opts.atSea ?? 0;
  v.tide = tideAt(v.atSea, v.loadout.tideRate);
  // One step to let every cell in range hand over its patrol, then run.
  v = stepVoyage(steer(v, { turn: 0, throttle: 1 })).voyage;

  let damageFromMobs = 0;
  let damageFromReefs = 0;
  let kills = 0;
  let outcome: VoyageResult['outcome'] = 'timeout';
  let taken = 0;
  const pilot: Pilot = { course: bearing, sweep: 1, home: true, looted: 99, reached: ring };
  const plan: VoyagePlan = { ring, sites: 0, skill: 'veterano' };
  for (taken = 0; taken < Math.round(180 / SEA_STEP); taken++) {
    v = steer(v, helmFor(v, plan, pilot));
    const step = stepVoyage(v);
    v = step.voyage;
    for (const event of step.events) {
      if (event.kind === 'mob-killed') kills++;
      if (event.kind === 'hit' && event.target === 'ship') {
        if (event.by === 'reef') damageFromReefs += event.damage; else damageFromMobs += event.damage;
      }
    }
    if (v.sunk) { outcome = 'sunk'; break; }
    if (v.home) { outcome = 'home'; break; }
  }
  return {
    seed, outcome, seconds: (taken + 1) * SEA_STEP, hull: v.hull / spec.hull,
    cargo: holdUsed(v), looted: 0, kills, reached: ring,
    distance: Math.hypot(v.x, v.y), damageFromMobs, damageFromReefs,
    tide: v.tide, swells: v.swells,
  };
}

/**
 * THE TIDE, SWEPT. SEA_PLAY.md item 1's proof, and the shape of it.
 *
 * The same ring, the same pilot, the same seeds — the only thing that changes
 * down a column is how long the ship stays out before turning for home. Run
 * twice, once in the real sea and once with `tideRate: 0`, which is the same
 * water on the same clock with the tide switched off through the loadout seam.
 * The control is the honest half of this: staying out longer costs something
 * even in a sea with no tide (more water crossed, more teeth met), so the only
 * number that says the tide works is the GAP between the two columns.
 */
export interface TideRow {
  loiter: number;
  ring: number;
  skill: Skill;
  /** With the tide. */
  survived: number;
  seconds: number;
  hull: number;
  cargo: number;
  tide: number;
  swells: number;
  kills: number;
  /** The same fleet in a sea whose clock does nothing. */
  flat: number;
  flatSeconds: number;
}

export function tideSweep(
  runs: number, ring: number, skill: Skill, loiters: readonly number[]
): TideRow[] {
  return loiters.map((loiter) => {
    const base = { ring, skill, sites: Math.min(6, 1 + ring), limit: loiter + 240, loiter };
    const wet = summarise(playFleet(runs, base, `tide-${skill}-${ring}-${loiter}-`));
    const dry = summarise(
      playFleet(runs, { ...base, loadout: { tideRate: 0 } }, `tide-${skill}-${ring}-${loiter}-`)
    );
    return {
      loiter, ring, skill,
      survived: wet.survived, seconds: wet.timeHome, hull: wet.hullHome,
      cargo: wet.cargoHome, tide: wet.tide, swells: wet.swells, kills: wet.kills,
      flat: dry.survived, flatSeconds: dry.timeHome,
    };
  });
}

/**
 * THE HOLD HAS WEIGHT. SEA_PLAY.md item 2's proof.
 *
 * One escape, run twice: identical seeds, identical water, identical hull —
 * empty hold against full hold. Everything the weight touches shows up in one
 * of these three columns, and if all three read the same the rule is not in the
 * game whatever the balance file says.
 */
export interface WeightRow {
  ring: number;
  hull: number;
  emptyHome: number;
  emptySeconds: number;
  emptyHull: number;
  fullHome: number;
  fullSeconds: number;
  fullHull: number;
}

export function weightRun(runs: number, ring: number, hullLeft: number): WeightRow {
  const fleet = (load: number) =>
    Array.from({ length: runs }, (_, i) => breakOff(`weight-${ring}-${hullLeft}-${i}`, ring, hullLeft, { load }));
  const empty = fleet(0);
  const full = fleet(1);
  const home = (rs: VoyageResult[]) => rs.filter((r) => r.outcome === 'home').length / rs.length;
  const secs = (rs: VoyageResult[]) => {
    const got = rs.filter((r) => r.outcome === 'home');
    return got.length ? got.reduce((a, r) => a + r.seconds, 0) / got.length : 0;
  };
  const hull = (rs: VoyageResult[]) => {
    const got = rs.filter((r) => r.outcome === 'home');
    return got.length ? got.reduce((a, r) => a + r.hull, 0) / got.length : 0;
  };
  return {
    ring, hull: hullLeft,
    emptyHome: home(empty), emptySeconds: secs(empty), emptyHull: hull(empty),
    fullHome: home(full), fullSeconds: secs(full), fullHull: hull(full),
  };
}

/** Time to kill one mob of each kind, one on the beam, nobody else about.
 *  The number that decides whether a fight is a fight or a chore. */
export function timeToKill(kind: keyof typeof MOBS): number {
  const v = startVoyage('ttk');
  v.mobs.push({
    id: 1, kind, x: 0, y: 26, heading: 0, hp: MOBS[kind].hp, state: 'patrol',
    cooldown: 0, homeX: 0, homeY: 26, tether: 0, cell: '9:9',
  });
  for (let cx = -3; cx <= 3; cx++) for (let cy = -3; cy <= 3; cy++) v.seen.push(`${cx}:${cy}`);
  let cur = steer(v, { turn: 0, throttle: 0 });
  for (let i = 0; i < 30 * 60; i++) {
    const out = stepVoyage(cur);
    cur = out.voyage;
    if (out.events.some((e) => e.kind === 'mob-killed')) return (i + 1) * SEA_STEP;
    if (cur.sunk) return Infinity;
  }
  return Infinity;
}
