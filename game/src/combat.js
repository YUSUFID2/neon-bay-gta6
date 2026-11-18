// Neon Bay — combat. Mouse-aimed shooting with pistol and shotgun,
// rival-gang enemies with simple chase-and-shoot AI, health/armor pickups,
// slow out-of-combat regen, and the wasted respawn with a cash penalty.
// No imports: all data arrives in `state`, all randomness from state.rng.
// The integrator owns the player, world, police and input; this module only
// reads them (guarded) and writes its results into state.combat.
//
// Expected state shape (everything guarded, fallbacks included):
//   state.rng                    objek rng seeded { next, range, int, pick, chance }
//   state.player { x, y, angle?, inCar?, vehicle? }   player position
//   state.cash                   number, the player's money
//   state.world { width, height, hospital? { x, y } }
//   state.renderer { screenToWorld }  konversi aim layar -> dunia
//   state.input { aim? {x,y}, mouse? {x,y}, firing?, reload?, switchWeapon? }
//   state.police { wanted }      cleared to 0 on wasted
//   state.missions { failMission(reason) }  called on wasted during a mission
//   state.audio { play(name) }   optional sound hook, never required
//   state.hud { ammo, weapon }   written by this module for the HUD
//
// Screen shake: update() writes state.combat.shakeX / shakeY each frame;
// the renderer should add them to the camera. Crosshair is drawn at the aim
// point in world space.

// Terima objek rng ({ next, range, int, pick, chance }), fungsi polos,
// atau tidak ada (bangun mulberry32 lokal dari seed).
function asRng(source, seed) {
  if (source && typeof source.next === 'function'
    && typeof source.range === 'function' && typeof source.pick === 'function') {
    return {
      next: () => source.next(),
      range: (a, b) => source.range(a, b),
      int: (a, b) => source.int(a, b),
      pick: (list) => source.pick(list),
      chance: (p) => source.chance(p),
    };
  }
  const fn = typeof source === 'function' ? source : null;
  let s = (typeof seed === 'number' ? seed : 0x51ed2703) >>> 0;
  if (s === 0) s = 0x51ed2703;
  function next() {
    if (fn) return fn();
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    range: (a, b) => a + next() * (b - a),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
  };
}

