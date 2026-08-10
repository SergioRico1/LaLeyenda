/**
 * sfx.ts — the audio bus. §3.9, §3.11, §3.22 and §5.7.
 *
 * There was no sound of any kind in the game. Haptics were wired correctly, but
 * `navigator.vibrate` is a no-op on iOS, so on roughly half the target devices
 * every tap, every collect and every completion was silent.
 *
 * Everything here is SYNTHESISED rather than sampled, for three reasons that
 * are all requirements rather than preferences:
 *
 *   · this is an offline PWA under a strict CSP — a dozen bundled .mp3 files is
 *     a dozen more things that have to be fetched, cached and version-matched;
 *   · §3.9 asks for the coin chink to be pitch-randomised ±2 semitones so five
 *     collections in a row do not sound identical, which is one line here and a
 *     resampler with a sample;
 *   · a chest burst that has to duck a coin chink is a mixing problem, and a
 *     shared gain bus with a compressor solves it once.
 *
 * iOS will not start an AudioContext outside a user gesture, so the context is
 * created lazily on the first pointerdown and the first call before that is
 * dropped rather than queued — a sound that arrives half a second late is worse
 * than one that never played.
 *
 * §5's reduced-motion rule is explicit that SOUND SURVIVES when motion is cut,
 * so this is deliberately NOT gated on FROZEN. It is gated on SHOT: the
 * screenshot harness runs dozens of captures in a headless browser and an
 * AudioContext there is pure noise in the logs.
 *
 * ─── THE MIX (round 11 — every entry levelled against every other) ─────────
 *
 * One ladder, both scenes, so switching island ↔ sea never jumps the volume.
 * `gain` is the rung; a LOW voice needs a higher number than a bright one to
 * land on the same rung (equal-loudness: the ear discounts the bottom octaves,
 * which is why the sea bank runs numerically hotter than the island bank and
 * sounds level with it).
 *
 *   .10–.13  chrome whispers   tick, sheetIn/Out, press — the beds. The tap is
 *                              the quietest thing a finger causes on purpose.
 *   .16–.20  connective        pop, land, refuse — statements, not rewards.
 *   .22–.28  the loop's pay    build < coin < mobDown/loot < levelup/tell —
 *                              COLLECT beats PLACE beats TAP, by §3.9's own
 *                              logic: the bubble is why the player opened the
 *                              app, the carpenter is what they spent, the tap
 *                              is only how.
 *   .26–.30  battle            cannon < hitHull — your own guns must never
 *                              outrank your own hull taking a bite.
 *   .34–.40  the two summits   chestBurst (the island's payoff), sinking (the
 *                              sea's price). Nothing else may reach them.
 *
 * Nothing was retired: all 19 entries have live call sites and none reads as
 * noise — the round's audit asked, and the honest answer is the bank was cut
 * well and levelled unevenly, so this pass moves gains, not sounds.
 */

import { SHOT } from './env';

type Wave = OscillatorType;

interface Voice {
  /** Base frequency in Hz. */
  hz: number;
  /** Frequency at the end of the note, for a sweep. Defaults to `hz`. */
  to?: number;
  wave?: Wave;
  /** Seconds. */
  attack?: number;
  decay: number;
  gain?: number;
  /** Seconds to wait before this voice starts, for layered hits. */
  delay?: number;
  /** Low-pass cutoff; omit for none. */
  cutoff?: number;
}

export type SfxName =
  | 'press' | 'tick' | 'refuse'
  | 'coin' | 'land' | 'pop'
  | 'build' | 'levelup'
  | 'sheetIn' | 'sheetOut'
  | 'cannon' | 'hitMob' | 'hitHull' | 'mobDown' | 'loot' | 'sinking'
  | 'chestShake' | 'chestBurst' | 'reward';

/**
 * One entry per sound. A "sound" is a stack of voices, which is what stops the
 * whole set reading as the same square-wave beep at different pitches.
 */
