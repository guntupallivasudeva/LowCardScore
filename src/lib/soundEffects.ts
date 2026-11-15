'use client';

const STORAGE_SOUND_GLOBAL_KEY = 'leastscore_sound_enabled_v1';

function getUserSoundKey(userId?: string): string {
  return userId ? `leastscore_sound_pref_${userId}` : STORAGE_SOUND_GLOBAL_KEY;
}

// Lightweight Web Audio API sound synthesizer matching LeastScore cues (no external MP3 dependencies)
class SoundEngine {
  private ctx: AudioContext | null = null;
  public enabled = true;

  /** Load saved mute/unmute preference for a player (or browser default). */
  loadPreference(userId?: string): boolean {
    if (typeof window === 'undefined') return this.enabled;
    try {
      const userVal = userId ? localStorage.getItem(getUserSoundKey(userId)) : null;
      const globalVal = localStorage.getItem(STORAGE_SOUND_GLOBAL_KEY);
      const raw = userVal !== null ? userVal : globalVal;
      if (raw !== null) {
        const parsed = raw === 'true';
        this.enabled = parsed;
        return parsed;
      }
    } catch {
      // ignore localStorage read errors
    }
    return this.enabled;
  }

  /** Save mute/unmute preference to localStorage for both this player and browser default. */
  savePreference(enabled: boolean, userId?: string): void {
    this.enabled = enabled;
    if (typeof window === 'undefined') return;
    try {
      const str = String(enabled);
      localStorage.setItem(STORAGE_SOUND_GLOBAL_KEY, str);
      if (userId) {
        localStorage.setItem(getUserSoundKey(userId), str);
      }
    } catch {
      // ignore localStorage write errors
    }
  }

  private getCtx(): AudioContext | null {
    if (typeof window === 'undefined' || !this.enabled) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  // Crisp double-chime when the player's turn activates
  playTurnActivate() {
    const ctx = this.getCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.tone(ctx, 523.25, now, 0.11, 'sine', 0.14); // C5
    this.tone(ctx, 659.25, now + 0.11, 0.18, 'sine', 0.16); // E5
  }

  // Soft card snap when selecting or moving a card
  playCardMove() {
    const ctx = this.getCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.tone(ctx, 320, now, 0.045, 'triangle', 0.12);
  }

  // Rapid riffle sound when shuffling the deck or dealing 5 cards
  playShuffle() {
    const ctx = this.getCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (let i = 0; i < 6; i++) {
      this.tone(ctx, 260 + i * 35, now + i * 0.055, 0.04, 'triangle', 0.11);
    }
  }

  // Royal fanfare chime when Declare is triggered
  playDeclare() {
    const ctx = this.getCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.tone(ctx, 440, now, 0.1, 'triangle', 0.16); // A4
    this.tone(ctx, 554.37, now + 0.1, 0.1, 'triangle', 0.16); // C#5
    this.tone(ctx, 659.25, now + 0.2, 0.12, 'triangle', 0.18); // E5
    this.tone(ctx, 880, now + 0.32, 0.28, 'triangle', 0.2); // A5
  }

  // Subtle low tick when timer <= 10s
  playTimerTick() {
    const ctx = this.getCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.tone(ctx, 800, now, 0.03, 'sine', 0.06);
  }

  private tone(
    ctx: AudioContext,
    freq: number,
    startTime: number,
    duration: number,
    type: OscillatorType,
    gainVal: number
  ) {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(gainVal, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    } catch {
      // ignore audio context restrictions prior to user gesture
    }
  }
}

export const soundFX = new SoundEngine();
