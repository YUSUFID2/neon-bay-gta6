// Neon Bay — ambient traffic.
//
// createTraffic(state) owns state.traffic: the cars cruising the streets.
// Each car lives on one street in one lane, driving on the right-hand side:
// southbound on the west lane of a north-south street, eastbound on the
// south lane of an east-west street. Cars slow down for the car ahead,
// wait at an intersection while another car is crossing it, and sometimes
// turn at an intersection. A car that reaches the end of its street is
// respawned on another road, far from the player, so the city always feels
// busy without cars popping in on top of the action.
//
// Self-contained: no sibling imports, all data from `state` (world streets,
// rng, player, vehicles). All randomness comes from state.rng.

const CAR_TYPES = {
  taxi:   { len: 52, wid: 26, top: 165, accel: 120, color: '#f2b705', roof: '#f7d154' },
  sedan:  { len: 50, wid: 24, top: 205, accel: 150, color: '#3e6fb0', roof: '#5b8cc9' },
  sports: { len: 48, wid: 24, top: 275, accel: 210, color: '#c62f3b', roof: '#e0525e' },
  truck:  { len: 68, wid: 28, top: 135, accel: 95,  color: '#7a6a4f', roof: '#96855f' },
};

const TYPE_KEYS = ['taxi', 'sedan', 'sedan', 'sports', 'truck', 'sedan'];
const TRAFFIC_COUNT = 26;
const STOP_GAP = 96;
const SLOW_GAP = 170;

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

// Same rng normaliser as the world module: accept the rng object
// ({ next, range, int, pick, chance }), a plain function, or nothing.
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

// Angle a car faces when driving `dir` (+1 / -1) along `street`.
function angleFor(street, dir) {
  if (street.axis === 'v') return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  return dir > 0 ? 0 : Math.PI;
}

// Right-hand lane for a direction: southbound keeps the west lane,
// eastbound keeps the south lane.
function laneFor(street, dir) {
  if (street.axis === 'v') return dir > 0 ? -1 : 1;
  return dir > 0 ? 1 : -1;
}

