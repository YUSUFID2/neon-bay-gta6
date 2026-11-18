// Neon Bay — config.js
// Semua konstanta game dalam satu tempat. Tidak ada logika di sini,
// hanya nilai yang dipakai modul lain lewat argumen state.

export const WORLD = {
  width: 5120,
  height: 5120,
  block: 320,        // ukuran satu blok kota (px)
  road: 96,          // lebar jalan (px)
  sidewalk: 18,      // lebar trotoar di tiap sisi jalan (px)
  districts: 4,      // Downtown, Harborfront, Northside, Old Town
};

export const PLAYER = {
  radius: 14,
  walkSpeed: 190,    // px per detik
  sprintSpeed: 330,
  healthMax: 100,
  armorMax: 100,
  regenPerSec: 2.5,  // regenerasi di luar combat
  regenDelaySec: 6,  // jeda setelah terakhir kena tembak
  enterCarSec: 0.6,  // jeda masuk/keluar mobil
  bustPenalty: 0.25, // 25% cash disita saat busted
  wastedPenalty: 0.15, // 15% cash hilang saat wasted
};

export const VEHICLES = {
  taxi:    { topSpeed: 430, accel: 260, turn: 2.6, toughness: 60,  color: '#f5c518', label: 'TAXI' },
  sedan:   { topSpeed: 520, accel: 320, turn: 2.9, toughness: 80,  color: '#4a7dd6', label: 'SEDAN' },
  sports:  { topSpeed: 760, accel: 480, turn: 3.4, toughness: 55,  color: '#e5484d', label: 'SPORTS' },
  truck:   { topSpeed: 360, accel: 180, turn: 1.9, toughness: 160, color: '#8a8f98', label: 'TRUCK' },
  police:  { topSpeed: 640, accel: 420, turn: 3.2, toughness: 110, color: '#20242e', label: 'POLICE' },
};

export const WANTED = {
  max: 5,
  decayDelaySec: 12,   // diam tanpa kejahatan sebelum bintang turun
  decayStepSec: 8,     // interval turun satu bintang
  bustRadius: 26,      // polisi menyentuh pemain saat wanted > 0
  copCounts: [0, 1, 2, 3, 4, 6],      // jumlah polisi per level
  copSpeeds: [0, 200, 215, 235, 260, 290],
};

export const COMBAT = {
  pistolMag: 12,
  pistolReserveMax: 120,
  pistolDamage: 34,
  pistolRange: 520,
  pistolFireDelay: 0.16,
  reloadSec: 1.1,
  shotgunMag: 6,
  shotgunDamage: 22,   // per peluru, 6 peluru per tembakan
  shotgunRange: 340,
  shotgunFireDelay: 0.7,
  enemyHealth: 60,
};

export const MISSIONS = {
  count: 6,
  rewards: [500, 800, 1200, 2000, 3000, 5000],
  names: [
    'Getaway Drive',
    'Hot Pickup',
    'Turf War',
    'Boat-Yard Heist',
    'Bridge Chase',
    'Harbor Showdown',
  ],
};

export const CAMERA = {
  zoom: 1.0,
  minZoom: 0.6,
  maxZoom: 1.6,
  lookAhead: 90,     // px ke arah gerak saat mengemudi
  followLerp: 6.0,   // kekakuan ikuti kamera (per detik)
};

export const COLORS = {
  sky: '#0b0e1a',
  grass: '#1d5c33',
  park: '#247a44',
  road: '#2a2e3a',
  roadLine: '#d8d8c8',
  sidewalk: '#3d4252',
  buildingRoof: '#232838',
  buildingEdge: '#39415a',
  water: '#0e4d6e',
  sand: '#c9b489',
  neonPink: '#ff2e88',
  neonCyan: '#22e6ff',
  neonYellow: '#ffd23e',
  hudBg: 'rgba(8, 10, 20, 0.72)',
  hudText: '#f2f5ff',
  hudDim: '#9aa3c0',
  star: '#ffd23e',
  health: '#3ddc74',
  armor: '#4aa8ff',
  cash: '#7dff8a',
};

export const HUD = {
  minimapSize: 208,
  minimapMargin: 16,
  barWidth: 220,
  barHeight: 14,
};

export const AUDIO = {
  masterVolume: 0.5,
  musicVolume: 0.22,
  engineVolume: 0.16,
  sirenVolume: 0.2,
  musicBpm: 96,
};

export const SAVE_KEY = 'neon-bay-save-v1';

export const SHOTS = {
  width: 1280,
  height: 720,
};

export const DEFAULT_SEED = 20261118;