const BANK: Record<SfxName, { voices: Voice[]; gain: number; detune?: number }> = {
  // A short woody knock. The FLOOR of the whole mix: it plays on every single
  // tap, so anything the tap causes must clear it. Was .16 — close enough to
  // the coin that collecting barely outranked pressing.
  press:  { gain: .13, voices: [{ hz: 320, to: 180, wave: 'triangle', decay: .055, cutoff: 2200 }] },
  tick:   { gain: .10, voices: [{ hz: 900, to: 780, wave: 'square', decay: .022, cutoff: 3000 }] },
  // Two notes DOWN — the universal "no". Paired with the ui-refuse shake.
  // Present but under every reward: information, not an event.
  refuse: { gain: .20, voices: [
    { hz: 220, to: 190, wave: 'square', decay: .09, cutoff: 1200 },
    { hz: 150, to: 120, wave: 'square', decay: .13, delay: .085, cutoff: 900 },
  ] },
  // §3.9's coin chink: two stacked partials a fifth apart, pitch randomised.
  // The star of the minute loop — RETENTION.md's whole session opens on this
  // sound, so it sits ABOVE the carpenter (`build`) and well above the tap.
  coin:   { gain: .24, detune: 200, voices: [
    { hz: 1180, wave: 'triangle', decay: .085, gain: 1 },
    { hz: 1770, wave: 'sine',     decay: .13,  gain: .55, delay: .012 },
  ] },
  // The arrival, half a beat lower — the flight has to LAND on something.
  land:   { gain: .18, detune: 120, voices: [
    { hz: 660, to: 880, wave: 'triangle', decay: .1 },
    { hz: 1320, wave: 'sine', decay: .07, gain: .4, delay: .02 },
  ] },
  pop:    { gain: .16, voices: [{ hz: 520, to: 1040, wave: 'sine', decay: .09 }] },
  // Work — a carpenter going out, a finished building's ✓ claimed: a rising
  // major triad. Grand in SHAPE (three notes) rather than in level: it now
  // sits one rung under the coin, because collect > place is the ordering the
  // whole loop teaches, and the triad's length already carries the occasion.
  build:  { gain: .22, voices: [
    { hz: 523, wave: 'triangle', decay: .16 },
    { hz: 659, wave: 'triangle', decay: .16, delay: .085 },
    { hz: 784, wave: 'triangle', decay: .30, delay: .17 },
    { hz: 1046, wave: 'sine', decay: .34, gain: .5, delay: .17 },
  ] },
  // .26, a hair under its old .28: three long bright notes in the ear's most
  // sensitive band were out-shouting the chest burst — and the burst is the
  // island's summit, not this.
  levelup:{ gain: .26, voices: [
    { hz: 659, wave: 'triangle', decay: .13 },
    { hz: 880, wave: 'triangle', decay: .13, delay: .09 },
    { hz: 1318, wave: 'triangle', decay: .38, delay: .18 },
  ] },
  /* --- the sea ----------------------------------------------------------
   * A broadside is the sound the player hears most, so it is short and dry:
   * a low body with a click of powder on top, and 300 cents of spread so a
   * running fight never repeats the same report twice. Everything here is
   * pitched BELOW the island bank — out there the sea is the loud thing and
   * the UI chimes have no competition, but a cannon over a hull groan needs
   * room at the bottom of the mix. */
  // .26, down from .30: the report the player hears every few seconds must
  // never outrank the hull being bitten (.30) — your guns are routine, your
  // pain is news. Still the loudest ROUTINE thing at sea, as it should be.
  cannon:  { gain: .26, detune: 300, voices: [
    { hz: 150, to: 42, wave: 'square', decay: .16, cutoff: 480 },
    { hz: 900, to: 260, wave: 'sawtooth', decay: .05, gain: .5, cutoff: 2600 },
  ] },
  // A wet thud on the target. Quieter than the shot that caused it, or a
  // volley landing reads louder than the guns firing — but at .17 with one
  // dark triangle it was the quietest entry in the whole bank, which made the
  // game's hit-confirm inaudible in the very fight it confirms. Now .22 with
  // a short bright THWACK over the body: the click is what the ear finds in
  // a broadside exchange, the thud is still what the hit feels like. Peaks a
  // clear step under the cannon, no longer a whisper beneath it.
  hitMob:  { gain: .22, detune: 260, voices: [
    { hz: 210, to: 70, wave: 'triangle', decay: .085, cutoff: 1300 },
    { hz: 470, to: 170, wave: 'square', decay: .03, gain: .4, cutoff: 1900 },
  ] },
  // Taking damage is the one sound that must cut through: timber and a
  // downward slide, so it is unmistakably the player being hit. The timber
  // crack (second voice) carries more of the load now — at .45 the entry was
  // all sub-bass and actually peaked BELOW the player's own cannon, which is
  // the one inversion this bank must never have.
  hitHull: { gain: .30, detune: 90, voices: [
    { hz: 120, to: 46, wave: 'sawtooth', decay: .21, cutoff: 620 },
    { hz: 330, to: 150, wave: 'square', decay: .1, gain: .7, cutoff: 1500 },
  ] },
  mobDown: { gain: .26, voices: [
    { hz: 300, to: 120, wave: 'triangle', decay: .16, cutoff: 1400 },
    { hz: 150, to: 60, wave: 'sine', decay: .26, gain: .7, delay: .04 },
  ] },
  // Rising, and the only rising sound out here — reward has to be legible
  // against a bank where everything else falls.
  loot:    { gain: .24, detune: 150, voices: [
    { hz: 480, to: 960, wave: 'sine', decay: .12 },
    { hz: 720, to: 1440, wave: 'triangle', decay: .1, gain: .5, delay: .05 },
  ] },
  // The sea's summit, and the audit's "must cut through". Two dark voices at
  // .34 were numerically loud and perceptually buried — a 34 Hz tail under a
  // cannon exchange is felt at best. .40, plus a MID groan (the new first
  // voice): timber tearing in the 300 Hz band the battle leaves empty, so the
  // moment reads over guns, bites and its own compressor ducking. The only
  // entry allowed past the chest burst, because it is the one that costs.
  sinking: { gain: .40, voices: [
    { hz: 340, to: 70, wave: 'sawtooth', decay: .6, gain: .5, delay: .04, cutoff: 1100 },
    { hz: 200, to: 34, wave: 'sawtooth', decay: .9, cutoff: 400 },
    { hz: 90, to: 28, wave: 'square', decay: 1.2, gain: .6, delay: .1, cutoff: 260 },
  ] },

  sheetIn:  { gain: .13, voices: [{ hz: 180, to: 420, wave: 'sine', decay: .13, cutoff: 1400 }] },
  sheetOut: { gain: .11, voices: [{ hz: 400, to: 170, wave: 'sine', decay: .1, cutoff: 1400 }] },
  // In practice this is the SQUID TELL (seaScene plays it at −7 st; nothing on
  // the island calls it today). One knock at .14 was the second-quietest entry
  // in the bank standing in for the boss's only warning — the audit's walked
  // voyages died without the player ever hearing it. Now a double rattle with
  // a dry MID click on each knock and a low swell under them, at .28. The
  // clicks are the part that survives the −7 shift: everything else in the
  // entry drops below 100 Hz out there, and a warning made only of bass loses
  // to the ear before it ever meets the cannon fire. Still short and dry — it
  // repeats every cast — and still a shaken chest at native pitch if the
  // staged chest moment ever wants it.
  chestShake: { gain: .28, voices: [
    { hz: 140, to: 90, wave: 'square', decay: .07, cutoff: 700 },
    { hz: 620, to: 430, wave: 'square', decay: .045, gain: .5, cutoff: 2000 },
    { hz: 132, to: 84, wave: 'square', decay: .07, delay: .09, cutoff: 700 },
    { hz: 585, to: 400, wave: 'square', decay: .045, gain: .45, delay: .09, cutoff: 2000 },
    { hz: 70, to: 46, wave: 'sine', decay: .3, gain: .55, cutoff: 300 },
  ] },
  // §3.22's burst: a bass hit under a bright flash, paired with vibrate(20).
  // The flash carries a little more of the load (.5 → .62) so the island's
  // summit stays audibly ABOVE the levelup fanfare, not merely below it in
  // the bass the ear discounts.
  chestBurst: { gain: .34, voices: [
    { hz: 90, to: 45, wave: 'sine', decay: .42, gain: 1 },
    { hz: 880, to: 2200, wave: 'triangle', decay: .3, gain: .62 },
  ] },
  // §3.22 deals reward tiles a semitone higher each time — see `reveal()`.
  reward: { gain: .22, voices: [
    { hz: 880, wave: 'triangle', decay: .12 },
    { hz: 1760, wave: 'sine', decay: .09, gain: .4, delay: .015 },
  ] },
};

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let muted = SHOT;
/** Repeat-detune state, so five collects in a row are five different pitches. */
const lastAt = new Map<SfxName, number>();

