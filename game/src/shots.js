// Neon Bay — shots.js
// Scene screenshot di balik ?shot=start|play|end (&seed=N).
// Deterministik dari seed: tiap scene menata state yang sama setiap kali.
// Hanya menyentuh field state — tidak bergantung pada modul lain.
// (Import random.js diizinkan: modul ini boleh memakai RNG seeded.)

import { createRng } from './random.js';

export function applyShot(state, params) {
  const name = (params.get('shot') || 'start').toLowerCase();
  const seedParam = Number.parseInt(params.get('seed') || '', 10);
  const seed = Number.isInteger(seedParam) ? seedParam : state.seed;

  // Reseed RNG supaya scene selalu sama untuk seed yang sama.
  state.seed = seed;
  state.rng = createRng(seed);

  const p = state.player;
  const downtown = { x: 2560, y: 2560 };

  if (name === 'play') {
    // Jalan ramai tengah kota, polisi mengejar, misi aktif.
    state.mode = 'playing';
    p.x = downtown.x + 140;
    p.y = downtown.y - 60;
    p.angle = Math.PI / 2;
    p.inCar = false;
    p.vehicle = null;
    state.playerCar = null;
    p.health = 82;
    // Ammo HUD dibaca dari p.weapon (ammoInMag/reserveAmmo), bukan dari
    // p.ammo/p.reserve saja: setel ketiganya supaya konsisten (9/48).
    p.ammo = 9;
    p.reserve = 48;
    if (p.weapon) { p.weapon.ammoInMag = 9; p.weapon.reserveAmmo = 48; }
    if (p.weapons && p.weapons[0]) { p.weapons[0].ammoInMag = 9; p.weapons[0].reserveAmmo = 48; }
    state.wanted = 3;
    state.cash = 1240;
    p.cash = 1240;
    state.missionIndex = 1;
    state.mission = { name: 'Hot Pickup', index: 1 };
    state.objective = 'Antar paket ke Harborfront — jangan sampai ketangkap!';
    // Jam: samakan SEMUA cerminan (clockMin, clock.minutes, timeMinutes)
    // supaya HUD tidak mentok di nilai lama.
    state.clockMin = 21 * 60 + 40; // 21:40 malam, lampu neon menyala
    state.clock.minutes = state.clockMin;
    state.timeMinutes = state.clockMin;
    // Polisi di belakang pemain (data mentah; modul police mengambil alih
    // bila sudah landing, dan fallback ini tetap terlihat di draw).
    state.police = [
      { x: p.x - 260, y: p.y + 120, angle: -0.4, speed: 240, onFoot: false },
      { x: p.x - 420, y: p.y - 90, angle: 0.3, speed: 230, onFoot: false },
      { x: p.x - 180, y: p.y + 260, angle: 0, speed: 200, onFoot: true },
    ];
    // Mobil lalu lintas di sekitar jalan.
    state.vehicles = [
      { x: p.x + 320, y: p.y + 30, angle: 0, type: 'taxi', speed: 120 },
      { x: p.x + 90, y: p.y - 220, angle: Math.PI / 2, type: 'sedan', speed: 90 },
      { x: p.x - 60, y: p.y + 330, angle: -Math.PI / 2, type: 'sports', speed: 150 },
    ];
    state.camera.x = p.x;
    state.camera.y = p.y;
    state.camera.zoom = 1;
    return;
  }

  if (name === 'end') {
    // Momen misi selesai: cash besar, wanted hilang, banner complete.
    state.mode = 'complete';
    p.x = downtown.x - 500;
    p.y = downtown.y + 900;
    p.angle = -Math.PI / 4;
    p.inCar = false;
    p.vehicle = null;
    state.playerCar = null;
    p.health = 64;
    // Ammo HUD dibaca dari p.weapon: setel ketiganya (4/12).
    p.ammo = 4;
    p.reserve = 12;
    if (p.weapon) { p.weapon.ammoInMag = 4; p.weapon.reserveAmmo = 12; }
    if (p.weapons && p.weapons[0]) { p.weapons[0].ammoInMag = 4; p.weapons[0].reserveAmmo = 12; }
    state.wanted = 0;
    state.cash = 5000;
    p.cash = 5000;
    state.missionIndex = 0;
    state.mission = { name: 'Getaway Drive', index: 0, done: true };
    state.objective = 'Misi selesai: Getaway Drive — +$500';
    state.clockMin = 8 * 60 + 15;
    state.clock.minutes = state.clockMin;
    state.timeMinutes = state.clockMin;
    state.police = [];
    state.vehicles = [
      { x: p.x + 200, y: p.y + 40, angle: 0, type: 'sports', speed: 0 },
    ];
    state.camera.x = p.x;
    state.camera.y = p.y;
    state.camera.zoom = 1;
    return;
  }

  // Default: start — title screen di atas kota.
  state.mode = 'title';
  p.x = downtown.x;
  p.y = downtown.y;
  p.health = 100;
  p.ammo = 12;
  p.reserve = 60;
  if (p.weapon) { p.weapon.ammoInMag = 12; p.weapon.reserveAmmo = 60; }
  if (p.weapons && p.weapons[0]) { p.weapons[0].ammoInMag = 12; p.weapons[0].reserveAmmo = 60; }
  state.wanted = 0;
  state.cash = 0;
  p.cash = 0;
  state.missionIndex = 0;
  state.mission = null;
  state.objective = 'Pergi ke Rosa — Downtown';
  state.clockMin = 8 * 60 + 5;
  state.clock.minutes = state.clockMin;
  state.timeMinutes = state.clockMin;
  state.police = [];
  state.vehicles = [
    { x: downtown.x + 420, y: downtown.y + 30, angle: 0, type: 'taxi', speed: 0 },
    { x: downtown.x - 180, y: downtown.y - 200, angle: Math.PI / 2, type: 'sedan', speed: 0 },
  ];
  state.camera.x = downtown.x;
  state.camera.y = downtown.y;
  state.camera.zoom = 1;
}
