export function createRunSeed() {
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0] || 1;
  }
  return ((Date.now() ^ Math.floor((globalThis.performance?.now?.() || 0) * 1000)) >>> 0) || 1;
}

export class SeededRandom {
  constructor(seed = createRunSeed()) {
    this.setSeed(seed);
  }

  setSeed(seed) {
    this.seed = (seed >>> 0) || 1;
    this.state = this.seed;
  }

  next() {
    let value = (this.state += 0x6D2B79F5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  between(min, max) {
    return min + this.next() * (max - min);
  }
}
