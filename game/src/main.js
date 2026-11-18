// Neon Bay — main.js
// Boot + game loop. Membuat state bersama, memuat modul lain secara
// dinamis dengan guard (game tetap jalan walau modul lain belum landing),
// lalu update dan draw tiap frame. Tanpa build step, ES module murni.

import { createRng, hashSeed } from './random.js';
import { createInput } from './input.js';
import { createRenderer } from './render.js';
import { DEFAULT_SEED } from './config.js';

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') || '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : DEFAULT_SEED;

const canvas = document.getElementById('game');
const fallback = document.getElementById('fallback');
if (fallback) fallback.remove();

const renderer = createRenderer(canvas);
const input = createInput(canvas);
const rng = createRng(seed);

// --- State bersama: semua modul membaca/menulis lewat object ini. ---
// Bentuk kontrak (disepakati semua modul):
//   player { x, y, angle, speed, cash, health, maxHealth, armor, maxArmor,
//            weapon (objek), weapons (array objek), weaponIndex,
//            vehicle, inCar, dead, enterCooldown, ammo, reserve }
//   input  { up/down/left/right, aim, firing/mouseDown, reload,
//            enterPressed/stealPressed/exitPressed, handbrake, switchWeapon }
//            (+ isDown/wasPressed/moveAxis/mouse dari input.js)
//   world  { width, height, solids, parkedSpots, roadSpawns, policeStation,
//            hospital, roads, buildings, water }
//   wanted (angka 0-5, milik police.js), missions (objek internal M),
//   combat (objek internal C), camera (pusat view), renderer, clock
//   (jam { minutes }), mouse (alias input.mouse), menuHooks, save.
const state = {
  seed,
  rng,
  time: 0,
  dt: 0,
  mode: 'title', // title | playing | paused | busted | wasted | complete
  camera: renderer.camera,
  input,
  renderer,
  world: null,
  player: {
    x: 2560, y: 2560, angle: 0, speed: 0,
    health: 100, maxHealth: 100, armor: 0, maxArmor: 100,
    cash: 0,
    weapon: {
      key: 'pistol', name: 'Pistol', ammoInMag: 12, magSize: 12,
      reserveAmmo: 60, reloading: false,
    },
    weapons: [],
    weaponIndex: 0,
    vehicle: null, inCar: false, dead: false, enterCooldown: 0,
    ammo: 12, reserve: 60,
  },
  vehicles: [],
  peds: [],
  police: [],
  enemies: [],
  pickups: [],
  particles: [],
  events: [],
  wanted: 0,
  cash: 0, // cerminan player.cash untuk modul lama; disinkron tiap frame
  missionIndex: 0,
  mission: null,
  objective: 'Pergi ke Rosa — Downtown',
  clockMin: 8 * 60 + 5, // 08:05 pagi
  clock: { minutes: 8 * 60 + 5 },
  timeMinutes: 8 * 60 + 5,
  playMinutes: 0,
  viewWidth: 1280,
  viewHeight: 720,
  mouse: input.mouse,
  shake: 0,
  muted: false,
  shot: shotName,
  modules: {}, // instance modul lain yang berhasil dimuat
  menuHooks: null, // diisi di bawah, sebelum boot()
  save: null, // diisi boot() dari createSave
  storyDoneShown: false,
  missionCompleteShown: false,
};
state.player.weapons = [state.player.weapon];

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Import dinamis dengan guard: modul yang gagal dimuat dilewati, tapi
// kegagalannya DILOG ke console — guard jangan menutupi bug wiring.
async function tryLoad(name, factoryName, arg) {
  try {
    const mod = await import('./' + name + '.js');
    const factory = mod[factoryName];
    if (typeof factory !== 'function') {
      console.warn('[Neon Bay] ' + name + '.js: factory ' + factoryName + ' tidak ditemukan');
      return null;
    }
    return factory(arg === undefined ? state : arg);
  } catch (e) {
    console.warn('[Neon Bay] gagal memuat ' + name + '.js:', e);
    return null;
  }
}

