// Neon Bay — audio.js
// Semua suara disintesis WebAudio: tidak ada file audio sama sekali.
// Setiap pemanggilan dibungkus guard: bila AudioContext tidak tersedia,
// modul ini menjadi no-op dan game tetap jalan tanpa suara.

export function createAudio(state) {
  let actx = null;      // AudioContext (dibuat malas, saat gestur pertama)
  let master = null;    // GainNode utama
  let musicGain = null;
  let muted = false;
  let musicTimer = null;
  let musicStep = 0;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenPan = null;

  function ensure() {
    if (actx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      actx = new AC();
      master = actx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(actx.destination);
      musicGain = actx.createGain();
      musicGain.gain.value = 0.22;
      musicGain.connect(master);
      return true;
    } catch (e) {
      actx = null;
      return false;
    }
  }

  // Panggil dari gestur pengguna (klik / tombol) agar konteks bisa start.
  function unlock() {
    if (!ensure()) return;
    try {
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { /* abaikan */ }
  }

  function setMuted(value) {
    muted = !!value;
    if (master && actx) {
      try { master.gain.value = muted ? 0 : 0.5; } catch (e) { /* abaikan */ }
    }
    return muted;
  }

  function toggleMute() {
    return setMuted(!muted);
  }

  function isMuted() {
    return muted;
  }

  // Satu blip oscillator singkat: fondasi semua efek.
  function blip(freq0, freq1, dur, type, vol, when) {
    if (!ensure()) return;
    try {
      const t0 = actx.currentTime + (when || 0);
      const osc = actx.createOscillator();
      const g = actx.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq0, t0);
      if (freq1 !== undefined && freq1 !== freq0) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(freq1, 1), t0 + dur);
      }
      g.gain.setValueAtTime(vol || 0.25, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (e) { /* abaikan */ }
  }

  // Noise putih untuk tembakan/ledakan: LCG lokal (bukan Math.random —
  // keacakan di sini murni bentuk gelombang, bukan gameplay).
  let noiseSeed = 123456789;
  function noiseSample() {
    noiseSeed = (Math.imul(noiseSeed, 1664525) + 1013904223) | 0;
    return ((noiseSeed >>> 0) / 4294967296) * 2 - 1;
  }

  // Noise burst singkat (tembakan, ledakan) via buffer noise.
  function noiseBurst(dur, vol, lowpass) {
    if (!ensure()) return;
    try {
      const len = Math.max(1, Math.floor(actx.sampleRate * dur));
      const buf = actx.createBuffer(1, len, actx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = noiseSample() * (1 - i / len);
      const src = actx.createBufferSource();
      src.buffer = buf;
      const g = actx.createGain();
      g.gain.value = vol || 0.3;
      let node = src;
      if (lowpass) {
        const f = actx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = lowpass;
        src.connect(f);
        node = f;
      }
      node.connect(g);
      g.connect(master);
      src.start();
    } catch (e) { /* abaikan */ }
  }

  function shot() {
    noiseBurst(0.09, 0.35, 3200);
    blip(220, 55, 0.08, 'square', 0.18);
  }

  function reload() {
    blip(900, 500, 0.05, 'square', 0.15);
    blip(500, 900, 0.06, 'square', 0.15, 0.12);
  }

  function footstep() {
    noiseBurst(0.04, 0.08, 500);
  }

  function explosion() {
    noiseBurst(0.6, 0.5, 900);
    blip(120, 30, 0.5, 'sawtooth', 0.3);
  }

  function pickup() {
    blip(660, 660, 0.09, 'sine', 0.25);
    blip(990, 990, 0.14, 'sine', 0.25, 0.08);
  }

  function stinger(kind) {
    if (kind === 'mission') {
      blip(392, 392, 0.16, 'triangle', 0.3);
      blip(523, 523, 0.16, 'triangle', 0.3, 0.14);
      blip(659, 659, 0.3, 'triangle', 0.3, 0.28);
    } else if (kind === 'fail') {
      blip(220, 110, 0.5, 'sawtooth', 0.25);
    } else if (kind === 'busted') {
      blip(440, 440, 0.12, 'square', 0.25);
      blip(330, 330, 0.12, 'square', 0.25, 0.12);
      blip(220, 220, 0.3, 'square', 0.25, 0.24);
    } else {
      blip(523, 784, 0.2, 'sine', 0.25);
    }
  }

  function engine(speed01) {
    if (!ensure()) return;
    try {
      if (!engineOsc) {
        engineOsc = actx.createOscillator();
        engineOsc.type = 'sawtooth';
        engineGain = actx.createGain();
        engineGain.gain.value = 0;
        const filt = actx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.value = 900;
        engineOsc.connect(filt);
        filt.connect(engineGain);
        engineGain.connect(master);
        engineOsc.start();
      }
      const s = Math.max(0, Math.min(1, speed01 || 0));
      engineOsc.frequency.value = 55 + s * 165;
      engineGain.gain.value = s > 0.02 ? 0.05 + s * 0.11 : 0;
    } catch (e) { /* abaikan */ }
  }

  // Sirene dua nada yang pan mengikuti posisi relatif polisi.
  function siren(distance01, pan) {
    if (!ensure()) return;
    try {
      if (!sirenOsc) {
        sirenOsc = actx.createOscillator();
        sirenOsc.type = 'triangle';
        sirenGain = actx.createGain();
        sirenGain.gain.value = 0;
        if (actx.createStereoPanner) {
          sirenPan = actx.createStereoPanner();
          sirenOsc.connect(sirenGain);
          sirenGain.connect(sirenPan);
          sirenPan.connect(master);
        } else {
          sirenOsc.connect(sirenGain);
          sirenGain.connect(master);
        }
        sirenOsc.start();
      }
      const d = Math.max(0, Math.min(1, distance01 === undefined ? 1 : distance01));
      const t = actx.currentTime;
      const phase = (t % 0.8) < 0.4 ? 720 : 540;
      sirenOsc.frequency.value = phase;
      sirenGain.gain.value = (1 - d) * 0.12;
      if (sirenPan) sirenPan.pan.value = Math.max(-1, Math.min(1, pan || 0));
    } catch (e) { /* abaikan */ }
  }

  function sirenOff() {
    try {
      if (sirenGain) sirenGain.gain.value = 0;
    } catch (e) { /* abaikan */ }
  }

  // Musik loop: bassline minor + hat, dijadwalkan per langkah 8th-note.
  const BASS = [55, 0, 55, 0, 65.41, 0, 55, 0, 49, 0, 49, 0, 58.27, 0, 73.42, 0];
  function startMusic() {
    if (musicTimer || !ensure()) return;
    const stepDur = 60 / 96 / 2; // 96 BPM, 8th notes
    musicTimer = setInterval(() => {
      try {
        if (muted || !actx) return;
        const f = BASS[musicStep % BASS.length];
        if (f > 0) {
          const t0 = actx.currentTime;
          const osc = actx.createOscillator();
          const g = actx.createGain();
          osc.type = 'triangle';
          osc.frequency.value = f;
          g.gain.setValueAtTime(0.5, t0);
          g.gain.exponentialRampToValueAtTime(0.001, t0 + stepDur * 0.95);
          osc.connect(g);
          g.connect(musicGain);
          osc.start(t0);
          osc.stop(t0 + stepDur);
        }
        if (musicStep % 2 === 0) {
          const len = Math.floor(actx.sampleRate * 0.03);
          const buf = actx.createBuffer(1, len, actx.sampleRate);
          const data = buf.getChannelData(0);
          for (let i = 0; i < len; i++) data[i] = noiseSample() * (1 - i / len);
          const src = actx.createBufferSource();
          src.buffer = buf;
          const hp = actx.createBiquadFilter();
          hp.type = 'highpass';
          hp.frequency.value = 6000;
          const g = actx.createGain();
          g.gain.value = 0.12;
          src.connect(hp);
          hp.connect(g);
          g.connect(musicGain);
          src.start();
        }
        musicStep += 1;
      } catch (e) { /* abaikan */ }
    }, stepDur * 1000);
  }

  function stopMusic() {
    if (musicTimer) {
      clearInterval(musicTimer);
      musicTimer = null;
    }
  }

  function update() {
    // Dipanggil tiap frame: matikan sirene bila tidak ada polisi dekat.
    if (state && state.wanted === 0) sirenOff();
  }

  return {
    unlock,
    setMuted,
    toggleMute,
    isMuted,
    shot,
    reload,
    footstep,
    explosion,
    pickup,
    stinger,
    engine,
    siren,
    sirenOff,
    startMusic,
    stopMusic,
    update,
  };
}
