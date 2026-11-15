export class Sound {
  constructor() {
    try {
      this.muted = localStorage.getItem('d-pressed-muted') === '1';
    } catch {
      this.muted = false;
    }
  }

  unlock() {
    if (this.muted) return;
    try {
      this.context ??= new (window.AudioContext || window.webkitAudioContext)();
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    } catch {
      this.context = null;
    }
  }

  tone(frequency, duration = 0.12, delay = 0, volume = 0.045, type = 'sine') {
    if (this.muted) return;
    this.unlock();
    if (!this.context) return;
    const time = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    oscillator.connect(gain);
    gain.connect(this.context.destination);
    oscillator.start(time);
    oscillator.stop(time + duration);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }

  land(count = 1) { this.tone(168 - Math.min(count, 3) * 22, 0.12, 0, 0.06); this.tone(78, 0.15, 0.005, 0.04); }
  reward() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.14 + i * 0.025, i * 0.05, 0.04)); }
  bonus() { [659, 988, 1318].forEach((f, i) => this.tone(f, 0.15 + i * 0.05, i * 0.09, 0.04)); }
  chest() {
    [261.63, 392, 523.25, 783.99].forEach((f, i) => this.tone(f, 0.22, i * 0.08, 0.065, 'triangle'));
    this.tone(1046.5, 0.35, 0.3, 0.055);
  }
  hit() {
    this.tone(150, 0.055, 0, 0.055, 'square');
    this.tone(82, 0.08, 0.008, 0.04, 'triangle');
  }
  deny() { this.tone(180, 0.08, 0, 0.018, 'triangle'); }
  over() { [392, 330, 261].forEach((f, i) => this.tone(f, 0.24 + i * 0.13, i * 0.15, 0.04)); }
}