function ensure(): AudioContext | null {
  if (muted) return null;
  if (ctx) return ctx;
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) { muted = true; return null; }
  try {
    ctx = new Ctor();
  } catch { muted = true; return null; }

  // A compressor on the master bus is what lets a chest burst and six coin
  // chinks overlap without clipping into a buzz.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 8;
  comp.attack.value = .003;
  comp.release.value = .12;
  bus = ctx.createGain();
  bus.gain.value = .9;
  bus.connect(comp);
  comp.connect(ctx.destination);
  return ctx;
}

/**
 * iOS refuses to start an AudioContext outside a user gesture and, worse,
 * SUSPENDS one that was created too early. Both are fixed by creating and
 * resuming from the first pointerdown anywhere on the document.
 */
export function unlockAudio(): void {
  const audio = ensure();
  if (!audio) return;
  if (audio.state === 'suspended') void audio.resume();
}

if (!SHOT && typeof document !== 'undefined') {
  const unlock = () => unlockAudio();
  document.addEventListener('pointerdown', unlock, { capture: true });
  document.addEventListener('touchstart', unlock, { capture: true, passive: true });
}

/**
 * Plays one entry from the bank.
 *
 * `semitones` shifts the whole stack, which is how §3.22's reward tiles chime
 * one semitone higher than the last one. `detune` in the bank is a RANDOM
 * spread in cents applied per play, which is the §3.9 requirement.
 */
