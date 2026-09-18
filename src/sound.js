// Sound engine for Patchboard.
//
// Every effect is synthesized at runtime with Web Audio oscillators, so there is
// nothing to license or host. Audio never starts without a user gesture: the
// AudioContext is created lazily on the first sound and resumed on demand.
//
// A single master gain lets the header mute control silence everything at once.
// An optional ambient drone (two detuned sine waves under a slow LFO) is off by
// default and only ever starts from an explicit user toggle.

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.drone = null; // { oscA, oscB, lfo, gain } when running, else null
  }

  // Create the AudioContext on first real use (must follow a user gesture).
  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) {
      // Smoothly ramp to avoid clicks.
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(muted ? 0 : 1, now, 0.02);
    }
  }

  // A short shaped tone. `type` is an oscillator waveform; `freqs` may be a
  // single frequency or a small glide [start, end].
  _tone({ freqs, type = 'sine', dur = 0.15, gain = 0.18, attack = 0.005 }) {
    if (this.muted || !this._ensure()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;

    const arr = Array.isArray(freqs) ? freqs : [freqs];
    osc.frequency.setValueAtTime(arr[0], now);
    if (arr.length > 1) osc.frequency.exponentialRampToValueAtTime(arr[1], now + dur);

    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  // Placing a block: a bright, short upward blip.
  place() {
    this._tone({ freqs: [420, 660], type: 'triangle', dur: 0.12, gain: 0.16 });
  }

  // Completing a connection: two quick ascending notes, "linked".
  connect() {
    this._tone({ freqs: 523, type: 'sine', dur: 0.09, gain: 0.14 });
    setTimeout(() => this._tone({ freqs: 784, type: 'sine', dur: 0.11, gain: 0.14 }), 70);
  }

  // Deleting something: a short downward thunk.
  del() {
    this._tone({ freqs: [320, 150], type: 'sawtooth', dur: 0.16, gain: 0.14 });
  }

  // Using a hint: a soft mid "reveal" tone.
  hint() {
    this._tone({ freqs: [500, 600], type: 'sine', dur: 0.18, gain: 0.12 });
  }

  // Passing evaluation: a bright three-note arpeggio.
  pass() {
    const notes = [523, 659, 880];
    notes.forEach((f, i) =>
      setTimeout(() => this._tone({ freqs: f, type: 'triangle', dur: 0.22, gain: 0.16 }), i * 110),
    );
  }

  // Failing evaluation: a low, flat two-note fall (clearly different from pass).
  fail() {
    this._tone({ freqs: 300, type: 'sawtooth', dur: 0.22, gain: 0.13 });
    setTimeout(() => this._tone({ freqs: [260, 180], type: 'sawtooth', dur: 0.3, gain: 0.13 }), 180);
  }

  // Ambient drone: two detuned sine oscillators with a slow LFO on the gain.
  isDroneOn() {
    return !!this.drone;
  }

  toggleDrone() {
    if (this.drone) {
      this.stopDrone();
      return false;
    }
    this.startDrone();
    return true;
  }

  startDrone() {
    if (this.drone || !this._ensure()) return;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(this.master);
    gain.gain.setTargetAtTime(0.05, ctx.currentTime, 1.5);

    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    oscA.type = 'sine';
    oscB.type = 'sine';
    oscA.frequency.value = 55; // low A
    oscB.frequency.value = 55 * 1.01; // slightly detuned for a slow beat

    // Slow LFO gently modulating overall level.
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.1;
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain).connect(gain.gain);

    oscA.connect(gain);
    oscB.connect(gain);
    const t = ctx.currentTime;
    oscA.start(t);
    oscB.start(t);
    lfo.start(t);

    this.drone = { oscA, oscB, lfo, gain };
  }

  stopDrone() {
    if (!this.drone) return;
    const { oscA, oscB, lfo, gain } = this.drone;
    const now = this.ctx.currentTime;
    gain.gain.setTargetAtTime(0.0001, now, 0.4);
    const stopAt = now + 1.2;
    [oscA, oscB, lfo].forEach((o) => {
      try {
        o.stop(stopAt);
      } catch (_) {
        /* already stopped */
      }
    });
    this.drone = null;
  }
}