// ---- Menu hooks: aksi tombol menus.js (New Game, Continue, Resume,
// Restart Mission, Save, Quit). Dipasang sebelum boot() supaya menus
// bisa memanggilnya sejak frame pertama. ----
function missionsApi() {
  return state.modules.missions || null;
}

function missionsState() {
  return state.missions || null;
}

// Mulai misi pertama yang statusnya 'available' bila belum ada misi aktif.
// Dipanggil saat masuk mode playing (new/continue/resume) dan tiap frame
// saat bermain — kecuali tepat setelah misi selesai (layar COMPLETE yang
// tampil dulu, baru lanjut saat pemain menekan Continue).
function ensureMissionStarted(force) {
  const M = missionsState();
  const api = missionsApi();
  if (!M || !api || typeof api.startMission !== 'function') return false;
  if (M.status === 'active') return false;
  if (!force && M.messageKind === 'complete') return false;
  if (M.status === 'storyDone') return false;
  const idx = M.list.findIndex((m) => m && m.status === 'available');
  if (idx < 0) return false;
  if (api.startMission(idx)) {
    state.missionIndex = idx;
    return true;
  }
  return false;
}

function resetForNewGame() {
  const p = state.player;
  const spawn = (state.world && state.world.playerSpawn)
    ? state.world.playerSpawn : { x: 2000, y: 2400 };
  p.x = spawn.x; p.y = spawn.y; p.angle = 0; p.speed = 0;
  p.health = 100; p.maxHealth = 100; p.armor = 0; p.maxArmor = 100;
  p.cash = 0; state.cash = 0;
  p.vehicle = null; p.inCar = false; p.dead = false; p.enterCooldown = 0;
  p.weapons = [{
    key: 'pistol', name: 'Pistol', ammoInMag: 12, magSize: 12,
    reserveAmmo: 60, reloading: false,
  }];
  p.weaponIndex = 0;
  p.weapon = p.weapons[0];
  p.ammo = 12; p.reserve = 60;
  state.wanted = 0;
  state.police.length = 0;
  state.events.length = 0;
  state.missionIndex = 0;
  state.mission = null;
  state.objective = 'Pergi ke Rosa — Downtown';
  state.clockMin = 8 * 60 + 5;
  state.playMinutes = 0;
  state.storyDoneShown = false;
  state.missionCompleteShown = false;
  const M = missionsState();
  const api = missionsApi();
  if (M && api && typeof api.resetAll === 'function') api.resetAll();
  const C = state.combat;
  if (C) {
    C.health = 100; C.armor = 0; C.kills = 0;
    C.enemies = []; C.pickups = []; C.tracers = []; C.sparks = [];
    if (C.weapons) {
      C.weapons = { pistol: C.weapons.pistol };
      if (C.weapons.pistol) {
        C.weapons.pistol.mag = 12;
        C.weapons.pistol.reserve = 60;
      }
      C.current = 'pistol';
      C.hasShotgun = false;
    }
  }
  if (state.audio) state.audio.stopMusic();
}

function enterPlaying() {
  state.mode = 'playing';
  const menus = state.modules.menus;
  if (menus) menus.showScreen('playing');
  ensureMissionStarted(true);
  if (state.audio) {
    state.audio.unlock();
    state.audio.startMusic();
  }
}

