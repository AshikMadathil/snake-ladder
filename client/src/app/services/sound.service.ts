import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/** All sounds are synthesised with the Web Audio API, so no audio files are needed. */
@Injectable({ providedIn: 'root' })
export class SoundService {
  muted = false;

  private ctx?: AudioContext;
  private out?: GainNode;
  private noiseBuf?: AudioBuffer;
  private readonly browser: boolean;

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.browser = isPlatformBrowser(platformId);
    if (!this.browser) return;
    try { this.muted = localStorage.getItem('sl_muted') === '1'; } catch { /* no storage */ }
    // Browsers only allow audio after a tap, so unlock it on the first touches.
    for (const ev of ['pointerdown', 'touchend', 'click']) {
      document.addEventListener(ev, () => this.ready(), { passive: true });
    }
  }

  toggle() {
    this.muted = !this.muted;
    try { localStorage.setItem('sl_muted', this.muted ? '1' : '0'); } catch { /* no storage */ }
    if (!this.muted) this.step(0);
  }

  /** Dice shaken in a cup, then dropped on the table. */
  diceRoll(ms = 800) {
    const c = this.play();
    if (!c) return;
    const t0 = c.currentTime + 0.02;
    const total = ms / 1000;
    let t = 0;
    let gap = 0.04;
    while (t < total - 0.08) {
      this.noise(c, t0 + t, 0.03, 0.55, 1500 + Math.random() * 2200, 3);
      this.tone(c, t0 + t, 500 + Math.random() * 500, 0.02, 'square', 0.05);
      t += gap;
      gap = Math.min(gap * 1.06 + Math.random() * 0.01, 0.1);
    }
    this.diceLand(t0 + total - 0.06);
  }

  /** The dice hitting the board (also played for other players' rolls). */
  diceLand(at?: number) {
    const c = this.play();
    if (!c) return;
    const t = at ?? c.currentTime + 0.02;
    this.tone(c, t, 220, 0.12, 'sine', 0.6, 70);
    this.noise(c, t, 0.08, 0.5, 900, 1);
    this.tone(c, t + 0.11, 160, 0.07, 'sine', 0.3, 80); // small bounce
    this.noise(c, t + 0.11, 0.05, 0.3, 1400, 2);
  }

  /** One hop of a token. The pitch climbs with the count, so 1-2-3-4-5-6 can be heard. */
  step(index: number) {
    const c = this.play();
    if (!c) return;
    const t = c.currentTime + 0.005;
    const semitones = [0, 2, 4, 5, 7, 9, 11, 12][Math.min(Math.max(index, 0), 7)];
    const f = 523.25 * Math.pow(2, semitones / 12);
    this.tone(c, t, f, 0.11, 'triangle', 0.5, f * 0.97);
    this.tone(c, t, f * 2, 0.05, 'sine', 0.12);
    this.noise(c, t, 0.025, 0.25, 3000, 1, 'highpass'); // wooden click
  }

  /** Bright climbing notes for a ladder. */
  ladder() {
    const c = this.play();
    if (!c) return;
    const t = c.currentTime + 0.02;
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
      this.tone(c, t + i * 0.07, f, 0.16, 'triangle', 0.35));
  }

  /** A falling slide with a hiss for a snake bite. */
  snake() {
    const c = this.play();
    if (!c) return;
    const t = c.currentTime + 0.02;
    this.tone(c, t, 800, 0.7, 'sawtooth', 0.22, 140);
    this.tone(c, t, 400, 0.7, 'sine', 0.3, 70);
    this.noise(c, t, 0.5, 0.18, 5000, 0.7, 'highpass');
  }

  /** Soft chime when it becomes your turn. */
  turn() {
    const c = this.play();
    if (!c) return;
    const t = c.currentTime + 0.02;
    this.tone(c, t, 987.77, 0.2, 'sine', 0.35);
    this.tone(c, t + 0.12, 1318.51, 0.32, 'sine', 0.3);
  }

  /** Fanfare for the winner, a gentler tune for everybody else. */
  win(isMe: boolean) {
    const c = this.play();
    if (!c) return;
    const t = c.currentTime + 0.05;
    if (isMe) {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(c, t + i * 0.12, f, 0.25, 'triangle', 0.4));
      [523.25, 659.25, 783.99].forEach((f) => this.tone(c, t + 0.5, f, 0.9, 'sine', 0.25));
    } else {
      [392, 329.63, 261.63].forEach((f, i) => this.tone(c, t + i * 0.22, f, 0.4, 'sine', 0.3));
    }
  }

  // ---- internals -------------------------------------------------------

  private ready(): AudioContext | undefined {
    if (!this.browser) return undefined;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return undefined;
      this.ctx = new AC();
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.7;
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private play(): AudioContext | undefined {
    return this.muted ? undefined : this.ready();
  }

  private tone(c: AudioContext, t: number, freq: number, dur: number, type: OscillatorType, vol: number, toFreq?: number) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.out!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(c: AudioContext, t: number, dur: number, vol: number, freq: number, q = 1, type: BiquadFilterType = 'bandpass') {
    if (!this.noiseBuf) {
      this.noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(this.out!);
    s.start(t, Math.random() * 0.5, dur + 0.02);
  }
}
