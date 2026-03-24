const toneMap = {
  launch: { frequency: 520, duration: 0.07, type: "triangle", gain: 0.07 },
  wall: { frequency: 260, duration: 0.05, type: "square", gain: 0.05 },
  paddle: { frequency: 210, duration: 0.05, type: "triangle", gain: 0.055 },
  brick: { frequency: 330, duration: 0.06, type: "square", gain: 0.055 },
  blueBrick: { frequency: 460, duration: 0.08, type: "sawtooth", gain: 0.065 },
  rareBrick: { frequency: 720, duration: 0.12, type: "triangle", gain: 0.08 },
  drop: { frequency: 580, duration: 0.11, type: "triangle", gain: 0.065 },
  clear: { frequency: 680, duration: 0.16, type: "triangle", gain: 0.08 },
  lifeLost: { frequency: 160, duration: 0.14, type: "square", gain: 0.08 },
  gameOver: { frequency: 130, duration: 0.2, type: "sawtooth", gain: 0.09 }
};

export class SfxEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  async ensureContext() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
    return this.ctx;
  }

  async play(name) {
    const tone = toneMap[name];
    if (!tone || !this.enabled) return;
    const ctx = await this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tone.type;
    osc.frequency.setValueAtTime(tone.frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(tone.gain, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.duration);

    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + tone.duration + 0.01);
  }
}