function fallbackRng() {
  let a = 0x51ed2703;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

function dist(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

// Distance from point (px, py) to segment (x1, y1)-(x2, y2).
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  t = clamp(t, 0, 1);
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return dist(px, py, cx, cy);
}

const WEAPON_DEFS = {
  pistol: {
    name: 'Pistol', magSize: 12, startReserve: 72, damage: 34,
    fireRate: 0.16, reloadTime: 1.1, spread: 0.045, range: 540,
    pellets: 1, kick: 0.12,
  },
  shotgun: {
    name: 'Shotgun', magSize: 6, startReserve: 24, damage: 17,
    fireRate: 0.75, reloadTime: 1.6, spread: 0.22, range: 360,
    pellets: 6, kick: 0.45,
  },
};

export function createCombat(state) {
  // Normaliser rng (sama seperti world.js): terima objek rng seeded
  // ({ next, range, int, pick, chance }); fallback lokal bila tidak ada.
  const rng = asRng(state.rng, state.seed);

  function worldWidth() {
    return (state.world && typeof state.world.width === 'number' && state.world.width > 0)
      ? state.world.width
      : 3600;
  }

  function worldHeight() {
    return (state.world && typeof state.world.height === 'number' && state.world.height > 0)
      ? state.world.height
      : 2600;
  }

  function hospitalPos() {
    if (state.world && state.world.hospital
      && typeof state.world.hospital.x === 'number') {
      return { x: state.world.hospital.x, y: state.world.hospital.y };
    }
    return { x: Math.round(worldWidth() * 0.5), y: Math.round(worldHeight() * 0.12) };
  }

  function playerPos() {
    if (!state.player || typeof state.player.x !== 'number') return null;
    return { x: state.player.x, y: state.player.y || 0 };
  }

  // player.cash adalah sumber kebenaran (lihat addCash): baca itu dulu.
  function getCash() {
    if (state.player && typeof state.player.cash === 'number') return state.player.cash;
    if (typeof state.cash === 'number') return state.cash;
    return 0;
  }

  // Sumber kebenaran cash adalah state.player.cash: main.js mencerminkan
  // player.cash -> state.cash TIAP FRAME, jadi menambah/mengurangi
  // state.cash saja akan tertimpa frame berikutnya (penalti wasted
  // hilang, sama seperti reward misi). Tulis ke player.cash dulu, lalu
  // samakan cerminannya.
  function addCash(amount) {
    if (state.player && typeof state.player.cash === 'number') {
      state.player.cash += amount;
      state.cash = state.player.cash;
    } else if (typeof state.cash === 'number') {
      state.cash += amount;
    } else {
      state.cash = amount;
    }
  }

  function setWanted(level) {
    if (state.police && typeof state.police.wanted === 'number') state.police.wanted = level;
    else state.wanted = level;
  }

  // audio.js tidak punya play(name); petakan ke metode yang memang ada.
  function playSound(name) {
    if (!state.audio) return;
    try {
      if (name === 'shoot' || name === 'shotgun' || name === 'enemyShoot') {
        if (typeof state.audio.shot === 'function') state.audio.shot();
      } else if (name === 'reload') {
        if (typeof state.audio.reload === 'function') state.audio.reload();
      } else if (name === 'pickup' || name === 'enemyDown') {
        if (typeof state.audio.pickup === 'function') state.audio.pickup();
      } else if (name === 'wasted') {
        if (typeof state.audio.stinger === 'function') state.audio.stinger('fail');
      }
      // dryFire / emptyClick / hurt: tidak ada suara padanannya, diam saja.
    } catch (err) { /* sound never blocks the game */ }
  }

  function makeWeapon(name) {
    const def = WEAPON_DEFS[name];
    return {
      name: def.name, key: name, magSize: def.magSize, mag: def.magSize,
      reserve: def.startReserve, damage: def.damage, fireRate: def.fireRate,
      reloadTime: def.reloadTime, spread: def.spread, range: def.range,
      pellets: def.pellets, kick: def.kick,
    };
  }

  const C = {
    maxHealth: 100,
    health: 100,
    maxArmor: 100,
    armor: 0,
    weapons: { pistol: makeWeapon('pistol') },
    current: 'pistol',
    hasShotgun: false,
    enemies: [],
    pickups: [],
    tracers: [],
    sparks: [],
    flashes: [],
    kills: 0,
    shake: 0,
    shakeX: 0,
    shakeY: 0,
    elapsed: 0,
    fireTimer: 0,
    reloadTimer: 0,
    reloading: false,
    seeded: false, // world pickups spawn on the first update, once the
    // integrator has settled the real world size
    lastDamageAt: -99,
    lastWastedAt: -99,
    wastedCount: 0,
    aim: { x: 0, y: 0 },
    firing: false,
  };
  state.combat = C;

  function currentWeapon() {
    return C.weapons[C.current] || C.weapons.pistol;
  }

  function readAim(pos) {
    const input = state.input || {};
    // input.aim adalah koordinat LAYAR (mouse CSS px). Kamera renderer
    // berpusat di pemain (bukan top-left), jadi konversi harus lewat
    // renderer.screenToWorld — bukan mouse + camera.
    const toWorld = (sx, sy) => {
      if (state.renderer && typeof state.renderer.screenToWorld === 'function') {
        return state.renderer.screenToWorld(sx, sy);
      }
      return null;
    };
    if (input.aim && typeof input.aim.x === 'number') {
      const w = toWorld(input.aim.x, input.aim.y);
      if (w) { C.aim.x = w.x; C.aim.y = w.y; }
      else { C.aim.x = input.aim.x; C.aim.y = input.aim.y; }
      return;
    }
    if (input.mouse && typeof input.mouse.x === 'number') {
      const w = toWorld(input.mouse.x, input.mouse.y);
      if (w) { C.aim.x = w.x; C.aim.y = w.y; return; }
    }
    // No mouse data: aim at the nearest enemy, else where the player faces.
    let best = null;
    let bestD = Infinity;
    for (const e of C.enemies) {
      if (!e.alive) continue;
      const d = dist(pos.x, pos.y, e.x, e.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best) {
      C.aim.x = best.x;
      C.aim.y = best.y;
    } else {
      const angle = (state.player && typeof state.player.angle === 'number') ? state.player.angle : 0;
      C.aim.x = pos.x + Math.cos(angle) * 200;
      C.aim.y = pos.y + Math.sin(angle) * 200;
    }
  }

  function addShake(amount) {
    C.shake = clamp(C.shake + amount, 0, 1);
  }

  function addTracer(x1, y1, x2, y2) {
    C.tracers.push({ x1, y1, x2, y2, life: 0.09, maxLife: 0.09 });
    if (C.tracers.length > 40) C.tracers.shift();
  }

  function addSpark(x, y, count) {
    for (let i = 0; i < count; i += 1) {
      const a = rng.next() * Math.PI * 2;
      const sp = 120 + rng.next() * 220;
      C.sparks.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.22 + rng.next() * 0.15, maxLife: 0.35,
      });
    }
    if (C.sparks.length > 120) C.sparks.splice(0, C.sparks.length - 120);
  }

  function fireShot(pos) {
    const weapon = currentWeapon();
    if (C.reloadTimer > 0 || C.fireTimer > 0) return;
    if (weapon.mag <= 0) {
      playSound('dryFire');
      C.fireTimer = 0.25;
      return;
    }
    weapon.mag -= 1;
    C.fireTimer = weapon.fireRate;
    const baseAngle = Math.atan2(C.aim.y - pos.y, C.aim.x - pos.x);
    C.flashes.push({ x: pos.x, y: pos.y, angle: baseAngle, life: 0.06, maxLife: 0.06 });
    addShake(weapon.kick);
    playSound(weapon.key === 'shotgun' ? 'shotgun' : 'shoot');

    for (let p = 0; p < weapon.pellets; p += 1) {
      const angle = baseAngle + (rng.next() - 0.5) * 2 * weapon.spread;
      const ex = pos.x + Math.cos(angle) * weapon.range;
      const ey = pos.y + Math.sin(angle) * weapon.range;
      let hitEnemy = null;
      let hitDist = Infinity;
      for (const e of C.enemies) {
        if (!e.alive) continue;
        const d = distToSegment(e.x, e.y, pos.x, pos.y, ex, ey);
        if (d < e.radius + 4) {
          const ed = dist(pos.x, pos.y, e.x, e.y);
          if (ed < hitDist) { hitDist = ed; hitEnemy = e; }
        }
      }
      if (hitEnemy) {
        const hx = pos.x + Math.cos(angle) * hitDist;
        const hy = pos.y + Math.sin(angle) * hitDist;
        addTracer(pos.x, pos.y, hx, hy);
        addSpark(hx, hy, 5);
        damageEnemy(hitEnemy, weapon.damage);
      } else {
        addTracer(pos.x, pos.y, ex, ey);
      }
    }
    if (weapon.mag === 0) playSound('emptyClick');
  }

  function damageEnemy(enemy, amount) {
    enemy.hp -= amount;
    enemy.flash = 0.12;
    if (enemy.hp <= 0 && enemy.alive) {
      enemy.alive = false;
      C.kills += 1;
      addSpark(enemy.x, enemy.y, 14);
      playSound('enemyDown');
      // A fallen rival sometimes drops something useful.
      const roll = rng.next();
      if (roll < 0.22) spawnPickup(enemy.x, enemy.y, 'health');
      else if (roll < 0.4) spawnPickup(enemy.x, enemy.y, 'ammo');
    }
  }

  function startReload() {
    const weapon = currentWeapon();
    if (C.reloading || weapon.mag >= weapon.magSize || weapon.reserve <= 0) return;
    C.reloading = true;
    C.reloadTimer = weapon.reloadTime;
    playSound('reload');
  }

  function finishReload() {
    const weapon = currentWeapon();
    const needed = weapon.magSize - weapon.mag;
    const moved = Math.min(needed, weapon.reserve);
    weapon.mag += moved;
    weapon.reserve -= moved;
    C.reloading = false;
    C.reloadTimer = 0;
  }

  function spawnEnemy(x, y, opts) {
    const kind = (opts && opts.kind) || 'viper';
    const boss = kind === 'boss';
    const enemy = {
      x, y,
      kind,
      boss,
      mission: !!(opts && opts.mission),
      hp: boss ? 320 : 100,
      maxHp: boss ? 320 : 100,
      speed: boss ? 95 : 120 + rng.next() * 40,
      radius: boss ? 22 : 15,
      fireTimer: 0.6 + rng.next() * 0.8,
      angle: 0,
      alive: true,
      flash: 0,
      wander: rng.next() * Math.PI * 2,
    };
    C.enemies.push(enemy);
    return enemy;
  }

  function clearMissionEnemies() {
    C.enemies = C.enemies.filter((e) => !e.mission);
  }

  function spawnPickup(x, y, kind) {
    const pickup = {
      x, y, kind,
      amount: kind === 'health' ? 40 : kind === 'armor' ? 50 : kind === 'ammo' ? 36 : 0,
      bob: rng.next() * Math.PI * 2,
      life: 45,
    };
    C.pickups.push(pickup);
    return pickup;
  }

  function seedWorldPickups() {
    // A few pickups scattered around the city so free roam stays survivable.
    const spots = [
      { fx: 0.5, fy: 0.12, kind: 'health' },
      { fx: 0.3, fy: 0.5, kind: 'armor' },
      { fx: 0.7, fy: 0.4, kind: 'ammo' },
      { fx: 0.2, fy: 0.85, kind: 'health' },
      { fx: 0.85, fy: 0.25, kind: 'ammo' },
    ];
    for (const s of spots) {
      spawnPickup(Math.round(s.fx * worldWidth()), Math.round(s.fy * worldHeight()), s.kind);
    }
  }

  function giveWeapon(name) {
    if (name === 'shotgun' && !C.hasShotgun) {
      C.weapons.shotgun = makeWeapon('shotgun');
      C.hasShotgun = true;
      C.current = 'shotgun';
      if (state.hud) state.hud.weapon = 'Shotgun';
      playSound('pickup');
    } else if (C.weapons[name]) {
      C.current = name;
    }
  }

  function giveAmmo(amount) {
    const weapon = currentWeapon();
    weapon.reserve += amount;
    if (C.weapons.shotgun) C.weapons.shotgun.reserve += Math.floor(amount / 3);
  }

  function damagePlayer(amount, fromX, fromY) {
    if (C.health <= 0) return;
    let remaining = amount;
    if (C.armor > 0) {
      const absorbed = Math.min(C.armor, remaining * 0.6);
      C.armor -= absorbed;
      remaining -= absorbed;
    }
    C.health -= remaining;
    C.lastDamageAt = C.elapsed;
    addShake(0.25);
    playSound('hurt');
    if (C.health <= 0) {
      C.health = 0;
      wasted();
    }
  }

  function wasted() {
    const cash = getCash();
    const penalty = Math.min(cash, Math.max(50, Math.round(cash * 0.1)));
    addCash(-penalty);
    C.wastedCount += 1;
    C.lastWastedAt = C.elapsed;
    C.health = C.maxHealth;
    C.armor = 0;
    C.enemies = C.enemies.filter((e) => !e.mission);
    C.tracers.length = 0;
    C.sparks.length = 0;
    C.reloading = false;
    C.reloadTimer = 0;
    setWanted(0);
    const hospital = hospitalPos();
    if (state.player) {
      state.player.x = hospital.x;
      state.player.y = hospital.y;
      if (typeof state.player.angle === 'number') state.player.angle = Math.PI / 2;
      // Pemain adalah sumber kebenaran untuk HUD: sinkronkan langsung
      // (update() tidak jalan saat mode 'wasted').
      state.player.health = C.health;
      state.player.armor = 0;
      state.player.dead = false;
      if (state.player.vehicle) {
        state.player.vehicle = null;
        state.player.inCar = false;
        state.playerCar = null;
      }
    }
    playSound('wasted');
    if (state.missions && typeof state.missions.failMission === 'function'
      && state.missions.status === 'active') {
      state.missions.failMission('wasted');
    }
    // Integrator (main.js) menampilkan layar WASTED lewat hook ini.
    if (state.onWasted) state.onWasted();
  }

  function updateEnemies(dt, pos) {
    for (const e of C.enemies) {
      if (!e.alive) continue;
      if (e.flash > 0) e.flash -= dt;
      const d = dist(e.x, e.y, pos.x, pos.y);
      const angleToPlayer = Math.atan2(pos.y - e.y, pos.x - e.x);
      e.angle = angleToPlayer;
      if (d > 300) {
        e.x += Math.cos(angleToPlayer) * e.speed * dt;
        e.y += Math.sin(angleToPlayer) * e.speed * dt;
      } else if (d < 180) {
        e.x -= Math.cos(angleToPlayer) * e.speed * 0.6 * dt;
        e.y -= Math.sin(angleToPlayer) * e.speed * 0.6 * dt;
      } else {
        // Strafe slowly while in range so shootouts do not stand still.
        e.wander += dt * 0.8;
        e.x += Math.cos(e.wander) * e.speed * 0.35 * dt;
        e.y += Math.sin(e.wander) * e.speed * 0.35 * dt;
      }
      e.fireTimer -= dt;
      if (e.fireTimer <= 0 && d < 460) {
        e.fireTimer = (e.boss ? 0.9 : 1.3) + rng.next() * 0.7;
        const aimErr = (rng.next() - 0.5) * 0.35;
        const shotAngle = angleToPlayer + aimErr;
        const tx = pos.x + Math.cos(shotAngle) * 40;
        const ty = pos.y + Math.sin(shotAngle) * 40;
        addTracer(e.x, e.y, tx, ty);
        playSound('enemyShoot');
        // Hit chance falls with distance; the boss hits harder.
        const hitChance = clamp(0.55 - d / 1100, 0.08, 0.5);
        if (rng.next() < hitChance) {
          addSpark(pos.x, pos.y, 4);
          damagePlayer(e.boss ? 16 : 10, e.x, e.y);
        }
      }
    }
    // Prune the dead every frame: kills are already counted in C.kills,
    // so dropping corpses here cannot confuse a shootout objective.
    if (C.enemies.length > 0) {
      C.enemies = C.enemies.filter((e) => e.alive);
    }
  }

  function updatePickups(dt, pos) {
    for (let i = C.pickups.length - 1; i >= 0; i -= 1) {
      const p = C.pickups[i];
      p.bob += dt * 3;
      p.life -= dt;
      if (p.life <= 0) {
        C.pickups.splice(i, 1);
        continue;
      }
      if (dist(pos.x, pos.y, p.x, p.y) < 34) {
        if (p.kind === 'health') C.health = Math.min(C.maxHealth, C.health + p.amount);
        else if (p.kind === 'armor') C.armor = Math.min(C.maxArmor, C.armor + p.amount);
        else if (p.kind === 'ammo') giveAmmo(p.amount);
        else if (p.kind === 'shotgun') giveWeapon('shotgun');
        addSpark(p.x, p.y, 8);
        playSound('pickup');
        C.pickups.splice(i, 1);
      }
    }
  }

  function update(dt) {
    C.elapsed += dt;
    const pos = playerPos();
    if (!pos) return;

    // Seed world pickups lazily so positions use the final world size.
    if (!C.seeded) {
      seedWorldPickups();
      C.seeded = true;
    }

    // Shake decays; offsets are recomputed every frame for the renderer.
    C.shake = Math.max(0, C.shake - dt * 2.2);
    C.shakeX = (rng.next() - 0.5) * 2 * C.shake * 9;
    C.shakeY = (rng.next() - 0.5) * 2 * C.shake * 9;

    // Slow health regen after 6 seconds without taking damage.
    if (C.health > 0 && C.health < C.maxHealth && C.elapsed - C.lastDamageAt > 6) {
      C.health = Math.min(C.maxHealth, C.health + 6 * dt);
    }

    // Input: aim, fire, reload, weapon switch. All fields optional.
    const input = state.input || {};
    readAim(pos);
    const inVehicle = !!(state.player
      && (state.player.inCar || state.player.vehicle || state.playerCar));
    C.firing = !!input.firing || !!input.mouseDown || !!input.shoot;
    if (C.fireTimer > 0) C.fireTimer -= dt;
    if (C.reloadTimer > 0) {
      C.reloadTimer -= dt;
      if (C.reloadTimer <= 0) finishReload();
    }
    if (input.reload) {
      input.reload = false;
      if (!inVehicle) startReload();
    }
    if (input.switchWeapon) {
      const want = input.switchWeapon;
      input.switchWeapon = null;
      if (want === 'shotgun' && C.hasShotgun) C.current = 'shotgun';
      else if (want === 'pistol') C.current = 'pistol';
      else if (want === 'cycle' && C.hasShotgun) {
        C.current = C.current === 'pistol' ? 'shotgun' : 'pistol';
      }
    }
    if (C.firing && !inVehicle && C.health > 0) fireShot(pos);

    updateEnemies(dt, pos);
    updatePickups(dt, pos);

    for (let i = C.tracers.length - 1; i >= 0; i -= 1) {
      C.tracers[i].life -= dt;
      if (C.tracers[i].life <= 0) C.tracers.splice(i, 1);
    }
    for (let i = C.sparks.length - 1; i >= 0; i -= 1) {
      const s = C.sparks[i];
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.92;
      s.vy *= 0.92;
      if (s.life <= 0) C.sparks.splice(i, 1);
    }
    for (let i = C.flashes.length - 1; i >= 0; i -= 1) {
      C.flashes[i].life -= dt;
      if (C.flashes[i].life <= 0) C.flashes.splice(i, 1);
    }

    // Mirror ke pemain: combat adalah pemilik health/armor/senjata, tapi
    // HUD, save, dan modul lain membacanya dari state.player.
    mirrorToPlayer();
    // HUD mirror.
    if (state.hud) {
      const weapon = currentWeapon();
      state.hud.ammo = `${weapon.mag} / ${weapon.reserve}`;
      state.hud.weapon = weapon.name;
      state.hud.health = Math.ceil(C.health);
      state.hud.armor = Math.ceil(C.armor);
    }
  }

  // Tulis health/armor/senjata combat ke state.player (bentuk kontrak:
  // weapon objek, weapons array, weaponIndex, ammo/reserve cerminan).
  function mirrorToPlayer() {
    const p = state.player;
    if (!p) return;
    p.health = C.health;
    p.armor = C.armor;
    p.maxHealth = C.maxHealth;
    p.maxArmor = C.maxArmor;
    const list = [];
    if (C.weapons.pistol) {
      list.push(toPlayerWeapon(C.weapons.pistol));
    }
    if (C.weapons.shotgun) {
      list.push(toPlayerWeapon(C.weapons.shotgun));
    }
    p.weapons = list;
    p.weaponIndex = Math.max(0, list.findIndex((w) => w.key === C.current));
    p.weapon = list[p.weaponIndex] || list[0] || null;
    if (p.weapon) {
      p.ammo = p.weapon.ammoInMag;
      p.reserve = p.weapon.reserveAmmo;
    }
  }

  function toPlayerWeapon(w) {
    return {
      key: w.key,
      name: w.name,
      ammoInMag: w.mag,
      magSize: w.magSize,
      reserveAmmo: w.reserve,
      reloading: C.reloading && C.current === w.key,
    };
  }

  // Arah sebaliknya: baca health/ammo dari pemain ke combat. Dipakai
  // integrator sekali setelah applyShot / load save, supaya nilai yang
  // disetel di luar (mis. scene screenshot) tidak tertimpa.
  function syncFromPlayer() {
    const p = state.player;
    if (!p) return;
    if (typeof p.health === 'number') C.health = p.health;
    if (typeof p.armor === 'number') C.armor = p.armor;
    const w = C.weapons[C.current] || C.weapons.pistol;
    if (w) {
      if (typeof p.ammo === 'number') w.mag = p.ammo;
      if (typeof p.reserve === 'number') w.reserve = p.reserve;
    }
  }

  // Draws enemies, pickups, tracers, sparks, flashes and the crosshair in
  // world space. Konvensi draw main.js: dipanggil tanpa argumen SETELAH
  // main menerapkan transform kamera — ctx dari state.renderer.ctx, tanpa
  // translate tambahan.
  function draw() {
    const r = state.renderer;
    if (!r || !r.ctx) return;
    const ctx = r.ctx;
    const pos = playerPos();
    ctx.save();

    // Pickups.
    for (const p of C.pickups) {
      const bobY = Math.sin(p.bob) * 3;
      const blink = p.life < 5 ? (Math.floor(p.life * 4) % 2 === 0 ? 0.35 : 1) : 1;
      ctx.globalAlpha = blink;
      ctx.beginPath();
      ctx.arc(p.x, p.y + bobY, 14, 0, Math.PI * 2);
      if (p.kind === 'health') ctx.fillStyle = '#22c55e';
      else if (p.kind === 'armor') ctx.fillStyle = '#3b82f6';
      else if (p.kind === 'ammo') ctx.fillStyle = '#eab308';
      else ctx.fillStyle = '#a16207';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.kind === 'health' ? '+' : p.kind === 'armor' ? 'A' : p.kind === 'ammo' ? '»' : 'S', p.x, p.y + bobY + 0.5);
      ctx.globalAlpha = 1;
    }

    // Enemies.
    for (const e of C.enemies) {
      if (!e.alive) continue;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
      ctx.fillStyle = e.flash > 0 ? '#fca5a5' : e.boss ? '#7f1d1d' : '#dc2626';
      ctx.fill();
      ctx.strokeStyle = '#450a0a';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Facing tick (gun direction).
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x + Math.cos(e.angle) * (e.radius + 8), e.y + Math.sin(e.angle) * (e.radius + 8));
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 3;
      ctx.stroke();
      // Health bar.
      const barW = e.boss ? 44 : 30;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(e.x - barW / 2, e.y - e.radius - 12, barW, 5);
      ctx.fillStyle = e.boss ? '#f97316' : '#ef4444';
      ctx.fillRect(e.x - barW / 2, e.y - e.radius - 12, barW * clamp(e.hp / e.maxHp, 0, 1), 5);
      if (e.boss) {
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fdba74';
        ctx.fillText('KANE', e.x, e.y - e.radius - 18);
      }
    }

    // Tracers.
    for (const t of C.tracers) {
      ctx.beginPath();
      ctx.moveTo(t.x1, t.y1);
      ctx.lineTo(t.x2, t.y2);
      ctx.strokeStyle = `rgba(253, 224, 71, ${clamp(t.life / t.maxLife, 0, 1)})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Hit sparks.
    for (const s of C.sparks) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(251, 146, 60, ${clamp(s.life / s.maxLife, 0, 1)})`;
      ctx.fill();
    }

    // Muzzle flashes.
    for (const f of C.flashes) {
      const a = clamp(f.life / f.maxLife, 0, 1);
      ctx.beginPath();
      ctx.arc(f.x + Math.cos(f.angle) * 16, f.y + Math.sin(f.angle) * 16, 10 * a + 4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(253, 224, 71, ${a})`;
      ctx.fill();
    }

    // Crosshair at the aim point.
    if (pos) {
      const ax = C.aim.x;
      const ay = C.aim.y;
      ctx.beginPath();
      ctx.arc(ax, ay, 10, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ax - 14, ay);
      ctx.lineTo(ax - 5, ay);
      ctx.moveTo(ax + 5, ay);
      ctx.lineTo(ax + 14, ay);
      ctx.moveTo(ax, ay - 14);
      ctx.lineTo(ax, ay - 5);
      ctx.moveTo(ax, ay + 5);
      ctx.lineTo(ax, ay + 14);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ax, ay, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444';
      ctx.fill();
    }

    ctx.restore();
  }

  // Cross-module API: the missions module calls state.combat.spawnEnemy,
  // clearMissionEnemies and giveWeapon, so the functions must live on the
  // state object itself, not only on the object this factory returns.
  C.spawnEnemy = spawnEnemy;
  C.spawnPickup = spawnPickup;
  C.clearMissionEnemies = clearMissionEnemies;
  C.giveWeapon = giveWeapon;
  C.giveAmmo = giveAmmo;
  C.damagePlayer = damagePlayer;
  C.wasted = wasted;
  C.syncFromPlayer = syncFromPlayer;

  return {
    update,
    draw,
    spawnEnemy,
    spawnPickup,
    clearMissionEnemies,
    giveWeapon,
    giveAmmo,
    damagePlayer,
    wasted,
    syncFromPlayer,
    state: C,
  };
}