export function createTraffic(state) {
  const rng = asRng(state.rng, state.seed);
  const world = state.world || null;
  const streets = (world && Array.isArray(world.streets)) ? world.streets : [];
  const vStreets = streets.filter((s) => s.axis === 'v');
  const hStreets = streets.filter((s) => s.axis === 'h');
  const cars = [];
  state.traffic = cars;

  // Crossings per street: the `at` positions of the streets crossing it.
  function crossingsOf(street) {
    const others = street.axis === 'v' ? hStreets : vStreets;
    const list = [];
    for (const o of others) {
      if (o.at >= street.from && o.at <= street.to) list.push({ at: o.at, street: o });
    }
    list.sort((a, b) => a.at - b.at);
    return list;
  }
  const crossingMap = new Map();
  for (const s of streets) crossingMap.set(s, crossingsOf(s));

  function streetLength(street) {
    return street.axis === 'v' ? street.to - street.from : street.to - street.from;
  }

  function carXY(car) {
    const s = car.street;
    const off = car.lane * s.width / 4;
    if (s.axis === 'v') return { x: s.at + off, y: car.along };
    return { x: car.along, y: s.at + off };
  }

  function makeCar(spawn) {
    const type = rng.pick(TYPE_KEYS);
    const t = CAR_TYPES[type];
    const car = {
      type,
      len: t.len,
      wid: t.wid,
      color: t.color,
      roof: t.roof,
      street: null,
      along: 0,
      lane: 1,
      dir: 1,
      angle: 0,
      speed: 0,
      targetSpeed: t.top * rng.range(0.75, 1),
      topSpeed: t.top,
      accel: t.accel,
      brakeLight: false,
      turnCooldown: 0,
      x: 0,
      y: 0,
    };
    placeCar(car, spawn);
    return car;
  }

  // Put a car on a road spawn (or a random street if none is given).
  function placeCar(car, spawn) {
    let street = null;
    let along = 0;
    let dir = 1;
    if (spawn) {
      if (spawn.angle === Math.PI / 2 || spawn.angle === -Math.PI / 2) {
        dir = spawn.angle > 0 ? 1 : -1;
        street = vStreets.find((s) => Math.abs(s.at - spawn.x) <= s.width) || null;
        along = spawn.y;
      } else {
        dir = spawn.angle === 0 ? 1 : -1;
        street = hStreets.find((s) => Math.abs(s.at - spawn.y) <= s.width) || null;
        along = spawn.x;
      }
    }
    if (!street) {
      street = rng.pick(streets);
      dir = rng.chance(0.5) ? 1 : -1;
      along = rng.range(120, streetLength(street) - 120);
    }
    car.street = street;
    car.dir = dir;
    car.lane = laneFor(street, dir);
    car.along = clamp(along, 40, streetLength(street) - 40);
    // Never spawn on top of another car in the same lane: shift along the
    // street until the lane is clear (or give up after a few tries).
    let tries = 0;
    while (tries < 6 && cars.some((other) => other !== car
      && other.street === car.street && other.lane === car.lane
      && Math.abs(other.along - car.along) < 170)) {
      tries += 1;
      car.along += 260;
      const len = streetLength(car.street);
      if (car.along > len - 40) car.along = 40 + (car.along - (len - 40));
    }
    car.angle = angleFor(street, dir);
    car.speed = car.targetSpeed * rng.range(0.4, 0.8);
    car.turnCooldown = rng.range(0.5, 2);
    const pos = carXY(car);
    car.x = pos.x;
    car.y = pos.y;
  }

  function pickSpawnFarFromPlayer() {
    const spawns = (world && Array.isArray(world.roadSpawns)) ? world.roadSpawns : [];
    const p = state.player;
    if (!spawns.length || !p) return spawns.length ? rng.pick(spawns) : null;
    const far = spawns.filter((s) => {
      const dx = s.x - p.x;
      const dy = s.y - p.y;
      return dx * dx + dy * dy > 1000 * 1000;
    });
    return rng.pick(far.length ? far : spawns);
  }

  function spawnAll() {
    cars.length = 0;
    for (let i = 0; i < TRAFFIC_COUNT; i += 1) {
      if (!streets.length) break;
      cars.push(makeCar(pickSpawnFarFromPlayer()));
    }
  }

  // ---- Following and intersections ----------------------------------------
  // Distance ahead (in `along` units) to the nearest car in the same lane,
  // or Infinity when the lane is clear.
  function gapAhead(car) {
    let best = Infinity;
    for (const other of cars) {
      if (other === car) continue;
      if (other.street !== car.street || other.lane !== car.lane) continue;
      const d = (other.along - car.along) * car.dir;
      if (d > 0 && d < best) best = d;
    }
    return best;
  }

  // Is any car inside the intersection box around (cx, cy)?
  function intersectionBusy(cx, cy, half) {
    for (const other of cars) {
      if (Math.abs(other.x - cx) < half && Math.abs(other.y - cy) < half) return true;
    }
    return false;
  }

  // Is a player-driven or parked vehicle sitting in my path?
  function vehicleAhead(car, dirX, dirY) {
    const list = state.vehicles;
    if (!Array.isArray(list)) return false;
    for (const v of list) {
      if (!v || v.dead || v.exploded) continue;
      const dx = v.x - car.x;
      const dy = v.y - car.y;
      const forward = dx * dirX + dy * dirY;
      if (forward < 0 || forward > 120) continue;
      const lateral = Math.abs(-dx * dirY + dy * dirX);
      if (lateral < 30) return true;
    }
    return false;
  }

  function nextCrossing(car) {
    const list = crossingMap.get(car.street) || [];
    let best = null;
    let bestD = Infinity;
    for (const c of list) {
      const d = (c.at - car.along) * car.dir;
      if (d > 0 && d < bestD) { bestD = d; best = c; }
    }
    return best ? { crossing: best, dist: bestD } : null;
  }

  // At the middle of an intersection: mostly go straight, sometimes turn
  // left or right onto the crossing street. The car's new `along` on the
  // crossing street is the old street's axis position — that is exactly
  // where the two streets meet.
  function maybeTurn(car) {
    if (car.turnCooldown > 0) return;
    const list = crossingMap.get(car.street) || [];
    for (const c of list) {
      if (Math.abs(car.along - c.at) > 10) continue;
      if (!rng.chance(0.32)) return;
      const oldStreet = car.street;
      const newStreet = c.street;
      const newDir = rng.chance(0.5) ? 1 : -1;
      car.street = newStreet;
      car.dir = newDir;
      car.lane = laneFor(newStreet, newDir);
      car.along = oldStreet.at;
      car.angle = angleFor(newStreet, newDir);
      car.turnCooldown = 1.2;
      const pos = carXY(car);
      car.x = pos.x;
      car.y = pos.y;
      return;
    }
  }

  // Dorong pejalan kaki yang bersentuhan dengan mobil (bukan menembus):
  // pejalan kaki yang menyeberang atau kabur bisa berada di jalur mobil.
  // Dorongan keluar lewat sisi terdekat (lateral), bukan ke depan mobil,
  // lalu pejalan kaki kabur menjauh dari mobil.
  function pushPedOutOfCar(car, ped) {
    if (!ped || typeof ped.x !== 'number' || typeof ped.y !== 'number') return;
    const dx = ped.x - car.x;
    const dy = ped.y - car.y;
    const cos = Math.cos(car.angle);
    const sin = Math.sin(car.angle);
    // Koordinat lokal mobil: lx sepanjang mobil, ly melintang.
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    const halfL = car.len / 2 + 10;
    const halfW = car.wid / 2 + 10;
    if (Math.abs(lx) >= halfL || Math.abs(ly) >= halfW) return;
    const side = ly >= 0 ? 1 : -1;
    const dLy = side * halfW - ly;
    ped.x += -sin * dLy;
    ped.y += cos * dLy;
    // Kabur hanya bila mobil bergerak: mobil yang berhenti (macet,
    // menunggu di persimpangan) cukup mendorong pejalan kaki ke samping
    // tanpa membuatnya panik.
    if (car.speed > 20 && ped.state !== 'flee') {
      ped.state = 'flee';
      ped.fleeTimer = 1.5;
      ped.fleeX = car.x;
      ped.fleeY = car.y;
    }
  }

  function update(dt) {
    if (!streets.length) return;
    if (cars.length === 0) spawnAll();

    for (const car of cars) {
      car.turnCooldown = Math.max(0, car.turnCooldown - dt);

      // Desired speed: full speed, eased by whatever is ahead.
      let desired = car.targetSpeed;
      const gap = gapAhead(car);
      if (gap < STOP_GAP) desired = 0;
      else if (gap < SLOW_GAP) desired = Math.min(desired, car.targetSpeed * 0.35);

      const dirX = Math.cos(car.angle);
      const dirY = Math.sin(car.angle);
      if (vehicleAhead(car, dirX, dirY)) desired = 0;

      // Approaching an intersection: wait while another car is in it.
      const next = nextCrossing(car);
      if (next && next.dist < 150) {
        const cx = car.street.axis === 'v' ? car.street.at : next.crossing.at;
        const cy = car.street.axis === 'v' ? next.crossing.at : car.street.at;
        const half = Math.max(car.street.width, next.crossing.street.width) / 2 + 26;
        if (intersectionBusy(cx, cy, half)) {
          if (next.dist < 70) desired = 0;
          else desired = Math.min(desired, car.targetSpeed * 0.3);
        }
      }

      // Accelerate / brake towards the desired speed.
      const wasSpeed = car.speed;
      if (desired > car.speed) {
        car.speed = Math.min(desired, car.speed + car.accel * dt);
      } else {
        car.speed = Math.max(desired, car.speed - car.accel * 2.4 * dt);
      }
      car.brakeLight = car.speed < wasSpeed - 1 && car.speed > 1;

      car.along += car.dir * car.speed * dt;
      const pos = carXY(car);
      car.x = pos.x;
      car.y = pos.y;

      maybeTurn(car);

      // End of the road: respawn somewhere else, far from the player.
      const len = streetLength(car.street);
      if (car.along < -60 || car.along > len + 60) {
        placeCar(car, pickSpawnFarFromPlayer());
      }

      // Dorong pejalan kaki yang bersentuhan (bukan menembus).
      if (Array.isArray(state.peds)) {
        for (const ped of state.peds) pushPedOutOfCar(car, ped);
      }
    }
  }

  // ---- Draw -----------------------------------------------------------------
  function resolveView(ctxArg, cameraArg) {
    let ctx = ctxArg || null;
    if (!ctx && state.renderer && state.renderer.ctx) ctx = state.renderer.ctx;
    if (!ctx) return null;
    const cam = cameraArg || state.camera;
    let view = null;
    if (cam && typeof cam.width === 'number' && typeof cam.height === 'number') {
      view = { x: cam.x, y: cam.y, width: cam.width, height: cam.height };
    } else if (cam && typeof cam.zoom === 'number'
      && state.renderer && typeof state.renderer.getSize === 'function') {
      const s = state.renderer.getSize();
      view = {
        x: cam.x - s.viewW / 2 / cam.zoom,
        y: cam.y - s.viewH / 2 / cam.zoom,
        width: s.viewW / cam.zoom,
        height: s.viewH / cam.zoom,
      };
    } else if (cam && typeof cam.x === 'number' && typeof cam.y === 'number') {
      view = { x: cam.x, y: cam.y, width: 1280, height: 720 };
    } else {
      view = { x: 0, y: 0, width: 5120, height: 5120 };
    }
    return { ctx, view };
  }

  function drawCar(ctx, car) {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    const halfL = car.len / 2;
    const halfW = car.wid / 2;
    // Shadow.
    ctx.fillStyle = 'rgba(20, 24, 34, 0.3)';
    ctx.fillRect(-halfL + 3, -halfW + 4, car.len, car.wid);
    // Wheels.
    ctx.fillStyle = '#14161c';
    ctx.fillRect(-halfL + 6, -halfW - 3, 12, 6);
    ctx.fillRect(halfL - 18, -halfW - 3, 12, 6);
    ctx.fillRect(-halfL + 6, halfW - 3, 12, 6);
    ctx.fillRect(halfL - 18, halfW - 3, 12, 6);
    // Body.
    ctx.fillStyle = car.color;
    ctx.beginPath();
    ctx.roundRect(-halfL, -halfW, car.len, car.wid, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Roof + windows.
    ctx.fillStyle = car.roof;
    ctx.beginPath();
    ctx.roundRect(-halfL + 12, -halfW + 4, car.len - 26, car.wid - 8, 4);
    ctx.fill();
    ctx.fillStyle = '#1b2a3d';
    ctx.fillRect(halfL - 16, -halfW + 5, 7, car.wid - 10);
    ctx.fillRect(-halfL + 13, -halfW + 5, 6, car.wid - 10);
    // Headlights and brake lights.
    ctx.fillStyle = '#ffe9a3';
    ctx.fillRect(halfL - 2, -halfW + 3, 3, 5);
    ctx.fillRect(halfL - 2, halfW - 8, 3, 5);
    ctx.fillStyle = car.brakeLight ? '#ff2e2e' : '#7a1f1f';
    ctx.fillRect(-halfL - 1, -halfW + 3, 3, 5);
    ctx.fillRect(-halfL - 1, halfW - 8, 3, 5);
    // Taxi sign / truck bed.
    if (car.type === 'taxi') {
      ctx.fillStyle = '#f7d154';
      ctx.fillRect(-6, -halfW - 1, 12, 5);
      ctx.fillStyle = '#20242e';
      ctx.font = 'bold 5px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('TAXI', 0, -halfW + 1.5);
    } else if (car.type === 'truck') {
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      ctx.strokeRect(-halfL + 14, -halfW + 5, car.len - 40, car.wid - 10);
    }
    ctx.restore();
  }

  function draw(ctxArg, cameraArg) {
    const resolved = resolveView(ctxArg, cameraArg);
    if (!resolved) return;
    const { ctx, view } = resolved;
    for (const car of cars) {
      if (car.x < view.x - 80 || car.x > view.x + view.width + 80
        || car.y < view.y - 80 || car.y > view.y + view.height + 80) continue;
      drawCar(ctx, car);
    }
  }

  spawnAll();
  return { update, draw };
}
