// vehicles.js — Neon Bay vehicle system (top-down).
// Factory: createVehicles(state). Owns state.vehicles and state.player.vehicle.
// No imports: every value comes in through `state`, all randomness via
// state.rng (the seeded rng object { next, range, int, pick, chance }).
// Guards everywhere so the module still runs when world / player / input
// are not wired yet.

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
  let s = (typeof seed === 'number' ? seed : 0x9e3779b9) >>> 0;
  if (s === 0) s = 0x9e3779b9;
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

export function createVehicles(state) {
  // Normaliser rng (sama seperti world.js): terima objek rng seeded,
  // fungsi polos, atau tidak ada (fallback mulberry32 lokal dari seed).
  const rng = asRng(state.rng, state.seed);
  const pick = (arr) => arr[Math.floor(rng.next() * arr.length) % arr.length];

  // Mobil yang dikendarai pemain tinggal di state.player.vehicle
  // (kontrak state); state.playerCar dipertahankan sebagai alias sinkron
  // untuk pembaca lama.
  function playerCar() {
    const p = state.player;
    return (p && p.vehicle) || state.playerCar || null;
  }
  function setPlayerCar(car) {
    const p = state.player;
    if (p) p.vehicle = car || null;
    state.playerCar = car || null;
  }

  // ---- Vehicle type table: speed in px/s, handling = turn rate factor,
  // toughness = max damage it can take before exploding.
  const TYPES = {
    taxi:    { name: 'Taxi',    len: 52, wid: 26, top: 240, accel: 190, turn: 2.6, grip: 3.2, hp: 70,  color: '#f2b705', roof: '#f7d154', seats: 4 },
    sedan:   { name: 'Sedan',   len: 50, wid: 24, top: 300, accel: 230, turn: 3.0, grip: 3.6, hp: 90,  color: '#3e6fb0', roof: '#5b8cc9', seats: 4 },
    sports:  { name: 'Sports',  len: 48, wid: 24, top: 420, accel: 330, turn: 3.6, grip: 4.4, hp: 60,  color: '#c62f3b', roof: '#e0525e', seats: 2 },
    truck:   { name: 'Truck',   len: 66, wid: 28, top: 210, accel: 150, turn: 2.1, grip: 2.6, hp: 170, color: '#7a6a4f', roof: '#96855f', seats: 2 },
    cruiser: { name: 'Cruiser', len: 52, wid: 26, top: 360, accel: 280, turn: 3.3, grip: 4.0, hp: 120, color: '#1c2733', roof: '#24344a', seats: 4 },
  };

  const PARKED_TYPES = ['taxi', 'sedan', 'sedan', 'sports', 'truck'];
  const TRAFFIC_TYPES = ['taxi', 'sedan', 'sedan', 'sports', 'truck', 'taxi'];

  function world() { return state.world || null; }
  function player() { return state.player || null; }
  function input() { return state.input || null; }
  // Module-local clock: the engine may never fill state.time, so timers
  // (wreck cleanup, smoke drift, event stamps) run off our own clock.
  let clock = 0;
  function now() { return typeof state.time === 'number' ? state.time : clock; }

  function makeCar(type, x, y, angle) {
    const t = TYPES[type] || TYPES.sedan;
    return {
      id: 'car-' + Math.floor(rng.next() * 1e9).toString(36) + '-' + (state.vehicles ? state.vehicles.length : 0),
      type, x, y, angle: angle || 0,
      speed: 0, steer: 0,
      damage: 0, maxHp: t.hp,
      driver: null,           // 'traffic' | 'police' | null (parked / empty)
      parked: false,
      traffic: false,         // true while it is an ambient traffic car
      wrecked: false, exploded: false,
      smoke: 0,               // 0..1 smoke intensity
      brakeLight: false,
      horn: 0,
      enterTimer: 0,
      dead: false,
    };
  }

  // ---- Spawning -------------------------------------------------------------
  function scatterParked(count) {
    const w = world();
    if (!w || !Array.isArray(w.parkedSpots) || !w.parkedSpots.length) return;
    for (let i = 0; i < count; i++) {
      const spot = pick(w.parkedSpots);
      const car = makeCar(pick(PARKED_TYPES), spot.x, spot.y, spot.angle || 0);
      car.parked = true;
      state.vehicles.push(car);
    }
  }

  function spawnTrafficCar() {
    const w = world();
    if (!w || !Array.isArray(w.roadSpawns) || !w.roadSpawns.length) return null;
    const spot = pick(w.roadSpawns);
    const car = makeCar(pick(TRAFFIC_TYPES), spot.x, spot.y, spot.angle || 0);
    car.driver = 'traffic';
    car.traffic = true;
    car.speed = (TYPES[car.type].top * 0.35) * (0.8 + rng.next() * 0.4);
    state.vehicles.push(car);
    return car;
  }

  function spawnCruiser(x, y, angle) {
    const car = makeCar('cruiser', x, y, angle || 0);
    car.driver = 'police';
    state.vehicles.push(car);
    return car;
  }

  // ---- Collision helpers ----------------------------------------------------
  function collidesWithBuildings(x, y, halfLen, halfWid, angle) {
    const w = world();
    if (!w || !Array.isArray(w.solids)) return false;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    for (const s of w.solids) {
      // Expand the solid by the car's rotated bounding radius; cheap AABB
      // test in the car's local frame.
      const dx = x - (s.x + s.w / 2), dy = y - (s.y + s.h / 2);
      const lx = Math.abs(dx * cos + dy * sin);
      const ly = Math.abs(-dx * sin + dy * cos);
      if (lx < s.w / 2 + halfLen && ly < s.h / 2 + halfWid) return true;
    }
    return false;
  }

  function clampToWorld(x, y) {
    const w = world();
    if (!w || !w.width || !w.height) return { x, y };
    return {
      x: Math.max(20, Math.min(w.width - 20, x)),
      y: Math.max(20, Math.min(w.height - 20, y)),
    };
  }

  // ---- Damage / explosion ---------------------------------------------------
  function damageCar(car, amount, cause) {
    if (car.exploded || car.wrecked) return;
    car.damage += amount;
    if (car.damage >= car.maxHp * 0.6) car.smoke = Math.min(1, car.damage / car.maxHp);
    if (car.damage >= car.maxHp) {
      car.wrecked = true;
      car.exploded = true;
      car.speed = 0;
      if (playerCar() === car) ejectPlayer();
      if (state.audio && typeof state.audio.explosion === 'function') state.audio.explosion(car.x, car.y);
      if (state.events) state.events.push({ type: 'explosion', x: car.x, y: car.y, t: now() });
      if (cause === 'player' && state.wanted !== undefined && state.addWanted) state.addWanted(1);
    }
  }

  function ejectPlayer() {
    const p = player();
    if (!p) return;
    const car = playerCar();
    if (car) {
      const side = Math.PI / 2;
      p.x = car.x + Math.cos(car.angle + side) * 34;
      p.y = car.y + Math.sin(car.angle + side) * 34;
    }
    setPlayerCar(null);
    if (p) p.inCar = false;
  }

  // ---- Entering / exiting / stealing ---------------------------------------
  // Mobil traffic (traffic.js) tinggal di state.traffic, bukan
  // state.vehicles — pemindaian harus mencakup keduanya, kalau tidak
  // mobil yang sedang berjalan tidak pernah bisa dicuri.
  function isTrafficCar(car) {
    return Array.isArray(state.traffic) && state.traffic.indexOf(car) !== -1;
  }

  function isOccupied(car) {
    return car.driver === 'traffic' || car.driver === 'police' || isTrafficCar(car);
  }

  function nearestCar(maxDist) {
    const p = player();
    if (!p) return null;
    let best = null, bestD = maxDist;
    const scan = (list) => {
      if (!Array.isArray(list)) return;
      for (const car of list) {
        if (!car || car.exploded || car.dead) continue;
        const d = Math.hypot(car.x - p.x, car.y - p.y);
        if (d < bestD) { bestD = d; best = car; }
      }
    };
    scan(state.vehicles);
    scan(state.traffic);
    return best;
  }

  function tryEnter() {
    const p = player();
    if (!p || playerCar() || p.enterCooldown > 0) return;
    const car = nearestCar(56);
    if (!car) return;
    if (isOccupied(car)) return; // occupied: use F to steal
    p.enterCooldown = 0.35;
    car.enterTimer = 0.25;
    setPlayerCar(car);
    car.parked = false;
    car.traffic = false;
    p.inCar = true;
    if (state.audio && typeof state.audio.door === 'function') state.audio.door();
  }

  // Pindahkan mobil traffic yang dicuri ke state.vehicles: lengkapi
  // field kontrak vehicles.js (damage/maxHp/dll — mobil traffic tidak
  // punya itu) dan keluarkan dari state.traffic supaya traffic.js
  // berhenti menggerakkannya.
  function adoptTrafficCar(car) {
    if (Array.isArray(state.traffic)) {
      const i = state.traffic.indexOf(car);
      if (i !== -1) state.traffic.splice(i, 1);
    }
    const t = TYPES[car.type] || TYPES.sedan;
    if (typeof car.damage !== 'number') car.damage = 0;
    if (typeof car.maxHp !== 'number') car.maxHp = t.hp;
    if (typeof car.steer !== 'number') car.steer = 0;
    if (typeof car.enterTimer !== 'number') car.enterTimer = 0;
    if (typeof car.smoke !== 'number') car.smoke = 0;
    if (typeof car.brakeLight !== 'boolean') car.brakeLight = false;
    if (typeof car.horn !== 'number') car.horn = 0;
    if (!car.id) car.id = 'car-' + Math.floor(rng.next() * 1e9).toString(36);
    car.parked = false;
    car.traffic = false;
    car.wrecked = false;
    car.exploded = false;
    car.dead = false;
    if (!Array.isArray(state.vehicles)) state.vehicles = [];
    if (state.vehicles.indexOf(car) === -1) state.vehicles.push(car);
  }

  // Fallback bila modul peds tidak menyediakan ejectDriver: buat pejalan
  // kaki minimal di trotoar terdekat langsung di state.peds.
  function ejectDriverFallback(car) {
    if (!Array.isArray(state.peds)) return null;
    const w = world();
    let street = null;
    if (w && typeof w.nearestRoadPoint === 'function') {
      const near = w.nearestRoadPoint(car.x, car.y);
      if (near && near.street) street = near.street;
    }
    if (!street) return null;
    const ped = {
      x: car.x, y: car.y, street,
      side: street.axis === 'v' ? (car.x >= street.at ? 1 : -1) : (car.y >= street.at ? 1 : -1),
      dir: 1,
      along: street.axis === 'v' ? car.y : car.x,
      walkSpeed: 80, speed: 0, angle: 0,
      skin: '#e8b98d', shirt: '#d94f3d', pants: '#2e3440', hat: false,
      phase: 0, state: 'flee', stateTimer: 0,
      crossFrom: null, crossTo: null, crossT: 0,
      fleeX: car.x, fleeY: car.y, fleeTimer: 3.5,
    };
    state.peds.push(ped);
    return ped;
  }

  function trySteal() {
    const p = player();
    if (!p || playerCar() || p.enterCooldown > 0) return;
    const car = nearestCar(56);
    if (!car) return;
    p.enterCooldown = 0.5;
    if (isOccupied(car)) {
      // Yank the driver out. The driver becomes a pedestrian.
      const driver = car.driver || 'traffic';
      if (state.pedestrians && typeof state.pedestrians.ejectDriver === 'function') {
        state.pedestrians.ejectDriver(car);
      } else {
        ejectDriverFallback(car);
      }
      car.driver = null;
      car.traffic = false;
      // Mobil traffic yang dicuri pindah ke state.vehicles supaya bisa
      // dikemudikan pemain (bukan lagi digerakkan traffic.js).
      if (isTrafficCar(car)) adoptTrafficCar(car);
      if (state.addWanted) state.addWanted(1); // stealing an occupied car is a crime
      if (state.events) state.events.push({ type: 'carjack', x: car.x, y: car.y, t: now(), driver });
      if (state.audio && typeof state.audio.carjack === 'function') state.audio.carjack();
    } else {
      // Hotwire a parked car: takes a moment, then it is yours.
      car.enterTimer = 0.6;
      if (state.audio && typeof state.audio.hotwire === 'function') state.audio.hotwire();
    }
    setPlayerCar(car);
    car.parked = false;
    p.inCar = true;
  }

  function exitCar() {
    const p = player();
    if (!p || !playerCar()) return;
    p.enterCooldown = 0.35;
    ejectPlayer();
    if (state.audio && typeof state.audio.door === 'function') state.audio.door();
  }

  // ---- Driving physics ------------------------------------------------------
  function drive(car, dt) {
    const inp = input();
    const t = TYPES[car.type];
    const fwd = inp ? (inp.up ? 1 : inp.down ? -0.55 : 0) : 0;
    const steerIn = inp ? ((inp.left ? -1 : 0) + (inp.right ? 1 : 0)) : 0;
    const handbrake = inp ? !!inp.handbrake : false;

    // Acceleration / braking.
    if (fwd > 0) car.speed += t.accel * fwd * dt;
    else if (fwd < 0) car.speed += t.accel * fwd * dt * 0.8;
    else car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 140 * dt);

    // Drag + handbrake.
    const drag = handbrake ? 420 : 40;
    car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), drag * dt);
    if (handbrake) car.speed *= Math.max(0, 1 - 2.2 * dt);

    // Clamp to top speed (reverse capped lower).
    const top = car.speed >= 0 ? t.top : t.top * 0.45;
    car.speed = Math.max(-top, Math.min(top, car.speed));

    // Steering scales with speed; handbrake lets the tail slide.
    const speedFactor = Math.min(1, Math.abs(car.speed) / 120);
    const grip = handbrake ? t.grip * 0.35 : t.grip;
    car.steer += (steerIn * t.turn * speedFactor - car.steer) * Math.min(1, grip * dt);
    car.angle += car.steer * dt * Math.sign(car.speed || 1);

    // Move.
    const nx = car.x + Math.cos(car.angle) * car.speed * dt;
    const ny = car.y + Math.sin(car.angle) * car.speed * dt;
    const halfL = t.len / 2, halfW = t.wid / 2;

    if (collidesWithBuildings(nx, ny, halfL, halfW, car.angle)) {
      // Crash: lose speed, take damage, bounce back a little.
      const impact = Math.abs(car.speed);
      if (impact > 90) {
        damageCar(car, impact * 0.12, 'player');
        if (state.audio && typeof state.audio.crash === 'function') state.audio.crash(impact);
        if (state.events) state.events.push({ type: 'crash', x: car.x, y: car.y, t: now(), impact });
      }
      car.speed *= -0.25;
    } else {
      const clamped = clampToWorld(nx, ny);
      car.x = clamped.x;
      car.y = clamped.y;
    }

    car.brakeLight = !!(inp && (inp.down || handbrake));
  }

  function trafficDrive(car, dt) {
    const t = TYPES[car.type];
    // Ambient traffic cruises straight along its lane; the world builder
    // gives roadSpawns an angle, and traffic follows it until it hits a
    // building, then turns around rather than getting stuck.
    car.speed += (t.top * 0.32 - car.speed) * Math.min(1, dt);
    const nx = car.x + Math.cos(car.angle) * car.speed * dt;
    const ny = car.y + Math.sin(car.angle) * car.speed * dt;
    if (collidesWithBuildings(nx, ny, t.len / 2, t.wid / 2, car.angle)) {
      car.angle += Math.PI; // U-turn
      car.speed *= 0.4;
    } else {
      const clamped = clampToWorld(nx, ny);
      car.x = clamped.x;
      car.y = clamped.y;
      // Turn around at the map edge instead of piling up on the border.
      if (clamped.x !== nx || clamped.y !== ny) car.angle += Math.PI;
    }
  }

  function carVsCar(a, b) {
    const tA = TYPES[a.type], tB = TYPES[b.type];
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    const minDist = (tA.len + tB.len) / 2 * 0.72;
    if (dist >= minDist) return;
    // Push apart along the line between them.
    const push = (minDist - dist) / 2;
    const ux = dx / dist, uy = dy / dist;
    a.x -= ux * push; a.y -= uy * push;
    b.x += ux * push; b.y += uy * push;
    const rel = Math.abs(a.speed - b.speed) + 30;
    if (rel > 70) {
      // Tabrakan hanya melukai tiap 0,4 detik per mobil: tanpa jeda ini,
      // dua mobil yang bersentuhan terus-menerus melelehkan satu sama
      // lain dalam sepersekian detik (kerusakan per frame).
      const t = clock;
      const aReady = (t - (a.lastHitAt || -99)) > 0.4;
      const bReady = (t - (b.lastHitAt || -99)) > 0.4;
      if (aReady) {
        damageCar(a, rel * 0.08, a === playerCar() ? 'player' : 'traffic');
        a.lastHitAt = t;
      }
      if (bReady) {
        damageCar(b, rel * 0.08, b === playerCar() ? 'player' : 'traffic');
        b.lastHitAt = t;
      }
      a.speed *= 0.55; b.speed *= 0.55;
      if (state.audio && typeof state.audio.crash === 'function') state.audio.crash(rel);
    } else {
      a.speed *= 0.8; b.speed *= 0.8;
    }
  }

  // Mobil pemain vs mobil traffic: dorong berpisah + damage +
  // perlambatan traffic. Mobil traffic terkunci di jalurnya (posisinya
  // dihitung ulang traffic.js dari `along`), jadi dorongan lateral
  // jatuh ke mobil pemain, sementara traffic mundur sedikit lewat
  // `along` dan melambat. Damage dijeda 0,4 detik seperti carVsCar.
  function playerCarVsTraffic(pc, tc) {
    const tP = TYPES[pc.type];
    const lenT = (tc.len || (TYPES[tc.type] ? TYPES[tc.type].len : 50));
    const dx = tc.x - pc.x, dy = tc.y - pc.y;
    const dist = Math.hypot(dx, dy) || 1;
    const minDist = (tP.len + lenT) / 2 * 0.72;
    if (dist >= minDist) return;
    const push = minDist - dist;
    const ux = dx / dist, uy = dy / dist;
    pc.x -= ux * push * 0.8;
    pc.y -= uy * push * 0.8;
    if (typeof tc.along === 'number' && tc.dir) tc.along -= tc.dir * push * 0.2;
    const rel = Math.abs(pc.speed - (tc.speed || 0)) + 30;
    if (rel > 70) {
      const t = clock;
      if ((t - (pc.lastHitAt || -99)) > 0.4) {
        damageCar(pc, rel * 0.08, 'player');
        pc.lastHitAt = t;
        if (typeof tc.damage !== 'number') tc.damage = 0;
        tc.damage += rel * 0.05;
        if (state.audio && typeof state.audio.crash === 'function') state.audio.crash(rel);
      }
    }
    pc.speed *= 0.55;
    if (typeof tc.speed === 'number') tc.speed *= 0.55;
  }

  // ---- Update ----------------------------------------------------------------
  function update(dt) {
    clock += dt;
    if (!state.vehicles) state.vehicles = [];
    const p = player();
    if (p && p.enterCooldown > 0) p.enterCooldown -= dt;
    // Jaga alias state.playerCar tetap sinkron dengan player.vehicle.
    if (p) state.playerCar = p.vehicle || null;

    const inp = input();
    if (inp && p && !p.dead) {
      if (inp.enterPressed) tryEnter();
      if (inp.stealPressed) trySteal();
      if (inp.exitPressed && playerCar()) exitCar();
    }

    // Parked-car hotwire timer: the car becomes fully yours when it ends.
    for (const car of state.vehicles) {
      if (car.enterTimer > 0) car.enterTimer -= dt;
      if (car.smoke > 0 && !car.exploded) car.smoke = Math.max(0, car.smoke - dt * 0.05);
    }

    // Keep a few traffic cars around the player.
    if (state.vehicles.length < 10 && rng.next() < dt * 0.5) spawnTrafficCar();

    for (const car of state.vehicles) {
      if (car.exploded || car.dead) continue;
      if (car === playerCar()) {
        drive(car, dt);
        if (p) { p.x = car.x; p.y = car.y; p.angle = car.angle; }
      } else if (car.traffic) {
        trafficDrive(car, dt);
      }
    }

    // Car-vs-car collisions (skip pairs that are far apart).
    const list = state.vehicles;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.exploded || b.exploded) continue;
        if (Math.abs(a.x - b.x) > 90 || Math.abs(a.y - b.y) > 90) continue;
        carVsCar(a, b);
      }
    }

    // Tabrakan mobil pemain vs mobil traffic (state.traffic): sebelumnya
    // tidak ada sama sekali — mobil pemain menembus mobil lalu lintas.
    const pc = playerCar();
    if (pc && !pc.exploded && Array.isArray(state.traffic)) {
      for (const tc of state.traffic) {
        if (!tc || tc.dead || tc.exploded) continue;
        if (Math.abs(pc.x - tc.x) > 90 || Math.abs(pc.y - tc.y) > 90) continue;
        playerCarVsTraffic(pc, tc);
      }
    }

    // Remove exploded wrecks after a while so the street clears.
    state.vehicles = state.vehicles.filter((c) => !c.dead);
    for (const car of state.vehicles) {
      if (car.exploded && !car.removeAt) car.removeAt = clock + 25;
      if (car.removeAt && clock > car.removeAt) car.dead = true;
    }

    // Engine hum follows the player's speed.
    if (state.audio && typeof state.audio.engine === 'function' && playerCar()) {
      state.audio.engine(Math.abs(playerCar().speed) / TYPES[playerCar().type].top);
    }
  }

  // ---- Drawing ---------------------------------------------------------------
  function drawCar(ctx, car) {
    const t = TYPES[car.type];
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);

    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(2, 4, t.len / 2 + 2, t.wid / 2 + 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body.
    ctx.fillStyle = car.exploded ? '#2b2b2b' : t.color;
    roundRect(ctx, -t.len / 2, -t.wid / 2, t.len, t.wid, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Roof / cabin.
    ctx.fillStyle = car.exploded ? '#1c1c1c' : t.roof;
    roundRect(ctx, -t.len / 2 + 10, -t.wid / 2 + 4, t.len - 22, t.wid - 8, 5);
    ctx.fill();

    // Windshield + rear window.
    ctx.fillStyle = 'rgba(20,30,44,0.85)';
    ctx.fillRect(t.len / 2 - 14, -t.wid / 2 + 5, 4, t.wid - 10);
    ctx.fillRect(-t.len / 2 + 11, -t.wid / 2 + 5, 3, t.wid - 10);

    // Taxi checker stripe / police livery.
    if (car.type === 'taxi') {
      ctx.fillStyle = '#111';
      for (let i = 0; i < 5; i++) ctx.fillRect(-t.len / 2 + 6 + i * 8, -2, 4, 4);
      ctx.fillStyle = '#ffe14d';
      ctx.fillRect(-6, -t.wid / 2 - 2, 12, 4);
    }
    if (car.type === 'cruiser') {
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(-t.len / 2 + 4, -t.wid / 2 + 2, t.len - 8, 5);
      ctx.fillRect(-t.len / 2 + 4, t.wid / 2 - 7, t.len - 8, 5);
      // Light bar.
      ctx.fillStyle = '#ff2e2e';
      ctx.fillRect(-4, -t.wid / 2 + 2, 4, 5);
      ctx.fillStyle = '#2e6bff';
      ctx.fillRect(0, -t.wid / 2 + 2, 4, 5);
    }

    // Headlights + taillights.
    ctx.fillStyle = '#fff6b0';
    ctx.fillRect(t.len / 2 - 2, -t.wid / 2 + 3, 2, 5);
    ctx.fillRect(t.len / 2 - 2, t.wid / 2 - 8, 2, 5);
    ctx.fillStyle = car.brakeLight ? '#ff2222' : '#a31616';
    ctx.fillRect(-t.len / 2, -t.wid / 2 + 3, 2, 5);
    ctx.fillRect(-t.len / 2, t.wid / 2 - 8, 2, 5);

    // Damage cracks / smoke.
    if (car.damage > car.maxHp * 0.35) {
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-t.len / 4, -t.wid / 2 + 4);
      ctx.lineTo(-t.len / 4 + 6, 0);
      ctx.lineTo(-t.len / 4 + 2, t.wid / 2 - 4);
      ctx.stroke();
    }
    ctx.restore();

    // Smoke puffs rise from a damaged car (world space, not rotated).
    if (car.smoke > 0 && !car.exploded) {
      const puffs = Math.floor(car.smoke * 3);
      for (let i = 0; i < puffs; i++) {
        const off = ((now() * 30 + i * 37) % 40) / 40;
        ctx.fillStyle = 'rgba(120,120,120,' + (0.5 * (1 - off)).toFixed(2) + ')';
        ctx.beginPath();
        ctx.arc(car.x - t.len / 4 + i * 6, car.y - 6 - off * 22, 4 + off * 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (car.exploded) {
      ctx.fillStyle = 'rgba(30,30,30,0.85)';
      ctx.beginPath();
      ctx.arc(car.x, car.y, t.len / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,120,20,0.5)';
      ctx.beginPath();
      ctx.arc(car.x, car.y, t.len / 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Konvensi draw main.js: dipanggil tanpa argumen SETELAH main
  // menerapkan transform kamera — ctx datang dari state.renderer.ctx dan
  // TIDAK ada translate tambahan di sini.
  function draw() {
    const r = state.renderer;
    if (!r || !r.ctx || !state.vehicles) return;
    const ctx = r.ctx;
    for (const car of state.vehicles) {
      if (car.dead) continue;
      drawCar(ctx, car);
    }
  }

  // ---- Init: scatter parked cars once ---------------------------------------
  if (!state.vehicles) state.vehicles = [];
  if (!state.playerCar) state.playerCar = (state.player && state.player.vehicle) || null;
  if (state.vehicles.length === 0) scatterParked(14);

  return {
    update,
    draw,
    types: TYPES,
    spawnTrafficCar,
    spawnCruiser,
    damageCar,
    tryEnter,
    trySteal,
    exitCar,
    nearestCar,
  };
}