state.menuHooks = {
  onNewGame() {
    resetForNewGame();
    enterPlaying();
    if (state.audio) state.audio.stinger('mission');
  },
  onContinue() {
    const save = state.save;
    if (save) {
      const data = save.load();
      if (data) save.apply(data);
    }
    const C = state.combat;
    if (C && typeof C.syncFromPlayer === 'function') C.syncFromPlayer();
    state.storyDoneShown = false;
    state.missionCompleteShown = false;
    enterPlaying();
  },
  onResume() {
    state.missionCompleteShown = false;
    state.mode = 'playing';
    const menus = state.modules.menus;
    if (menus) menus.showScreen('playing');
    ensureMissionStarted(true);
  },
  onRestartMission() {
    const M = missionsState();
    const api = missionsApi();
    if (M && api) {
      if (M.status === 'active' && typeof api.failMission === 'function') {
        api.failMission('restart');
      }
      if (typeof api.retryFailed === 'function' && !api.retryFailed()) {
        ensureMissionStarted(true);
      }
    }
    state.missionCompleteShown = false;
    state.mode = 'playing';
    const menus = state.modules.menus;
    if (menus) menus.showScreen('playing');
  },
  onSave() {
    if (state.save) state.save.save();
  },
  onQuitToTitle() {
    state.mode = 'title';
    const menus = state.modules.menus;
    if (menus) menus.showScreen('title');
    if (state.audio) state.audio.stopMusic();
  },
};

// Busted / wasted: polisi & combat memanggil hook ini; main yang
// menampilkan layarnya (mode + menus gameover).
state.onBusted = function onBusted() {
  if (state.mode !== 'playing') return;
  state.mode = 'busted';
  const menus = state.modules.menus;
  if (menus) {
    menus.setEndKind('busted');
    menus.showScreen('gameover');
  }
};
state.onWasted = function onWasted() {
  if (state.mode !== 'playing') return;
  state.mode = 'wasted';
  const menus = state.modules.menus;
  if (menus) {
    menus.setEndKind('wasted');
    menus.showScreen('gameover');
  }
};

// Hook uji/diagnosis: state bisa diintip dari console browser
// (window.__neonBay) tanpa mengubah perilaku game.
window.__neonBay = state;

async function boot() {
  // Urutan wiring: rng -> world -> traffic/peds -> vehicles -> police ->
  // missions/combat -> hud/minimap/menus/audio. traffic/peds/vehicles
  // membaca state.world di factory, jadi world harus duluan.
  state.audio = await tryLoad('audio', 'createAudio');
  state.modules.world = await tryLoad('world', 'createWorld');
  state.modules.traffic = await tryLoad('traffic', 'createTraffic');
  state.modules.peds = await tryLoad('peds', 'createPeds');
  state.modules.vehicles = await tryLoad('vehicles', 'createVehicles');
  state.modules.police = await tryLoad('police', 'createPolice');
  state.modules.missions = await tryLoad('missions', 'createMissions');
  state.modules.combat = await tryLoad('combat', 'createCombat');
  state.modules.hud = await tryLoad('hud', 'createHUD');
  state.modules.minimap = await tryLoad('minimap', 'createMinimap');
  state.modules.menus = await tryLoad('menus', 'createMenus');
  state.save = await tryLoad('save', 'createSave');
  state.story = await tryLoad('story', 'createStory');

  // Dunia fallback minimal bila modul world belum landing: grid jalan
  // polos supaya kota tetap terlihat dan kamera punya sesuatu untuk
  // diikuti. Modul world asli akan mengganti state.world sepenuhnya.
  if (!state.world) {
    state.world = makeFallbackWorld();
  }
  if (state.modules.world && state.modules.world.world) {
    state.world = state.modules.world.world;
  }

  // ---- Cross-module wiring: referensi yang dibaca modul lain dari state.
  // (Factory combat/missions/police sudah mengisi state.combat,
  // state.missions, dan state.addWanted sendiri.)
  if (state.modules.hud) state.hud = state.modules.hud;
  if (state.modules.minimap) state.minimap = state.modules.minimap;
  if (state.modules.menus) state.menus = state.modules.menus;
  if (state.modules.vehicles) state.vehiclesApi = state.modules.vehicles;
  if (state.modules.missions && state.missions) {
    // state.missions sudah diisi factory dengan objek internal M.
  }

  // Spawn pemain dari world (bukan angka hardcode 2560).
  if (state.world && state.world.playerSpawn) {
    state.player.x = state.world.playerSpawn.x;
    state.player.y = state.world.playerSpawn.y;
  }
  state.camera.x = state.player.x;
  state.camera.y = state.player.y;

  // Scene screenshot (?shot=...) bila diminta. applyShot diekspor sebagai
  // fungsi biasa (bukan factory), jadi diimpor langsung dengan guard.
  if (shotName) {
    try {
      const mod = await import('./shots.js');
      if (mod && typeof mod.applyShot === 'function') mod.applyShot(state, params);
    } catch (e) {
      console.warn('[Neon Bay] gagal memuat shots.js:', e);
    }
    // Nilai yang disetel scene (health/ammo) harus menang atas nilai
    // default combat: sinkronkan pemain -> combat sekali di sini.
    const C = state.combat;
    if (C && typeof C.syncFromPlayer === 'function') C.syncFromPlayer();
    // Sinkronkan layar menu dengan scene: tanpa ini menus.screen tetap
    // 'title' dan endKind 'wasted' untuk SEMUA scene — overlay judul
    // (start) dan MISSION COMPLETE (end) tidak pernah tampil. screenTime
    // juga harus penuh: fade-in menu dihitung dari screenTime, dan di
    // mode shot update() tidak jalan sehingga fade mentok 0 (transparan).
    const menus = state.modules.menus;
    if (menus) {
      if (shotName === 'end') {
        menus.setEndKind('complete');
        menus.showScreen('gameover');
      } else if (shotName === 'play') {
        menus.showScreen('playing');
      } else {
        menus.showScreen('title');
      }
      menus.screenTime = 1;
    }
    paintShot();
    return;
  }

  requestAnimationFrame(frame);
}

