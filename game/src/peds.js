// Neon Bay — pedestrians.
//
// createPeds(state) owns state.peds: the people walking the sidewalks.
// A ped walks along the sidewalk beside a street, in either direction.
// At an intersection it may cross the street on the crosswalk and keep
// walking on the other side; sometimes it turns a corner instead. When
// danger is near — gunfire (state.danger), an explosion, or a fast car
// bearing down — nearby peds run away from it for a few seconds, then
// calm down and carry on.
//
// Self-contained: no sibling imports, all data from `state` (world streets,
// rng, player, traffic, vehicles, danger). All randomness from state.rng.

const PED_COUNT = 34;
const WALK_MIN = 55;
const WALK_MAX = 115;
const RUN_SPEED = 260;
const FLEE_RADIUS = 260;
const FLEE_TIME = 3.5;
const SIDEWALK_OFF = 8;

const SKINS = ['#e8b98d', '#c98d5f', '#8d5a3b', '#f0c8a0', '#a06a42'];
const SHIRTS = [
  '#d94f3d', '#3d7dd9', '#3da35a', '#e8b13d', '#8a5fd9',
  '#e8e8e8', '#2e2e38', '#d97fb0', '#4fc3c3', '#c96a2e',
];
const PANTS = ['#2e3440', '#4a3b2e', '#3d4a63', '#5a5a5a', '#274156'];

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
  let s = (typeof seed === 'number' ? seed : 0x77c1a2) >>> 0;
  if (s === 0) s = 0x77c1a2;
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

