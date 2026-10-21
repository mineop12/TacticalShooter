import { WeaponId } from './types';

/**
 * Multi-Layer Procedural Ballistic & Tactical Sound Engine
 * Synthesizes realistic multi-layered gunshots (sub-bass thump, waveshaped supersonic crack,
 * filtered muzzle blast, mechanical bolt/slide clack, brass shell ping, and stereo canyon reverb tail)
 * using pure Web Audio API with zero external asset dependencies.
 */
class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterVolume = 0.75;
  private muted = false;
  private whiteNoiseBuffer: AudioBuffer | null = null;
  private pinkNoiseBuffer: AudioBuffer | null = null;
  private reverbBuffer: AudioBuffer | null = null;
  private distortionCurve: Float32Array<ArrayBuffer> | null = null;

  private ensureContext(): AudioContext | null {
    if (this.muted || this.masterVolume <= 0.01) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (this.ctx) {
      this.ensureBuffers(this.ctx);
    }
    return this.ctx;
  }

  private ensureBuffers(ctx: AudioContext) {
    if (!this.whiteNoiseBuffer) {
      const sr = ctx.sampleRate;
      const len = Math.floor(sr * 1.0);
      const buf = ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.whiteNoiseBuffer = buf;
    }

    if (!this.pinkNoiseBuffer) {
      const sr = ctx.sampleRate;
      const len = Math.floor(sr * 1.0);
      const buf = ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      let b0 = 0,
        b1 = 0,
        b2 = 0,
        b3 = 0,
        b4 = 0,
        b5 = 0,
        b6 = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.045;
        b6 = white * 0.115926;
      }
      this.pinkNoiseBuffer = buf;
    }

    if (!this.reverbBuffer) {
      // Short tactical courtyard impulse response (0.38s stereo decay)
      const sr = ctx.sampleRate;
      const len = Math.floor(sr * 0.38);
      const buf = ctx.createBuffer(2, len, sr);
      for (let ch = 0; ch < 2; ch++) {
        const data = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          const t = i / len;
          const env = Math.pow(1 - t, 2.8);
          data[i] = (Math.random() * 2 - 1) * env * 0.35;
        }
      }
      this.reverbBuffer = buf;
    }

    if (!this.distortionCurve) {
      const samples = 4096;
      const curve = new Float32Array(new ArrayBuffer(samples * 4));
      const k = 36;
      const deg = Math.PI / 180;
      for (let i = 0; i < samples; i++) {
        const x = (i * 2) / samples - 1;
        curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
      }
      this.distortionCurve = curve;
    }
  }

  public setVolume(volume: number, muted: boolean) {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    this.muted = muted;
  }

  /**
   * 5-Layer Ballistic Gunshot Synthesizer:
   * 1. Sub-bass chest punch (low sine/triangle drop)
   * 2. Waveshaped supersonic ballistic crack (fast pitch-drop sawtooth through soft-clipper)
   * 3. Dual-band filtered pink/white noise blast (low-mid gun body + high-frequency air tear)
   * 4. Mechanical bolt/slide carrier clack + brass casing ping
   * 5. Subtle courtyard slapback reverb tail
   */
  public playWeaponFire(weaponId: WeaponId, isAI = false) {
    const ctx = this.ensureContext();
    if (!ctx || !this.whiteNoiseBuffer || !this.pinkNoiseBuffer) return;

    try {
      const now = ctx.currentTime;
      const distanceAtten = isAI ? 0.52 : 1.0;
      const vol = this.masterVolume * distanceAtten;
      const pitchVar = 1 + (Math.random() * 0.07 - 0.035);

      // Master bus for this shot with soft saturation
      const shotBus = ctx.createGain();
      shotBus.gain.setValueAtTime(vol, now);

      const shaper = ctx.createWaveShaper();
      if (this.distortionCurve) {
        shaper.curve = this.distortionCurve;
        shaper.oversample = '2x';
      }

      shotBus.connect(shaper);
      shaper.connect(ctx.destination);

      // Subtle courtyard slapback reverb tail
      if (this.reverbBuffer && !isAI) {
        const convolver = ctx.createConvolver();
        convolver.buffer = this.reverbBuffer;
        const revGain = ctx.createGain();
        revGain.gain.setValueAtTime(
          weaponId === 'sniper' ? 0.34 : weaponId === 'shotgun' ? 0.26 : weaponId === 'smg' ? 0.08 : 0.18,
          now
        );
        shotBus.connect(convolver);
        convolver.connect(revGain);
        revGain.connect(ctx.destination);
      }

      // ======================================================================
      // LAYER 1: SUB-BASS CHEST THUMP (Physical Low-End Impact)
      // ======================================================================
      const subOsc = ctx.createOscillator();
      const subGain = ctx.createGain();
      subOsc.type = 'sine';

      const subStartFreq =
        weaponId === 'sniper'
          ? 145
          : weaponId === 'shotgun'
            ? 125
            : weaponId === 'rifle'
              ? 135
              : weaponId === 'smg'
                ? 160
                : 150;
      const subDur =
        weaponId === 'sniper'
          ? 0.28
          : weaponId === 'shotgun'
            ? 0.22
            : weaponId === 'rifle'
              ? 0.14
              : 0.09;

      subOsc.frequency.setValueAtTime(subStartFreq * pitchVar, now);
      subOsc.frequency.exponentialRampToValueAtTime(28, now + subDur);

      const subLevel =
        weaponId === 'sniper'
          ? 0.95
          : weaponId === 'shotgun'
            ? 0.88
            : weaponId === 'rifle'
              ? 0.72
              : weaponId === 'smg'
                ? 0.48
                : 0.56;
      subGain.gain.setValueAtTime(subLevel, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + subDur);

      subOsc.connect(subGain);
      subGain.connect(shotBus);
      subOsc.start(now);
      subOsc.stop(now + subDur + 0.01);

      // ======================================================================
      // LAYER 2: SUPERSONIC BALLISTIC CRACK (Sharp Transient Bark)
      // ======================================================================
      const crackOsc = ctx.createOscillator();
      const crackGain = ctx.createGain();
      crackOsc.type = weaponId === 'smg' ? 'triangle' : 'sawtooth';

      const crackStart =
        weaponId === 'sniper'
          ? 1850
          : weaponId === 'rifle'
            ? 1420
            : weaponId === 'shotgun'
              ? 920
              : weaponId === 'smg'
                ? 880
                : 1280;
      const crackDur = weaponId === 'sniper' ? 0.075 : weaponId === 'shotgun' ? 0.065 : 0.045;

      crackOsc.frequency.setValueAtTime(crackStart * pitchVar, now);
      crackOsc.frequency.exponentialRampToValueAtTime(95, now + crackDur);

      crackGain.gain.setValueAtTime(weaponId === 'smg' ? 0.25 : 0.48, now);
      crackGain.gain.exponentialRampToValueAtTime(0.001, now + crackDur);

      crackOsc.connect(crackGain);
      crackGain.connect(shotBus);
      crackOsc.start(now);
      crackOsc.stop(now + crackDur + 0.01);

      // ======================================================================
      // LAYER 3: PINK NOISE GUNPOWDER BODY BLAST (Low-Mid Weight)
      // ======================================================================
      const bodyNoise = ctx.createBufferSource();
      bodyNoise.buffer = this.pinkNoiseBuffer;

      const bodyFilter = ctx.createBiquadFilter();
      bodyFilter.type = 'bandpass';
      const bodyCenterFreq =
        weaponId === 'sniper'
          ? 480
          : weaponId === 'shotgun'
            ? 420
            : weaponId === 'rifle'
              ? 640
              : weaponId === 'smg'
                ? 950
                : 780;
      bodyFilter.frequency.setValueAtTime(bodyCenterFreq * pitchVar, now);
      bodyFilter.frequency.exponentialRampToValueAtTime(180, now + 0.18);
      bodyFilter.Q.value = weaponId === 'smg' ? 2.2 : 1.1;

      const bodyDur =
        weaponId === 'sniper'
          ? 0.36
          : weaponId === 'shotgun'
            ? 0.28
            : weaponId === 'rifle'
              ? 0.165
              : weaponId === 'smg'
                ? 0.095
                : 0.13;
      const bodyGain = ctx.createGain();
      bodyGain.gain.setValueAtTime(
        weaponId === 'sniper' ? 0.92 : weaponId === 'shotgun' ? 0.85 : weaponId === 'rifle' ? 0.68 : 0.45,
        now
      );
      bodyGain.gain.exponentialRampToValueAtTime(0.001, now + bodyDur);

      bodyNoise.connect(bodyFilter);
      bodyFilter.connect(bodyGain);
      bodyGain.connect(shotBus);
      bodyNoise.start(now);
      bodyNoise.stop(now + bodyDur + 0.01);

      // ======================================================================
      // LAYER 4: HIGH-FREQUENCY AIR TEAR / SUPPRESSOR BAFFLE SIZZLE
      // ======================================================================
      const hiNoise = ctx.createBufferSource();
      hiNoise.buffer = this.whiteNoiseBuffer;

      const hiFilter = ctx.createBiquadFilter();
      hiFilter.type = weaponId === 'smg' ? 'bandpass' : 'highpass';
      hiFilter.frequency.setValueAtTime(weaponId === 'smg' ? 2400 : 2100, now);
      hiFilter.Q.value = weaponId === 'smg' ? 1.8 : 0.7;

      const hiDur = weaponId === 'smg' ? 0.055 : weaponId === 'sniper' ? 0.18 : 0.095;
      const hiGain = ctx.createGain();
      hiGain.gain.setValueAtTime(weaponId === 'smg' ? 0.28 : 0.36, now);
      hiGain.gain.exponentialRampToValueAtTime(0.001, now + hiDur);

      hiNoise.connect(hiFilter);
      hiFilter.connect(hiGain);
      hiGain.connect(shotBus);
      hiNoise.start(now);
      hiNoise.stop(now + hiDur + 0.01);

      // ======================================================================
      // LAYER 5: MECHANICAL BOLT / SLIDE RECIPROCATION & BRASS SHELL PING
      // ======================================================================
      if (!isAI) {
        const mechDelay = 0.028;
        const mechOsc = ctx.createOscillator();
        const mechGain = ctx.createGain();
        mechOsc.type = 'triangle';
        mechOsc.frequency.setValueAtTime(1650 * pitchVar, now + mechDelay);
        mechOsc.frequency.exponentialRampToValueAtTime(2450, now + mechDelay + 0.032);
        mechGain.gain.setValueAtTime(vol * 0.18, now + mechDelay);
        mechGain.gain.exponentialRampToValueAtTime(0.001, now + mechDelay + 0.038);
        mechOsc.connect(mechGain);
        mechGain.connect(ctx.destination);
        mechOsc.start(now + mechDelay);
        mechOsc.stop(now + mechDelay + 0.042);

        // Sniper manual bolt-cycle or Shotgun pump rack sound after firing
        if (weaponId === 'sniper' || weaponId === 'shotgun') {
          const cycleTime = weaponId === 'sniper' ? 0.26 : 0.18;
          [0, 0.11].forEach((offset, idx) => {
            const cOsc = ctx.createOscillator();
            const cGain = ctx.createGain();
            cOsc.type = 'sawtooth';
            cOsc.frequency.setValueAtTime(idx === 0 ? 580 : 820, now + cycleTime + offset);
            cOsc.frequency.exponentialRampToValueAtTime(
              idx === 0 ? 960 : 480,
              now + cycleTime + offset + 0.065
            );
            cGain.gain.setValueAtTime(vol * 0.22, now + cycleTime + offset);
            cGain.gain.exponentialRampToValueAtTime(0.001, now + cycleTime + offset + 0.07);
            cOsc.connect(cGain);
            cGain.connect(ctx.destination);
            cOsc.start(now + cycleTime + offset);
            cOsc.stop(now + cycleTime + offset + 0.075);
          });
        }
      }
    } catch {}
  }

  public playHitMarker(isHeadshot: boolean, isKill: boolean) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const vol = this.masterVolume * 0.68;

      if (isHeadshot) {
        // Crisp Valor-style dual-harmonic metallic dink + sub impact
        [2150, 3220].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + i * 0.018);
          osc.frequency.exponentialRampToValueAtTime(freq * 1.18, now + 0.19);
          gain.gain.setValueAtTime(vol * (i === 0 ? 0.75 : 0.45), now + i * 0.018);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.21);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + i * 0.018);
          osc.stop(now + 0.22);
        });
      } else {
        // Punchy flesh/armor thud
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(580, now);
        osc.frequency.exponentialRampToValueAtTime(145, now + 0.075);
        gain.gain.setValueAtTime(vol * 0.65, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.085);
      }

      if (isKill) {
        // Rising tactical elimination chord stinger
        [659.25, 880, 1318.5].forEach((freq, idx) => {
          const kOsc = ctx.createOscillator();
          const kGain = ctx.createGain();
          kOsc.type = 'triangle';
          const t0 = now + 0.04 + idx * 0.045;
          kOsc.frequency.setValueAtTime(freq, t0);
          kOsc.frequency.exponentialRampToValueAtTime(freq * 1.03, t0 + 0.26);
          kGain.gain.setValueAtTime(vol * 0.48, t0);
          kGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
          kOsc.connect(kGain);
          kGain.connect(ctx.destination);
          kOsc.start(t0);
          kOsc.stop(t0 + 0.29);
        });
      }
    } catch {}
  }

  public playPlayerHurt() {
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(165, now);
      osc.frequency.exponentialRampToValueAtTime(48, now + 0.16);
      gain.gain.setValueAtTime(this.masterVolume * 0.52, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.18);
    } catch {}
  }

  public playReload(durationSec = 2.0) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const vol = this.masterVolume * 0.46;
      // 4 tactile mechanical stages matching the 3D reload choreography:
      // 1. Mag release button & polymer mag slide-out
      // 2. Fresh magazine insertion seating click
      // 3. Magazine baseplate slap thump
      // 4. Metallic bolt/slide rack & spring lock
      const stages = [
        { t: 0.06, f1: 760, f2: 390, dur: 0.065, type: 'triangle' as OscillatorType },
        { t: durationSec * 0.42, f1: 340, f2: 680, dur: 0.06, type: 'sine' as OscillatorType },
        { t: durationSec * 0.54, f1: 180, f2: 920, dur: 0.075, type: 'triangle' as OscillatorType },
        { t: durationSec * 0.74, f1: 920, f2: 1480, dur: 0.08, type: 'sawtooth' as OscillatorType },
      ];
      stages.forEach(({ t, f1, f2, dur, type }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(f1, now + t);
        osc.frequency.exponentialRampToValueAtTime(f2, now + t + dur);
        gain.gain.setValueAtTime(vol, now + t);
        gain.gain.exponentialRampToValueAtTime(0.001, now + t + dur + 0.015);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + t);
        osc.stop(now + t + dur + 0.02);
      });
    } catch {}
  }

  public playWeaponEquip() {
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const vol = this.masterVolume * 0.3;
      [
        { t: 0, f1: 420, f2: 760, dur: 0.05 },
        { t: 0.07, f1: 920, f2: 1320, dur: 0.045 },
      ].forEach(({ t, f1, f2, dur }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f1, now + t);
        osc.frequency.exponentialRampToValueAtTime(f2, now + t + dur);
        gain.gain.setValueAtTime(vol, now + t);
        gain.gain.exponentialRampToValueAtTime(0.001, now + t + dur + 0.01);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + t);
        osc.stop(now + t + dur + 0.015);
      });
    } catch {}
  }

  public playFootstep(isCrouching = false) {
    const ctx = this.ensureContext();
    if (!ctx || isCrouching) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const pitch = 102 + (Math.random() * 18 - 9);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(pitch, now);
      osc.frequency.exponentialRampToValueAtTime(38, now + 0.065);
      gain.gain.setValueAtTime(this.masterVolume * 0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.075);
    } catch {}
  }

  public playJump(isLand = false) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      if (isLand) {
        osc.frequency.setValueAtTime(125, now);
        osc.frequency.exponentialRampToValueAtTime(42, now + 0.095);
      } else {
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.exponentialRampToValueAtTime(245, now + 0.08);
      }
      gain.gain.setValueAtTime(this.masterVolume * 0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    } catch {}
  }

  public playTacticalSlide() {
    const ctx = this.ensureContext();
    if (!ctx || !this.pinkNoiseBuffer) return;

    try {
      const now = ctx.currentTime;
      const vol = this.masterVolume * 0.36;

      // Low sub-bass knee impact thump
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(36, now + 0.22);
      oscGain.gain.setValueAtTime(vol, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.connect(oscGain);
      oscGain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.25);

      // Filtered noise slide friction whoosh
      const noise = ctx.createBufferSource();
      noise.buffer = this.pinkNoiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1150, now);
      filter.frequency.exponentialRampToValueAtTime(340, now + 0.48);
      filter.Q.value = 1.4;

      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(vol * 0.72, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

      noise.connect(filter);
      filter.connect(nGain);
      nGain.connect(ctx.destination);
      noise.start(now);
      noise.stop(now + 0.52);
    } catch {}
  }

  public playBuySound() {
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(740, now);
      osc.frequency.setValueAtTime(1110, now + 0.05);
      gain.gain.setValueAtTime(this.masterVolume * 0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.17);
    } catch {}
  }

  public playWeaponInspect() {
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const vol = this.masterVolume * 0.32;
      [
        { t: 0, f1: 520, f2: 780 },
        { t: 0.85, f1: 680, f2: 490 },
        { t: 1.35, f1: 1120, f2: 1480 }, // Press-check metallic slide click
        { t: 1.85, f1: 840, f2: 1120 },
      ].forEach(({ t, f1, f2 }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f1, now + t);
        osc.frequency.exponentialRampToValueAtTime(f2, now + t + 0.06);
        gain.gain.setValueAtTime(vol, now + t);
        gain.gain.exponentialRampToValueAtTime(0.001, now + t + 0.07);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + t);
        osc.stop(now + t + 0.075);
      });
    } catch {}
  }

  public playTelegraphAlert() {
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(620, now);
      osc.frequency.linearRampToValueAtTime(980, now + 0.13);
      gain.gain.setValueAtTime(this.masterVolume * 0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.15);
    } catch {}
  }

  public playRoundTransition(won: boolean | null) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const notes =
        won === null ? [440, 554.37] : won ? [523.25, 659.25, 783.99] : [392.0, 349.23, 293.66];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + i * 0.11);
        gain.gain.setValueAtTime(this.masterVolume * 0.32, now + i * 0.11);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.11 + 0.24);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.11);
        osc.stop(now + i * 0.11 + 0.25);
      });
    } catch {}
  }
}

export const soundEngine = new SoundEngine();