// Dunia fallback: grid jalan + blok bangunan acak (seeded).
function makeFallbackWorld() {
  const w = { width: 5120, height: 5120, roads: [], blocks: [], props: [] };
  const step = 416; // block 320 + road 96
  for (let x = 0; x <= w.width; x += step) w.roads.push({ x, vertical: true });
  for (let y = 0; y <= w.height; y += step) w.roads.push({ y, vertical: false });
  for (let bx = 0; bx < 12; bx++) {
    for (let by = 0; by < 12; by++) {
      const x = bx * step + 96 + 18;
      const y = by * step + 96 + 18;
      w.blocks.push({
        x, y, w: 280, h: 280,
        tall: rng.chance(0.3),
        neon: rng.chance(0.35),
      });
    }
  }
  return w;
}

function update(dt) {
  state.time += dt;
  state.playMinutes += dt / 60;
  state.clockMin = (state.clockMin + dt / 60) % (24 * 60);
  state.clock.minutes = state.clockMin;
  state.timeMinutes = state.clockMin;
  const size = renderer.getSize();
  state.viewWidth = size.viewW;
  state.viewHeight = size.viewH;

  // Turunkan tombol mentah jadi field datar (vehicles/combat) SEBELUM
  // modul mana pun update. E dibedakan masuk vs keluar mobil.
  const p = state.player;
  input.refresh(!!(p.inCar || p.vehicle));
  if (state.modules.menus) state.modules.menus.setMouse(input.mouse.x, input.mouse.y);

  // Global keys: mute selalu aktif.
  if (input.wasPressed('KeyM')) {
    if (state.mode === 'playing' || state.mode === 'paused') {
      state.muted = !state.muted;
      if (state.audio) state.audio.setMuted(state.muted);
    }
    // Di layar menu, 'M' ditangani menus.key (toggle + notice).
  }

  // ---- Layar menu (title / paused / busted / wasted / complete) ----
  // Menus yang punya layar: klik + tombol diteruskan ke menus; game
  // tidak update. Fallback bila menus gagal dimuat: perilaku lama.
  if (state.mode !== 'playing') {
    const menus = state.modules.menus;
    if (menus) {
      if (menus.screen !== 'playing') {
        // Sinkronkan layar menu dengan mode (busted/wasted/complete
        // sudah dipetakan ke 'gameover' oleh onBusted/onWasted/di bawah).
        const want = state.mode === 'title' ? 'title'
          : state.mode === 'paused' ? 'paused' : 'gameover';
        if (menus.screen !== want) menus.showScreen(want);
      }
      menus.update(dt);
      const click = input.consumeClick();
      if (click) menus.click(click.x, click.y);
      if (input.wasPressed('ArrowDown') || input.wasPressed('KeyS')) menus.key('arrowdown');
      if (input.wasPressed('ArrowUp') || input.wasPressed('KeyW')) menus.key('arrowup');
      if (input.wasPressed('Enter')) menus.key('enter');
      if (input.wasPressed('Space')) menus.key(' ');
      if (input.wasPressed('KeyM')) menus.key('m');
      if (input.wasPressed('Escape') || input.wasPressed('KeyP')) menus.key('escape');
    } else {
      // Fallback tanpa menus: Enter/Space/klik memulai game, Esc lanjut.
      if (state.mode === 'title'
        && (input.wasPressed('Enter') || input.wasPressed('Space') || input.mouse.clicked)) {
        state.menuHooks.onNewGame();
      } else if (state.mode === 'paused'
        && (input.wasPressed('Escape') || input.wasPressed('KeyP'))) {
        state.menuHooks.onResume();
      }
    }
    // Pause/resume lewat Esc/P juga dari main (menus.key('escape')
    // sudah menangani resume saat paused).
    if (state.mode === 'paused'
      && (input.wasPressed('Escape') || input.wasPressed('KeyP'))) {
      state.menuHooks.onResume();
    }
    if (state.mode === 'title') {
      // Kamera title: pelan menyapu Downtown.
      state.camera.x = 2560 + Math.sin(state.time * 0.05) * 300;
      state.camera.y = 2560 + Math.cos(state.time * 0.04) * 300;
    }
    return;
  }

  // ---- Mode playing ----
  // Pause lewat Esc/P.
  if (input.wasPressed('Escape') || input.wasPressed('KeyP')) {
    state.mode = 'paused';
    const menus = state.modules.menus;
    if (menus) menus.showScreen('paused');
    return;
  }
  if (input.wasPressed('Enter') || input.mouse.clicked) {
    if (state.audio) state.audio.unlock();
  }

  // Gerak pemain jalan kaki (vehicles mengambil alih saat mengemudi).
  if (!p.inCar && !p.vehicle) {
    const axis = input.moveAxis();
    const sprint = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    const speed = sprint ? 330 : 190;
    const w = state.world;
    const nx = clamp(p.x + axis.x * speed * dt, 20, (w ? w.width : 5120) - 20);
    const ny = clamp(p.y + axis.y * speed * dt, 20, (w ? w.height : 5120) - 20);
    // Tabrakan pejalan kaki: coba penuh, lalu tiap sumbu (geser di dinding).
    const blocked = (x, y) => w && typeof w.collideRect === 'function'
      && w.collideRect(x - 12, y - 12, 24, 24);
    if (!blocked(nx, ny)) { p.x = nx; p.y = ny; }
    else if (!blocked(nx, p.y)) { p.x = nx; }
    else if (!blocked(p.x, ny)) { p.y = ny; }
    if (axis.x !== 0 || axis.y !== 0) p.angle = Math.atan2(axis.y, axis.x);
    p.speed = (axis.x !== 0 || axis.y !== 0) ? speed : 0;
  } else if (p.vehicle) {
    p.speed = p.vehicle.speed || 0;
  }

  // Regen kesehatan dimiliki combat.js (bukan di sini) supaya tidak ada
  // dua sumber kebenaran untuk health.

  // Update modul lain bila ada.
  const m = state.modules;
  if (m.world && m.world.update) m.world.update(dt);
  if (m.traffic && m.traffic.update) m.traffic.update(dt);
  if (m.peds && m.peds.update) m.peds.update(dt);
  if (m.vehicles && m.vehicles.update) m.vehicles.update(dt);
  if (m.police && m.police.update) m.police.update(dt);
  if (m.missions && m.missions.update) m.missions.update(dt);
  if (m.combat && m.combat.update) m.combat.update(dt);
  if (m.hud && m.hud.update) m.hud.update(dt);
  if (m.minimap && m.minimap.update) m.minimap.update(dt);
  if (m.menus && m.menus.update) m.menus.update(dt);
  if (state.audio) state.audio.update(dt);

  // Sinkronisasi tampilan dari modul ke state bersama.
  const M = missionsState();
  if (M) {
    if (M.current >= 0) state.missionIndex = M.current;
    if (M.objective && M.objective.label) state.objective = M.objective.label;
    if (M.status === 'storyDone' && !state.storyDoneShown) {
      state.storyDoneShown = true;
      state.mode = 'complete';
      const menus = state.modules.menus;
      if (menus) {
        menus.setEndKind('complete');
        menus.showScreen('gameover');
      }
    } else if (M.status === 'idle' && M.messageKind === 'complete'
      && !state.missionCompleteShown) {
      // Satu misi selesai: tampilkan layar MISSION COMPLETE sekali,
      // misi berikutnya dimulai saat pemain menekan Continue.
      state.missionCompleteShown = true;
      state.mode = 'complete';
      const menus = state.modules.menus;
      if (menus) {
        menus.setEndKind('complete');
        menus.showScreen('gameover');
      }
    }
  }
  // Misi berikutnya otomatis dimulai saat bermain tanpa misi aktif
  // (kecuali tepat setelah misi selesai — lihat atas).
  ensureMissionStarted(false);
  // Cerminan cash untuk modul lama yang membaca state.cash.
  state.cash = p.cash;

  // Kamera mengikuti pemain, dengan look-ahead saat bergerak cepat.
  const look = p.speed > 200 ? 90 : 0;
  const tx = p.x + Math.cos(p.angle) * look;
  const ty = p.y + Math.sin(p.angle) * look;
  const k = 1 - Math.exp(-6 * dt);
  state.camera.x += (tx - state.camera.x) * k;
  state.camera.y += (ty - state.camera.y) * k;

  if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 3);
}