export function createPeds(state) {
  const rng = asRng(state.rng, state.seed);
  const world = state.world || null;
  const streets = (world && Array.isArray(world.streets)) ? world.streets : [];
  const peds = [];
  state.peds = peds;

  // A sidewalk run: the ped walks parallel to `street`, on the side given
  // by `side` (+1 / -1), at `along` (the coordinate along the street).
  // While crossing, the ped walks across the street instead.
  function makePed() {
    const street = rng.pick(streets);
    const side = rng.chance(0.5) ? 1 : -1;
    const dir = rng.chance(0.5) ? 1 : -1;
    const len = street.to - street.from;
    const ped = {
      x: 0, y: 0,
      street, side, dir,
      along: rng.range(80, Math.max(81, len - 80)),
      walkSpeed: rng.range(WALK_MIN, WALK_MAX),
      speed: 0,
      angle: 0,
      skin: rng.pick(SKINS),
      shirt: rng.pick(SHIRTS),
      pants: rng.pick(PANTS),
      hat: rng.chance(0.3),
      phase: rng.range(0, Math.PI * 2),
      state: 'walk', // walk | cross | flee | idle
      stateTimer: rng.range(0, 4),
      crossFrom: null,
      crossTo: null,
      crossT: 0,
      fleeX: 0,
      fleeY: 0,
      fleeTimer: 0,
    };
    placeOnSidewalk(ped);
    return ped;
  }

  function placeOnSidewalk(ped) {
    const s = ped.street;
    const off = s.width / 2 + SIDEWALK_OFF;
    if (s.axis === 'v') {
      ped.x = s.at + ped.side * off;
      ped.y = ped.along;
    } else {
      ped.x = ped.along;
      ped.y = s.at + ped.side * off;
    }
    ped.angle = s.axis === 'v'
      ? (ped.dir > 0 ? Math.PI / 2 : -Math.PI / 2)
      : (ped.dir > 0 ? 0 : Math.PI);
  }

  function spawnAll() {
    peds.length = 0;
    for (let i = 0; i < PED_COUNT; i += 1) {
      if (!streets.length) break;
      peds.push(makePed());
    }
  }

  // Keluarkan supir dari mobil yang dicuri (carjack): supir menjadi
  // pejalan kaki di trotoar terdekat, lalu kabur dari mobil. Dipakai
  // vehicles.js saat pemain mencuri mobil traffic (F).
  function ejectDriver(car) {
    if (!car || typeof car.x !== 'number' || typeof car.y !== 'number') return null;
    if (!streets.length) return null;
    let street = null;
    let side = 1;
    if (world && typeof world.nearestRoadPoint === 'function') {
      const near = world.nearestRoadPoint(car.x, car.y);
      if (near && near.street) {
        street = near.street;
        side = street.axis === 'v'
          ? (car.x >= street.at ? 1 : -1)
          : (car.y >= street.at ? 1 : -1);
      }
    }
    if (!street) street = streets[0];
    const ped = {
      x: 0, y: 0,
      street, side, dir: rng.chance(0.5) ? 1 : -1,
      along: street.axis === 'v' ? car.y : car.x,
      walkSpeed: rng.range(WALK_MIN, WALK_MAX),
      speed: 0,
      angle: 0,
      skin: rng.pick(SKINS),
      shirt: rng.pick(SHIRTS),
      pants: rng.pick(PANTS),
      hat: rng.chance(0.3),
      phase: rng.range(0, Math.PI * 2),
      state: 'flee', // langsung kabur dari mobil yang dicuri
      stateTimer: 0,
      crossFrom: null,
      crossTo: null,
      crossT: 0,
      fleeX: car.x,
      fleeY: car.y,
      fleeTimer: FLEE_TIME,
    };
    placeOnSidewalk(ped);
    peds.push(ped);
    return ped;
  }

  // vehicles.js memanggil state.pedestrians.ejectDriver saat mencuri mobil.
  state.pedestrians = { ejectDriver };

  // ---- Danger ---------------------------------------------------------------
  // Danger sources: an explicit state.danger { x, y, radius, until },
  // any explosion event in state.events, and fast cars nearby.
  function dangerNear(x, y) {
    const d = state.danger;
    if (d && typeof d.x === 'number' && typeof d.y === 'number') {
      const r = (typeof d.radius === 'number' ? d.radius : FLEE_RADIUS);
      const dx = x - d.x;
      const dy = y - d.y;
      if (dx * dx + dy * dy < r * r) return { x: d.x, y: d.y };
    }
    if (Array.isArray(state.events)) {
      for (const e of state.events) {
        if (!e || (e.type !== 'explosion' && e.type !== 'gunshot')) continue;
        if (typeof e.x !== 'number') continue;
        // Stale bangs stop scaring people after a few seconds.
        if (typeof e.t === 'number' && typeof state.time === 'number'
          && state.time - e.t > 3) continue;
        const dx = x - e.x;
        const dy = y - e.y;
        if (dx * dx + dy * dy < FLEE_RADIUS * FLEE_RADIUS) return { x: e.x, y: e.y };
      }
    }
    // A car moving fast towards the ped's street.
    if (Array.isArray(state.traffic)) {
      for (const car of state.traffic) {
        if (!car || car.speed < 170) continue;
        const dx = x - car.x;
        const dy = y - car.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < 130 * 130) {
          // Only flee if the car is heading roughly towards the ped.
          const toPed = Math.atan2(dy, dx);
          let diff = Math.abs(toPed - car.angle);
          if (diff > Math.PI) diff = Math.PI * 2 - diff;
          if (diff < Math.PI * 0.6) return { x: car.x, y: car.y };
        }
      }
    }
    if (Array.isArray(state.vehicles)) {
      for (const v of state.vehicles) {
        if (!v || v.dead || typeof v.speed !== 'number' || v.speed < 220) continue;
        const dx = x - v.x;
        const dy = y - v.y;
        if (dx * dx + dy * dy < 130 * 130) return { x: v.x, y: v.y };
      }
    }
    return null;
  }

  // ---- Walking ----------------------------------------------------------------
  function crossingsOf(street) {
    const list = [];
    for (const o of streets) {
      if (o.axis === street.axis) continue;
      if (o.at >= street.from && o.at <= street.to) list.push(o.at);
    }
    list.sort((a, b) => a - b);
    return list;
  }

  function maybeCrossOrTurn(ped) {
    // At an intersection, sometimes cross the street, sometimes turn the
    // corner onto the crossing street, usually just keep walking.
    const crossings = crossingsOf(ped.street);
    for (const at of crossings) {
      if (Math.abs(ped.along - at) > 9) continue;
      const roll = rng.next();
      if (roll < 0.22) {
        // Cross to the opposite sidewalk.
        ped.state = 'cross';
        ped.crossT = 0;
        ped.crossFrom = { x: ped.x, y: ped.y };
        const s = ped.street;
        const off = s.width / 2 + SIDEWALK_OFF;
        if (s.axis === 'v') ped.crossTo = { x: s.at - ped.side * off, y: ped.along };
        else ped.crossTo = { x: ped.along, y: s.at - ped.side * off };
        ped.stateTimer = 0;
        return;
      }
      if (roll < 0.42) {
        // Turn the corner: walk along the crossing street from here.
        const crossStreet = streets.find((o) => o.axis !== ped.street.axis && o.at === at);
        if (crossStreet) {
          ped.street = crossStreet;
          ped.along = ped.street.axis === 'v' ? ped.y : ped.x;
          ped.side = rng.chance(0.5) ? 1 : -1;
          ped.dir = rng.chance(0.5) ? 1 : -1;
          placeOnSidewalk(ped);
        }
        return;
      }
      return;
    }
  }

  function update(dt) {
    if (!streets.length) return;
    if (peds.length === 0) spawnAll();

    for (const ped of peds) {
      ped.phase += dt * (ped.speed > 0 ? ped.speed * 0.055 : 2);

      // Danger check first: it overrides everything else.
      const danger = dangerNear(ped.x, ped.y);
      if (danger && ped.state !== 'flee') {
        ped.state = 'flee';
        ped.fleeTimer = FLEE_TIME;
        ped.fleeX = danger.x;
        ped.fleeY = danger.y;
      }

      if (ped.state === 'flee') {
        ped.fleeTimer -= dt;
        const dx = ped.x - ped.fleeX;
        const dy = ped.y - ped.fleeY;
        const d = Math.hypot(dx, dy) || 1;
        ped.angle = Math.atan2(dy, dx);
        ped.speed = RUN_SPEED;
        const stepX = Math.cos(ped.angle) * ped.speed * dt;
        const stepY = Math.sin(ped.angle) * ped.speed * dt;
        // Fleeing peds slide around buildings instead of running through
        // them: try the full step, then each axis alone.
        const nx = clamp(ped.x + stepX, 24, 5096);
        const ny = clamp(ped.y + stepY, 24, 5096);
        const blocked = (x, y) => world && typeof world.collideRect === 'function'
          && world.collideRect(x - 6, y - 6, 12, 12);
        if (!blocked(nx, ny)) {
          ped.x = nx;
          ped.y = ny;
        } else if (!blocked(nx, ped.y)) {
          ped.x = nx;
        } else if (!blocked(ped.x, ny)) {
          ped.y = ny;
        }
        if (ped.fleeTimer <= 0) {
          // Calm down: find the nearest road and resume walking there.
          ped.state = 'walk';
          if (world && typeof world.nearestRoadPoint === 'function') {
            const near = world.nearestRoadPoint(ped.x, ped.y);
            if (near && near.street) {
              ped.street = near.street;
              ped.along = near.street.axis === 'v' ? near.y : near.x;
              ped.side = rng.chance(0.5) ? 1 : -1;
              ped.dir = rng.chance(0.5) ? 1 : -1;
              placeOnSidewalk(ped);
            }
          }
        }
        continue;
      }

      if (ped.state === 'cross') {
        ped.crossT += dt * 1.6;
        const t = Math.min(1, ped.crossT);
        ped.x = ped.crossFrom.x + (ped.crossTo.x - ped.crossFrom.x) * t;
        ped.y = ped.crossFrom.y + (ped.crossTo.y - ped.crossFrom.y) * t;
        ped.speed = 90;
        if (t >= 1) {
          ped.state = 'walk';
          ped.side = -ped.side;
          placeOnSidewalk(ped);
        }
        continue;
      }

      // Idle pauses, then walking.
      if (ped.state === 'idle') {
        ped.stateTimer -= dt;
        ped.speed = 0;
        if (ped.stateTimer <= 0) {
          ped.state = 'walk';
          ped.stateTimer = rng.range(6, 18);
        }
        continue;
      }

      // Walking along the sidewalk.
      ped.stateTimer -= dt;
      if (ped.stateTimer <= 0) {
        ped.state = 'idle';
        ped.stateTimer = rng.range(1.5, 5);
        ped.speed = 0;
        continue;
      }
      ped.speed = ped.walkSpeed;
      ped.along += ped.dir * ped.speed * dt;
      const len = ped.street.to - ped.street.from;
      if (ped.along < 60 || ped.along > len - 60) {
        // End of the street: turn around.
        ped.dir = -ped.dir;
        ped.along = clamp(ped.along, 60, len - 60);
        placeOnSidewalk(ped);
      } else {
        placeOnSidewalk(ped);
      }
      maybeCrossOrTurn(ped);
    }
  }

  // ---- Draw -------------------------------------------------------------------
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

  function drawPed(ctx, ped) {
    const swing = Math.sin(ped.phase) * (ped.speed > 1 ? 4 : 0.8);
    ctx.save();
    ctx.translate(ped.x, ped.y);
    // Shadow.
    ctx.fillStyle = 'rgba(20, 24, 34, 0.3)';
    ctx.beginPath();
    ctx.ellipse(1, 2, 9, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(ped.angle + Math.PI / 2);
    // Legs (alternating with the walk cycle).
    ctx.fillStyle = ped.pants;
    ctx.fillRect(-5, -2 + swing * 0.4, 4, 10 - Math.abs(swing) * 0.3);
    ctx.fillRect(1, -2 - swing * 0.4, 4, 10 - Math.abs(swing) * 0.3);
    // Body.
    ctx.fillStyle = ped.shirt;
    ctx.beginPath();
    ctx.roundRect(-6, -10, 12, 12, 4);
    ctx.fill();
    // Arms.
    ctx.fillStyle = ped.skin;
    ctx.fillRect(-8, -9 + swing * 0.5, 3, 8);
    ctx.fillRect(5, -9 - swing * 0.5, 3, 8);
    // Head.
    ctx.fillStyle = ped.skin;
    ctx.beginPath();
    ctx.arc(0, -14, 6, 0, Math.PI * 2);
    ctx.fill();
    // Hat or hair.
    if (ped.hat) {
      ctx.fillStyle = '#e8b13d';
      ctx.beginPath();
      ctx.arc(0, -15, 6.5, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(-7, -16, 14, 2);
    } else {
      ctx.fillStyle = '#2e2018';
      ctx.beginPath();
      ctx.arc(0, -15, 6, Math.PI * 0.9, Math.PI * 2.1);
      ctx.fill();
    }
    ctx.restore();
  }

  function draw(ctxArg, cameraArg) {
    const resolved = resolveView(ctxArg, cameraArg);
    if (!resolved) return;
    const { ctx, view } = resolved;
    for (const ped of peds) {
      if (ped.x < view.x - 30 || ped.x > view.x + view.width + 30
        || ped.y < view.y - 30 || ped.y > view.y + view.height + 30) continue;
      drawPed(ctx, ped);
    }
  }

  spawnAll();
  return { update, draw, ejectDriver };
}
