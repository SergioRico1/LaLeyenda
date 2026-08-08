/** Deterministic RNG. The sim must never touch Math.random, so every random
 *  draw in gameplay comes from a seeded stream that replays identically. */
export class Rng {
  private state: number;

  constructor(seed: number | string) {
    this.state = typeof seed === 'string' ? Rng.hash(seed) : seed >>> 0;
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  /** The serializable cursor. A save stores this so a reload continues the
   *  same stream instead of replaying rolls the player already saw. */
  get cursor(): number {
    return this.state;
  }

  set cursor(value: number) {
    this.state = value >>> 0;
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  static hash(str: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /** mulberry32 — small, fast, good enough for gameplay and terrain. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))];
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  fork(salt: string): Rng {
    return new Rng((this.state ^ Rng.hash(salt)) >>> 0);
  }
}