function drawWorldFallback() {
  const r = renderer;
  const w = state.world;
  r.rect(0, 0, w.width, w.height, '#1d5c33');
  for (const road of w.roads) {
    if (road.vertical) r.rect(road.x, 0, 96, w.height, '#2a2e3a');
    else r.rect(0, road.y, w.width, 96, '#2a2e3a');
  }
  for (const b of w.blocks) {
    r.rect(b.x, b.y, b.w, b.h, b.tall ? '#2c3350' : '#232838', '#39415a');
    if (b.neon) {
      r.rect(b.x + 20, b.y + 20, 60, 10, '#ff2e88');
      r.rect(b.x + 20, b.y + 40, 40, 10, '#22e6ff');
    }
  }
  // Tepi air di selatan (Harborfront).
  r.rect(0, w.height - 120, w.width, 120, '#0e4d6e');
}

function drawPlayer() {
  const r = renderer;
  const p = state.player;
  const ctx = r.ctx;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  // Bayangan + badan + arah pandang: bentuk vektor tajam.
  r.circle(3, 3, 15, 'rgba(0,0,0,0.35)');
  r.roundRect(-14, -10, 28, 20, 6, '#ffd23e', '#7a5b00');
  r.rect(6, -4, 12, 8, '#20242e');
  ctx.restore();
  // Crosshair di posisi mouse (koordinat dunia). Combat.js menggambar
  // crosshair-nya sendiri bila modul itu ada — jangan digambar ganda.
  if (state.modules.combat) return;
  const aim = r.screenToWorld(input.mouse.x, input.mouse.y);
  r.circle(aim.x, aim.y, 9, 'rgba(255,255,255,0)', '#f2f5ff');
  r.line(aim.x - 13, aim.y, aim.x - 5, aim.y, '#f2f5ff', 2);
  r.line(aim.x + 5, aim.y, aim.x + 13, aim.y, '#f2f5ff', 2);
  r.line(aim.x, aim.y - 13, aim.x, aim.y - 5, '#f2f5ff', 2);
  r.line(aim.x, aim.y + 5, aim.x, aim.y + 13, '#f2f5ff', 2);
}

