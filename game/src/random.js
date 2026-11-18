// Neon Bay — random.js
// Seeded RNG (mulberry32). Semua keacakan gameplay HARUS lewat modul ini.
// Jangan pernah memakai Math.random di kode gameplay.

// Ubah string apa pun jadi seed angka 32-bit yang stabil.
export function hashSeed(value) {
  const text = String(value);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Buat generator acak dari seed angka (atau string, di-hash dulu).
export function createRng(seed) {
  let s = (typeof seed === 'string' ? hashSeed(seed) : seed) >>> 0;
  if (s === 0) s = 0x9e3779b9;

  function next() {
    // mulberry32
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function range(min, max) {
    return min + next() * (max - min);
  }

  function int(min, max) {
    // inklusif di kedua ujung
    return Math.floor(range(min, max + 1));
  }

  function pick(arr) {
    if (!arr || arr.length === 0) return undefined;
    return arr[Math.floor(next() * arr.length)];
  }

  function chance(p) {
    return next() < p;
  }

  function shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  // Ambil n item unik dari array (tanpa mengubah array asli).
  function sample(arr, n) {
    if (!arr || arr.length === 0 || n <= 0) return [];
    return shuffle(arr).slice(0, Math.min(n, arr.length));
  }

  function getSeed() {
    return s >>> 0;
  }

  return { next, range, int, pick, chance, shuffle, sample, getSeed };
}