export function sfx(name: SfxName, semitones = 0): void {
  const audio = ensure();
  if (!audio || !bus) return;
  const entry = BANK[name];
  if (!entry) return;

  // Two identical sounds inside 25ms is a double-fire, not a chord: collapse
  // them, or a Recoger Todo of eight bubbles is a wall of noise.
  const now = audio.currentTime;
  const previous = lastAt.get(name) ?? -1;
  if (now - previous < .025) return;
  lastAt.set(name, now);

  const spread = entry.detune ? (Math.random() * 2 - 1) * entry.detune : 0;
  const shift = Math.pow(2, semitones / 12) * Math.pow(2, spread / 1200);

  for (const voice of entry.voices) {
    const at = now + (voice.delay ?? 0);
    const osc = audio.createOscillator();
    osc.type = voice.wave ?? 'sine';
    osc.frequency.setValueAtTime(voice.hz * shift, at);
    if (voice.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, voice.to * shift), at + voice.decay);

    const env = audio.createGain();
    const attack = voice.attack ?? .004;
    const peak = entry.gain * (voice.gain ?? 1);
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.max(.0002, peak), at + attack);
    env.gain.exponentialRampToValueAtTime(.0001, at + attack + voice.decay);

    let tail: AudioNode = env;
    if (voice.cutoff) {
      const filter = audio.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = voice.cutoff;
      env.connect(filter);
      tail = filter;
    }
    osc.connect(env);
    tail.connect(bus);
    osc.start(at);
    osc.stop(at + attack + voice.decay + .04);
  }
}