function drawHUD() {
  const r = renderer;
  const s = r.getSize();
  const p = state.player;
  r.resetTransform();
  // Panel kiri atas: health, armor, cash, ammo.
  r.roundRect(14, 14, 240, 96, 10, 'rgba(8,10,20,0.72)');
  r.text('NEON BAY', 26, 38, { size: 16, bold: true, color: '#22e6ff' });
  r.text('HP', 26, 62, { size: 12, color: '#9aa3c0' });
  r.rect(52, 50, 176, 12, '#20242e');
  r.rect(52, 50, 176 * (p.health / 100), 12, '#3ddc74');
  const w = p.weapon && typeof p.weapon === 'object' ? p.weapon : null;
  const ammoText = w ? (w.ammoInMag + ' / ' + w.reserveAmmo)
    : (p.ammo + ' / ' + p.reserve);
  r.text('AMMO ' + ammoText, 26, 84, { size: 12, color: '#f2f5ff' });
  r.text('$' + p.cash.toLocaleString('en-US'), 26, 102, { size: 14, bold: true, color: '#7dff8a' });
  // Bintang wanted kanan atas.
  let stars = '';
  for (let i = 0; i < 5; i++) stars += i < state.wanted ? '★' : '☆';
  r.text(stars, s.viewW - 20, 44, { size: 26, color: '#ffd23e', align: 'right' });
  // Objective bawah tengah.
  if (state.objective) {
    const w = r.textWidth(state.objective, 15, true) + 32;
    r.roundRect((s.viewW - w) / 2, s.viewH - 52, w, 34, 8, 'rgba(8,10,20,0.72)');
    r.text(state.objective, s.viewW / 2, s.viewH - 29, { size: 15, bold: true, align: 'center', color: '#ffd23e' });
  }
  // Jam.
  const hh = Math.floor(state.clockMin / 60);
  const mm = Math.floor(state.clockMin % 60);
  r.text(String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'), s.viewW - 20, s.viewH - 20, { size: 14, color: '#9aa3c0', align: 'right' });
}

function drawTitle() {
  const r = renderer;
  const s = r.getSize();
  r.resetTransform();
  r.rect(0, 0, s.viewW, s.viewH, 'rgba(5,6,14,0.55)');
  r.text('NEON BAY', s.viewW / 2, s.viewH * 0.3, { size: 72, bold: true, align: 'center', color: '#22e6ff', glow: '#ff2e88', glowBlur: 24 });
  r.text('Jax Moreno pulang. Rosa menunggu. Kota ini tidak.', s.viewW / 2, s.viewH * 0.3 + 44, { size: 18, align: 'center', color: '#f2f5ff' });
  r.text('ENTER / klik — New Game', s.viewW / 2, s.viewH * 0.55, { size: 20, bold: true, align: 'center', color: '#ffd23e' });
  r.text('WASD jalan • E masuk mobil • F curi mobil • klik kiri tembak • R reload', s.viewW / 2, s.viewH * 0.62, { size: 15, align: 'center', color: '#9aa3c0' });
  r.text('Shift lari • Space handbrake • Esc pause • M mute', s.viewW / 2, s.viewH * 0.62 + 26, { size: 15, align: 'center', color: '#9aa3c0' });
}

function drawPaused() {
  const r = renderer;
  const s = r.getSize();
  r.resetTransform();
  r.rect(0, 0, s.viewW, s.viewH, 'rgba(5,6,14,0.6)');
  r.text('PAUSED', s.viewW / 2, s.viewH / 2 - 20, { size: 48, bold: true, align: 'center', color: '#f2f5ff' });
  r.text('Esc / P — lanjut', s.viewW / 2, s.viewH / 2 + 24, { size: 18, align: 'center', color: '#9aa3c0' });
}

function draw() {
  const r = renderer;
  r.clear('#0b0e1a');
  const shakeX = state.shake > 0 ? (rng.next() - 0.5) * state.shake * 14 : 0;
  const shakeY = state.shake > 0 ? (rng.next() - 0.5) * state.shake * 14 : 0;
  r.setCamera(state.camera.x + shakeX, state.camera.y + shakeY, state.camera.zoom);
  r.applyCamera();

  // World-space: kamera sudah diterapkan main, semua draw() modul
  // dipanggil tanpa argumen dan menggambar dalam koordinat dunia.
  const m = state.modules;
  if (m.world && m.world.draw) m.world.draw();
  else drawWorldFallback();
  if (m.traffic && m.traffic.draw) m.traffic.draw();
  if (m.peds && m.peds.draw) m.peds.draw();
  if (m.vehicles && m.vehicles.draw) m.vehicles.draw();
  if (m.police && m.police.draw) m.police.draw();
  if (m.missions && m.missions.draw) m.missions.draw();
  if (m.combat && m.combat.draw) m.combat.draw();
  // Pemain jalan kaki digambar di sini; saat mengemudi, mobilnya yang
  // digambar vehicles.js (bukan figur pejalan di atas mobil).
  if (!state.player.inCar) drawPlayer();

  // Screen-space: HUD + minimap + menu me-reset transform sendiri.
  const hud = m.hud;
  if (state.mode !== 'title') {
    if (hud && hud.draw) hud.draw();
    else drawHUD();
    if (m.minimap && m.minimap.draw) m.minimap.draw();
  }

  // Layar menu: menus.js bila ada (draw-nya diam saat screen 'playing'),
  // kalau tidak ada, fallback gambar bawaan main.js.
  if (m.menus && m.menus.draw) {
    m.menus.draw();
  } else if (state.mode === 'title') drawTitle();
  else if (state.mode === 'paused') drawPaused();
  else if (state.mode === 'busted') drawEndCard('BUSTED', 'Polisi menangkapmu. Sebagian cash disita.');
  else if (state.mode === 'wasted') drawEndCard('WASTED', 'Jax tumbang. Bangun di rumah sakit.');
  else if (state.mode === 'complete') drawEndCard('MISSION COMPLETE', 'Cash masuk. Rosa senang — untuk sekarang.');
}

function drawEndCard(title, sub) {
  const r = renderer;
  const s = r.getSize();
  r.resetTransform();
  r.rect(0, 0, s.viewW, s.viewH, 'rgba(5,6,14,0.55)');
  r.text(title, s.viewW / 2, s.viewH / 2 - 10, { size: 56, bold: true, align: 'center', color: '#ffd23e', glow: '#ff2e88', glowBlur: 18 });
  r.text(sub, s.viewW / 2, s.viewH / 2 + 34, { size: 18, align: 'center', color: '#f2f5ff' });
  r.text('+$' + state.cash.toLocaleString('en-US'), s.viewW / 2, s.viewH / 2 + 70, { size: 24, bold: true, align: 'center', color: '#7dff8a' });
}

let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  state.dt = dt;
  update(dt);
  draw();
  input.update();
}

// Mode screenshot: gambar sekali (dua frame) lalu tandai siap.
// HUD tidak di-update di mode ini (tidak ada game loop), jadi jamnya
// harus dihitung sekali di sini — kalau tidak clockText HUD mentok di
// nilai awal '08:00' walau clockMin scene sudah benar.
function paintShot() {
  const hud = state.modules.hud;
  if (hud && typeof hud.update === 'function') hud.update(0);
  let painted = 0;
  function paint() {
    draw();
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

boot();
