// police.js — Neon Bay wanted level and police AI.
// Factory: createPolice(state). Owns state.wanted (0-5) and state.police.
// No imports: shared values arrive through `state`, all randomness via
// state.rng. Guards everywhere so the module runs before world / player /
// vehicles are wired. Sirens go through state.audio with a guard.

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
  let s = (typeof seed === 'number' ? seed : 0x51ab3f) >>> 0;
  if (s === 0) s = 0x51ab3f;
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

export function createPolice(state) {
  // Normaliser rng (sama seperti world.js): terima objek rng seeded,
  // fungsi polos, atau tidak ada (fallback mulberry32 lokal dari seed).
  const rng = asRng(state.rng, state.seed);
  const pick = (arr) => arr[Math.floor(rng.next() * arr.length) % arr.length];

  // Mobil yang dikendarai pemain: state.player.vehicle (kontrak state),
  // dengan state.playerCar sebagai alias lama.
  function playerCar() {
    const p = state.player;
    return (p && p.vehicle) || state.playerCar || null;
  }

  let clock = 0;
  let lastCrimeAt = -999;      // clock time of the last crime
  let lastSeenAt = -999;       // clock time a cop last saw the player
  let decayTimer = 0;          // counts quiet seconds toward losing a star
  let spawnTimer = 2;          // counts down to the next spawn check
  let sirenTimer = 0;

  const MAX_WANTED = 5;
  // Per-star tuning: how many cops the level wants, foot speed, car speed.
  const LEVEL = [
    null,
    { foot: 2, car: 0, footSpeed: 150, carSpeed: 300, sight: 420 },
    { foot: 3, car: 1, footSpeed: 165, carSpeed: 320, sight: 460 },
    { foot: 4, car: 2, footSpeed: 180, carSpeed: 345, sight: 500 },
    { foot: 5, car: 3, footSpeed: 195, carSpeed: 370, sight: 540 },
    { foot: 6, car: 4, footSpeed: 210, carSpeed: 395, sight: 580 },
  ];

  function player() { return state.player || null; }
  function world() { return state.world || null; }

  function wanted() {
    if (typeof state.wanted !== 'number') state.wanted = 0;
    return state.wanted;
  }

  function setWanted(n) {
    const v = Math.max(0, Math.min(MAX_WANTED, Math.round(n)));
    const before = wanted();
    state.wanted = v;
    // (Sirene loop sudah dibunyikan update(); audio.js tidak punya sirenBurst.)
    if (state.events) state.events.push({ type: 'wanted', from: before, to: v, t: clock });
    return v;
  }

  // Public crime hook: other modules (vehicles, combat) call this.
  // `kind` is a label for the event log: 'carjack' | 'shoot' | 'ped' | 'ram'.
  function addWanted(amount, kind) {
    if (amount <= 0) return wanted();
    lastCrimeAt = clock;
    decayTimer = 0;
    const v = setWanted(wanted() + amount);
    if (state.events) {
      state.events.push({ type: 'crime', kind: kind || 'crime', stars: v, t: clock });
    }
    return v;
  }

  function clearWanted() {
    state.wanted = 0;
    decayTimer = 0;
  }

  // ---- Spawning -------------------------------------------------------------
  function edgeSpawnPoint() {
    const w = world();
    const W = (w && w.width) || 2400;
    const H = (w && w.height) || 1800;
    const p = player();
    const px = p ? p.x : W / 2, py = p ? p.y : H / 2;
    // Pick a point on the map edge, biased to be far from the player so
    // cops arrive instead of popping in on top of them.
    for (let tries = 0; tries < 8; tries++) {
      const side = Math.floor(rng.next() * 4);
      let x, y;
      if (side === 0) { x = rng.next() * W; y = 24; }
      else if (side === 1) { x = rng.next() * W; y = H - 24; }
      else if (side === 2) { x = 24; y = rng.next() * H; }
      else { x = W - 24; y = rng.next() * H; }
      if (Math.hypot(x - px, y - py) > 500) return { x, y };
    }
    return { x: W / 2, y: 24 };
  }

  function spawnFootCop() {
    const at = edgeSpawnPoint();
    const cop = {
      id: 'cop-' + Math.floor(rng.next() * 1e9).toString(36),
      kind: 'foot',
      x: at.x, y: at.y, angle: 0,
      speed: 0, hp: 50,
      state: 'chase',
      stuck: 0,
      dead: false,
    };
    state.police.push(cop);
    return cop;
  }

  function spawnCarCop() {
    const at = edgeSpawnPoint();
    // Ask the vehicles module (via state) for a cruiser if it offers one;
    // otherwise create a plain police car entry here and let vehicles
    // draw it by type.
    let car = null;
    if (state.vehiclesApi && typeof state.vehiclesApi.spawnCruiser === 'function') {
      car = state.vehiclesApi.spawnCruiser(at.x, at.y, 0);
    } else {
      car = {
        id: 'car-' + Math.floor(rng.next() * 1e9).toString(36),
        type: 'cruiser', x: at.x, y: at.y, angle: 0,
        speed: 0, steer: 0, damage: 0, maxHp: 120,
        driver: 'police', parked: false, traffic: false,
        wrecked: false, exploded: false, smoke: 0, brakeLight: false, dead: false,
      };
      if (!Array.isArray(state.vehicles)) state.vehicles = [];
      state.vehicles.push(car);
    }
    const cop = {
      id: 'cop-' + Math.floor(rng.next() * 1e9).toString(36),
      kind: 'car',
      x: at.x, y: at.y, angle: 0,
      speed: 0, hp: 100,
      car,
      state: 'chase',
      stuck: 0,
      dead: false,
    };
    state.police.push(cop);
    return cop;
  }

  function desiredCounts() {
    const lvl = LEVEL[wanted()];
    if (!lvl) return { foot: 0, car: 0 };
    return { foot: lvl.foot, car: lvl.car };
  }

  function maintainForce(dt) {
    if (wanted() === 0) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnTimer = 1.5;
    const want = desiredCounts();
    const haveFoot = state.police.filter((c) => c.kind === 'foot' && !c.dead).length;
    const haveCar = state.police.filter((c) => c.kind === 'car' && !c.dead).length;
    if (haveFoot < want.foot) spawnFootCop();
    else if (haveCar < want.car) spawnCarCop();
  }

  // ---- Sight / decay ---------------------------------------------------------
  function playerSeen() {
    const p = player();
    if (!p) return false;
    const lvl = LEVEL[wanted()];
    const sight = lvl ? lvl.sight : 400;
    for (const cop of state.police) {
      if (cop.dead) continue;
      if (Math.hypot(cop.x - p.x, cop.y - p.y) < sight) return true;
    }
    return false;
  }

  function decayWanted(dt) {
    if (wanted() === 0) return;
    if (clock - lastCrimeAt < 8) return; // fresh crime: no decay yet
    if (playerSeen()) {
      lastSeenAt = clock;
      decayTimer = 0;
      return;
    }
    // Unseen and quiet: lose one star after a stretch that gets shorter
    // at low wanted levels and longer at high ones.
    decayTimer += dt;
    const need = 14 + wanted() * 6;
    if (decayTimer >= need) {
      decayTimer = 0;
      setWanted(wanted() - 1);
    }
  }

  // ---- Cop behaviour ---------------------------------------------------------
  function steerToward(cop, tx, ty, speed, dt) {
    const dx = tx - cop.x, dy = ty - cop.y;
    const dist = Math.hypot(dx, dy) || 1;
    const wantAngle = Math.atan2(dy, dx);
    let diff = wantAngle - cop.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    cop.angle += Math.max(-3.2 * dt, Math.min(3.2 * dt, diff));
    cop.speed += (speed - cop.speed) * Math.min(1, 3 * dt);
    cop.x += Math.cos(cop.angle) * cop.speed * dt;
    cop.y += Math.sin(cop.angle) * cop.speed * dt;
    return dist;
  }

  function updateFootCop(cop, dt) {
    const p = player();
    const lvl = LEVEL[wanted()] || LEVEL[1];
    if (!p || p.dead) { cop.state = 'patrol'; return; }
    const inCar = !!playerCar();
    if (inCar) {
      // On foot cops cannot catch a car: run toward where the player was
      // last seen and give up the chase for this beat.
      cop.state = 'search';
      steerToward(cop, p.x, p.y, lvl.footSpeed * 0.7, dt);
      return;
    }
    cop.state = 'chase';
    const dist = steerToward(cop, p.x, p.y, lvl.footSpeed, dt);
    if (dist < 26) bustPlayer(cop);
  }

  function updateCarCop(cop, dt) {
    const p = player();
    const lvl = LEVEL[wanted()] || LEVEL[1];
    if (!cop.car || cop.car.exploded || cop.car.dead) {
      // Their cruiser is wrecked: the cop continues on foot.
      cop.kind = 'foot';
      cop.car = null;
      return;
    }
    const car = cop.car;
    if (!p || p.dead) return;
    // Aim slightly ahead of the player to cut them off, and ram when close.
    const lookAhead = playerCar() ? 90 : 30;
    const px = p.x + Math.cos(p.angle || 0) * lookAhead;
    const py = p.y + Math.sin(p.angle || 0) * lookAhead;
    const dx = px - car.x, dy = py - car.y;
    const dist = Math.hypot(dx, dy) || 1;
    const wantAngle = Math.atan2(dy, dx);
    let diff = wantAngle - car.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const top0 = lvl.carSpeed;
    // Datang pelan saat dekat: polisi melambat ketika sudah menempel
    // target, jadi mereka mengepung bukannya mengorbit kencang melewati
    // pemain (ini juga yang membuat aturan busted-di-mobil bisa terjadi).
    const approach = dist < 260 ? Math.max(0.22, dist / 260) : 1;
    const top = top0 * approach;
    car.speed += (top - car.speed) * Math.min(1, 1.6 * dt);
    car.angle += Math.max(-2.6 * dt, Math.min(2.6 * dt, diff)) * Math.sign(car.speed || 1);
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    cop.x = car.x; cop.y = car.y; cop.angle = car.angle; cop.speed = car.speed;

    // Ram: if we touch the player's car, slow them and damage it.
    // Perlambatan diskalakan dt (bukan per frame), dan kerusakan hanya
    // tiap 0,8 detik — kalau tidak, sentuhan sesaat menghancurkan mobil
    // pemain dalam hitungan frame.
    if (playerCar() && dist < 58) {
      const pc = playerCar();
      pc.speed *= Math.max(0, 1 - 2.5 * dt);
      if (clock - (cop.lastRamAt || -99) > 0.8) {
        cop.lastRamAt = clock;
        if (state.vehiclesApi && typeof state.vehiclesApi.damageCar === 'function') {
          state.vehiclesApi.damageCar(pc, 6, 'police');
        } else if (typeof pc.damage === 'number') {
          pc.damage += 6;
        }
        if (state.audio && typeof state.audio.crash === 'function') state.audio.crash(120);
      }
    }
    // Block: at high wanted, one car cop tries to park across the road
    // ahead of the player instead of chasing from behind.
    if (wanted() >= 4 && dist < 260 && rng.next() < dt * 0.15) {
      car.speed *= 0.4;
      car.angle = wantAngle + Math.PI / 2;
    }
  }

  // ---- Busted / respawn ------------------------------------------------------
  function policeStation() {
    const w = world();
    if (w && w.policeStation) return { x: w.policeStation.x, y: w.policeStation.y };
    return { x: 120, y: 120 };
  }

  function hospital() {
    const w = world();
    if (w && w.hospital) return { x: w.hospital.x, y: w.hospital.y };
    return { x: 120, y: 200 };
  }

  function bustPlayer(cop) {
    const p = player();
    if (!p || p.dead) return;
    // Leave the car behind if busted while driving.
    if (playerCar()) {
      p.vehicle = null;
      state.playerCar = null;
      p.inCar = false;
    }
    const cash = typeof p.cash === 'number' ? p.cash : (typeof state.cash === 'number' ? state.cash : 0);
    const fine = Math.min(cash, Math.max(25, Math.floor(cash * 0.15)));
    if (typeof p.cash === 'number') p.cash -= fine;
    else if (typeof state.cash === 'number') state.cash -= fine;
    const at = policeStation();
    p.x = at.x; p.y = at.y;
    p.health = typeof p.maxHealth === 'number' ? p.maxHealth : 100;
    p.armor = 0;
    // Combat memegang salinan health sendiri: sinkronkan supaya HUD dan
    // regen tidak mengembalikan health lama.
    if (state.combat) { state.combat.health = p.health; state.combat.armor = 0; }
    clearWanted();
    // Clear the force so the player is not instantly re-busted.
    for (const c of state.police) {
      if (c.kind === 'car' && c.car) { c.car.driver = null; c.car.traffic = false; }
      c.dead = true;
    }
    if (state.events) state.events.push({ type: 'busted', fine, t: clock });
    if (state.audio && typeof state.audio.stinger === 'function') state.audio.stinger('busted');
    // Mission failure (death or bust) restarts that mission (DESIGN.md):
    // fail the active mission here, mirroring the wasted path in
    // combat.js. Without this, busting clears the wanted level and a
    // mission 2 'loseWanted' objective completes in the same frame
    // (+$600) instead of failing.
    if (state.missions && typeof state.missions.failMission === 'function'
      && state.missions.status === 'active') {
      state.missions.failMission('busted');
    }
    if (state.onBusted) state.onBusted(fine);
  }

  // Wasted (player died) is detected by the combat module; police.js owns
  // the shared respawn so both paths behave the same way.
  function respawnAfterWasted() {
    const p = player();
    if (!p) return;
    if (playerCar()) {
      p.vehicle = null;
      state.playerCar = null;
      p.inCar = false;
    }
    const cash = typeof p.cash === 'number' ? p.cash : (typeof state.cash === 'number' ? state.cash : 0);
    const fine = Math.min(cash, Math.max(25, Math.floor(cash * 0.1)));
    if (typeof p.cash === 'number') p.cash -= fine;
    else if (typeof state.cash === 'number') state.cash -= fine;
    const at = hospital();
    p.x = at.x; p.y = at.y;
    p.health = typeof p.maxHealth === 'number' ? p.maxHealth : 100;
    p.armor = 0;
    if (state.combat) { state.combat.health = p.health; state.combat.armor = 0; }
    p.dead = false;
    clearWanted();
    for (const c of state.police) c.dead = true;
    if (state.events) state.events.push({ type: 'wasted', fine, t: clock });
    if (state.audio && typeof state.audio.stinger === 'function') state.audio.stinger('fail');
  }

  // ---- Update / draw ---------------------------------------------------------
  // Busted saat mengemudi (aturan integrator): mobil dikepung 2+ mobil
  // polisi dalam radius 80 px selama 3 detik -> busted.
  let surroundTimer = 0;
  function update(dt) {
    clock += dt;
    if (!state.police) state.police = [];
    if (typeof state.wanted !== 'number') state.wanted = 0;

    maintainForce(dt);
    decayWanted(dt);

    for (const cop of state.police) {
      if (cop.dead) continue;
      if (cop.kind === 'foot') updateFootCop(cop, dt);
      else if (cop.kind === 'car') updateCarCop(cop, dt);
    }
    state.police = state.police.filter((c) => !c.dead);

    // Dikepung saat mengemudi: 2+ mobil polisi menempel 3 detik -> busted.
    // Radius 120 px: mobil polisi mengejar titik 90 px di depan pemain,
    // jadi mereka mengorbit di ~90 px — radius harus di atas itu.
    const p = player();
    if (p && !p.dead && playerCar() && wanted() > 0) {
      let near = 0;
      let nearest = null;
      for (const cop of state.police) {
        if (cop.dead || cop.kind !== 'car') continue;
        if (Math.hypot(cop.x - p.x, cop.y - p.y) < 120) {
          near += 1;
          if (!nearest) nearest = cop;
        }
      }
      if (near >= 2) {
        surroundTimer += dt;
        if (surroundTimer >= 3) {
          surroundTimer = 0;
          bustPlayer(nearest);
        }
      } else {
        surroundTimer = 0;
      }
    } else {
      surroundTimer = 0;
    }

    // Siren wail while any cop is active (guard: audio may be absent).
    sirenTimer -= dt;
    if (state.police.length > 0 && state.audio && typeof state.audio.siren === 'function') {
      if (sirenTimer <= 0) {
        sirenTimer = 1.2;
        const p = player();
        const d = p ? Math.hypot(state.police[0].x - p.x, state.police[0].y - p.y) : 600;
        state.audio.siren(Math.max(0, 1 - d / 900));
      }
    }
  }

  function drawCop(ctx, cop) {
    ctx.save();
    ctx.translate(cop.x, cop.y);
    if (cop.kind === 'foot') {
      ctx.rotate(cop.angle);
      // Shadow.
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(1, 2, 12, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      // Navy uniform body.
      ctx.fillStyle = '#1d2f4d';
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fill();
      // Badge + cap.
      ctx.fillStyle = '#f2c14e';
      ctx.beginPath();
      ctx.arc(7, -4, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#16233a';
      ctx.fillRect(2, -11, 12, 5);
      // Facing direction tick.
      ctx.strokeStyle = '#dfe8ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(15, 0);
      ctx.stroke();
    } else {
      // Car cops are drawn by the vehicles module (their cruiser); draw a
      // flashing light bar above the car so the player spots them.
      const phase = Math.floor(clock * 6) % 2 === 0;
      ctx.fillStyle = phase ? '#ff2e2e' : '#2e6bff';
      ctx.beginPath();
      ctx.arc(0, -20, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,46,46,0.18)';
      ctx.beginPath();
      ctx.arc(0, 0, 34, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Konvensi draw main.js: dipanggil tanpa argumen SETELAH main
  // menerapkan transform kamera — ctx datang dari state.renderer.ctx dan
  // TIDAK ada translate tambahan di sini.
  function draw() {
    const r = state.renderer;
    if (!r || !r.ctx || !state.police) return;
    const ctx = r.ctx;
    for (const cop of state.police) {
      if (cop.dead) continue;
      drawCop(ctx, cop);
    }
  }

  // ---- Init ------------------------------------------------------------------
  if (!state.police) state.police = [];
  if (typeof state.wanted !== 'number') state.wanted = 0;
  // Expose the crime hook so vehicles / combat can raise wanted without
  // importing this module.
  if (typeof state.addWanted !== 'function') state.addWanted = addWanted;

  return {
    update,
    draw,
    addWanted,
    setWanted,
    clearWanted,
    bustPlayer,
    respawnAfterWasted,
    policeStation,
    hospital,
  };
}
