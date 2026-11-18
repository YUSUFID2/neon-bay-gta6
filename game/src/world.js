// Neon Bay — the city itself.
//
// createWorld(state) builds the whole map deterministically from state.seed
// through state.rng (same seed -> same city, every time). state.rng may be
// the seeded rng object ({ next, range, int, pick, chance }) or a plain
// function returning [0, 1); both are accepted.
//
// The result lives on state.world and is also returned as `world`:
//   streets  — every street: { axis, at, from, to, width, name, main,
//                bridge, x1, y1, x2, y2 } (endpoints included for the minimap)
//   roads    — alias of streets
//   blocks   — city blocks between streets: { x, y, w, h, district }
//   buildings — collision rects: { x, y, w, h, height, color, roof,
//                district, neon, hue }
//   solids   — alias of buildings, for vehicle collision
//   props    — trees, lamps, hydrants, benches, billboards, crates,
//              containers, ponds, buoys
//   districts, water (one bounding rect for the minimap), waterParts
//              (the two real water rects, split by the bridge), piers, parks
//   playerSpawn, missionSpawns (6), hospital, policeStation
//   parkedSpots — { x, y, angle } along street edges, for parked cars
//   roadSpawns  — { x, y, angle } in driving lanes, for traffic cars
//   helpers: isRoad(x, y), isWater(x, y), collideRect(x, y, w, h),
//            nearestRoadPoint(x, y), time (seconds since boot)
//
// The city is a street grid over a 5120 x 5120 world. Four districts tile
// the map: Northside (residential + parks, north), Downtown (tall towers,
// centre), Old Town (narrow streets, small shops, west and south),
// Harborfront (docks and warehouses along the water on the east edge).
// One bridge street crosses the water to the far pier.
//
// draw() takes no arguments in the live game: the renderer has already
// applied the camera transform, so drawing happens in world coordinates
// and the context comes from state.renderer.ctx. draw(ctx, camera) with
// explicit arguments is also supported (camera as a top-left view rect,
// or a centre-based { x, y, zoom } camera).

const WORLD_W = 5120;
const WORLD_H = 5120;
const SIDEWALK = 16;
const WATER_X = 4920;
const BRIDGE_Y = 1700;
// Half-width of the water gap under the bridge: the road (55) plus the
// sidewalk on both sides (16) plus a margin, so the bridge sidewalks are
// not water for collision purposes.
const BRIDGE_HALF = 76;

const DISTRICT_TINTS = {
  northside: '#7fae6e',
  downtown: '#8d97ad',
  oldtown: '#b08d5f',
  harborfront: '#6f8b9a',
};

const DISTRICT_NAMES = {
  northside: 'Northside',
  downtown: 'Downtown',
  oldtown: 'Old Town',
  harborfront: 'Harborfront',
};

const STREET_NAMES_V = [
  'Palm Row', 'Coral St', 'Neon Ave', 'Moreno Blvd', 'Rosa Ln',
  'Sunset Blvd', 'Anchor Way', 'Pier St', 'Harbor Rd',
];

const STREET_NAMES_H = [
  'Bay St', 'Jacaranda Ave', 'Canal St', 'Bridge St',
  'Mercado St', 'Villa Rd', 'Garden Ln', 'South Quay',
  'Harbor View', 'Palm Court', 'Sunset Row',
];

const BILLBOARD_TEXTS = [
  'NEON BAY', "ROSA'S", 'TACO JOINT', '24H MOTEL', 'CASINO BAY',
  'NOODLES', 'HOTEL LUNA', 'PIER 9', 'AUTO PARTS', 'KARAOKE',
];

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Accept the rng object ({ next, range, int, pick, chance }), a plain
// function, or nothing (then build a local mulberry32 from the seed).
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

export function createWorld(state) {
  const rng = asRng(state.rng, state.seed);
  const time = { now: 0 };

  // ---- Streets ------------------------------------------------------------
  // Vertical streets run north-south, horizontal streets east-west. Widths
  // vary: the two avenues are wide, Old Town streets are narrow.
  const verticalAt = [400, 900, 1450, 2000, 2550, 3050, 3550, 4050, 4550];
  const horizontalAt = [350, 800, 1250, 1700, 2150, 2600, 3050, 3450, 3900, 4350, 4800];
  const streets = [];

  verticalAt.forEach((at, i) => {
    const avenue = at === 2000 || at === 3550;
    const narrow = at === 400 || at === 900;
    streets.push({
      axis: 'v', at, from: 0, to: WORLD_H,
      width: avenue ? 110 : narrow ? 54 : 72,
      name: STREET_NAMES_V[i] || ('Street ' + (i + 1)),
      main: avenue,
      x1: at, y1: 0, x2: at, y2: WORLD_H,
    });
  });
  horizontalAt.forEach((at, i) => {
    const avenue = at === 1700;
    const narrow = at >= 2600;
    // Bridge St crosses the water to the far pier; other east-west streets
    // stop at the waterfront road.
    const to = at === BRIDGE_Y ? WORLD_W : WATER_X - 40;
    streets.push({
      axis: 'h', at, from: 0, to,
      width: avenue ? 110 : narrow ? 54 : 72,
      name: STREET_NAMES_H[i] || ('Avenue ' + (i + 1)),
      main: avenue,
      bridge: at === BRIDGE_Y,
      x1: 0, y1: at, x2: to, y2: at,
    });
  });

  function districtAt(x, y) {
    if (y < 800) return 'northside';
    if (x >= 4050) return 'harborfront';
    if (x >= 1450 && x < 4050 && y >= 800 && y < 2600) return 'downtown';
    return 'oldtown';
  }

  // ---- Districts ----------------------------------------------------------
  const districts = [
    { id: 'northside', name: DISTRICT_NAMES.northside, x: 0, y: 0, w: WORLD_W, h: 800 },
    { id: 'downtown', name: DISTRICT_NAMES.downtown, x: 1450, y: 800, w: 2600, h: 1800 },
    { id: 'oldtown', name: DISTRICT_NAMES.oldtown, x: 0, y: 800, w: 1450, h: 4320 },
    { id: 'oldtown', name: DISTRICT_NAMES.oldtown, x: 1450, y: 2600, w: 2600, h: 2520 },
    { id: 'harborfront', name: DISTRICT_NAMES.harborfront, x: 4050, y: 800, w: 1070, h: 4320 },
  ];

  // ---- Water, piers, parks -----------------------------------------------
  // `water` is one bounding rect (what the minimap reads); `waterParts`
  // are the two real rects with the bridge corridor cut out.
  const water = { x: WATER_X, y: 0, w: WORLD_W - WATER_X, h: WORLD_H };
  const waterParts = [
    { x: WATER_X, y: 0, w: WORLD_W - WATER_X, h: BRIDGE_Y - BRIDGE_HALF },
    { x: WATER_X, y: BRIDGE_Y + BRIDGE_HALF, w: WORLD_W - WATER_X, h: WORLD_H - BRIDGE_Y - BRIDGE_HALF },
  ];
  const piers = [
    { x: WATER_X - 30, y: 950, w: 190, h: 46 },
    { x: WATER_X - 30, y: 2350, w: 220, h: 52 },
    { x: WATER_X - 30, y: 2950, w: 170, h: 46 },
    { x: WATER_X - 30, y: 4200, w: 190, h: 46 },
  ];
  const parks = [
    { x: 1010, y: 90, w: 340, h: 220, name: 'Jacaranda Park' },
    { x: 2660, y: 60, w: 300, h: 240, name: 'Palm Court' },
    { x: 3660, y: 90, w: 300, h: 210, name: 'North Green' },
    { x: 1540, y: 3980, w: 340, h: 280, name: 'South Park' },
  ];

  // ---- Blocks and buildings ----------------------------------------------
  const blocks = [];
  const buildings = [];

  const vStreets = streets.filter((s) => s.axis === 'v');
  const hStreets = streets.filter((s) => s.axis === 'h');

  // Cells between neighbouring streets, plus the rim cells along the edges.
  const vEdges = [{ at: 0, width: 0 }].concat(vStreets).concat([{ at: WORLD_W, width: 0 }]);
  const hEdges = [{ at: 0, width: 0 }].concat(hStreets).concat([{ at: WORLD_H, width: 0 }]);

  for (let vi = 0; vi < vEdges.length - 1; vi += 1) {
    for (let hi = 0; hi < hEdges.length - 1; hi += 1) {
      const left = vEdges[vi];
      const right = vEdges[vi + 1];
      const top = hEdges[hi];
      const bottom = hEdges[hi + 1];
      const bx = left.at + left.width / 2 + SIDEWALK;
      const by = top.at + top.width / 2 + SIDEWALK;
      const bw = right.at - right.width / 2 - SIDEWALK - bx;
      const bh = bottom.at - bottom.width / 2 - SIDEWALK - by;
      if (bw < 60 || bh < 60) continue;
      const cx = bx + bw / 2;
      const cy = by + bh / 2;
      const district = districtAt(cx, cy);
      // The waterfront strip east of Harbor Rd is docks, not blocks.
      if (cx > WATER_X - 120) continue;
      const block = { x: bx, y: by, w: bw, h: bh, district };
      blocks.push(block);

      // A park replaces buildings on its block.
      const inPark = parks.some((p) => rectsOverlap(block, p));
      if (inPark) continue;

      const cols = district === 'downtown' ? rng.int(1, 2)
        : district === 'harborfront' ? rng.int(1, 2)
        : rng.int(2, 3);
      const rows = district === 'downtown' ? 1
        : district === 'harborfront' ? rng.int(1, 2)
        : rng.int(1, 2);
      const cellW = bw / cols;
      const cellH = bh / rows;
      for (let c = 0; c < cols; c += 1) {
        for (let r = 0; r < rows; r += 1) {
          if (district !== 'downtown' && rng.chance(0.12)) continue; // empty lot
          const inset = district === 'downtown' ? 14 : 10;
          const bwid = cellW - inset * 2 - rng.range(0, cellW * 0.18);
          const bhgt = cellH - inset * 2 - rng.range(0, cellH * 0.18);
          if (bwid < 34 || bhgt < 30) continue;
          const bx0 = bx + c * cellW + inset + rng.range(0, 8);
          const by0 = by + r * cellH + inset + rng.range(0, 8);
          let height = 20;
          let color = '#8a7f72';
          let roof = '#5d564e';
          if (district === 'downtown') {
            height = rng.int(70, 170);
            color = rng.pick(['#3d4a63', '#46536b', '#37415a', '#4a3f5e', '#2f3d4f']);
            roof = rng.pick(['#232c40', '#2b3348', '#1f2739']);
          } else if (district === 'harborfront') {
            height = rng.int(18, 30);
            color = rng.pick(['#7a6a58', '#6b7a72', '#8a6f5a', '#5f6b7d']);
            roof = rng.pick(['#4c4238', '#46524c', '#54453a']);
          } else if (district === 'northside') {
            height = rng.int(14, 24);
            color = rng.pick(['#c9a37e', '#b98d6e', '#a8b08a', '#c2b49a', '#9db3c4']);
            roof = rng.pick(['#7d4a3a', '#5d6b52', '#6b5a44']);
          } else {
            height = rng.int(16, 30);
            color = rng.pick(['#a8765a', '#96684e', '#b08a62', '#8a6a52']);
            roof = rng.pick(['#5d4234', '#6b4a38', '#4c3a2e']);
          }
          buildings.push({
            x: bx0, y: by0, w: bwid, h: bhgt,
            height, color, roof, district,
            neon: district === 'downtown' && rng.chance(0.55),
            hue: rng.int(0, 359),
          });
        }
      }
    }
  }

  // ---- Props --------------------------------------------------------------
  const props = [];

  function addProp(kind, x, y, extra) {
    props.push(Object.assign({ kind, x, y }, extra || {}));
  }

  // Trees along sidewalks and inside parks.
  for (const block of blocks) {
    const count = block.district === 'northside' ? rng.int(2, 5) : rng.int(0, 2);
    for (let i = 0; i < count; i += 1) {
      const edge = rng.int(0, 3);
      let x = block.x + rng.range(4, block.w - 4);
      let y = block.y + rng.range(4, block.h - 4);
      if (edge === 0) y = block.y + 5;
      else if (edge === 1) y = block.y + block.h - 5;
      else if (edge === 2) x = block.x + 5;
      else x = block.x + block.w - 5;
      addProp('tree', x, y, { r: rng.range(9, 15), shade: rng.range(0.75, 1) });
    }
  }
  for (const park of parks) {
    const n = rng.int(6, 10);
    for (let i = 0; i < n; i += 1) {
      addProp('tree', park.x + rng.range(20, park.w - 20), park.y + rng.range(20, park.h - 20),
        { r: rng.range(11, 18), shade: rng.range(0.8, 1) });
    }
    addProp('bench', park.x + park.w / 2 - 30, park.y + park.h - 26, { angle: 0 });
    addProp('bench', park.x + 24, park.y + park.h / 2, { angle: Math.PI / 2 });
    addProp('pond', park.x + park.w / 2, park.y + park.h / 2 - 20, { r: rng.range(26, 40) });
  }

  // Lamps and hydrants at intersections.
  for (const v of vStreets) {
    for (const h of hStreets) {
      const lx = v.at + v.width / 2 + 8;
      const ly = h.at + h.width / 2 + 8;
      addProp('lamp', lx, ly, {});
      if (rng.chance(0.5)) addProp('hydrant', v.at - v.width / 2 - 9, h.at - h.width / 2 - 9, {});
      if (rng.chance(0.35)) addProp('bench', v.at - v.width / 2 - 12, h.at + h.width / 2 + 12, { angle: 0 });
    }
  }

  // Billboards in Downtown, crates and containers at the docks.
  for (let i = 0; i < 9; i += 1) {
    const bx = rng.range(1500, 4000);
    const by = rng.range(850, 2500);
    addProp('billboard', bx, by, {
      w: rng.range(90, 150), h: rng.range(34, 52),
      text: BILLBOARD_TEXTS[i % BILLBOARD_TEXTS.length],
      hue: rng.int(0, 359),
    });
  }
  for (let i = 0; i < 34; i += 1) {
    const cx = rng.range(4100, 4880);
    const cy = rng.range(850, 5000);
    if (rng.chance(0.5)) addProp('container', cx, cy, { w: rng.range(70, 110), h: 34, hue: rng.int(0, 359) });
    else addProp('crate', cx, cy, { s: rng.range(18, 30) });
  }
  for (let i = 0; i < 8; i += 1) {
    addProp('buoy', WATER_X + rng.range(30, 170), rng.range(120, 5000), { r: 7 });
  }

  // ---- Spawn points -------------------------------------------------------
  // Every spawn sits on a road or a pier, never inside a building or water.
  const playerSpawn = { x: 2000, y: 2400 };
  const missionSpawns = [
    { x: 2000, y: 1250, label: 'Getaway' },
    { x: 900, y: 2800, label: 'Pickup' },
    { x: 4300, y: 1700, label: 'Shootout' },
    { x: 4550, y: 2400, label: 'Heist' },
    { x: 5050, y: 1700, label: 'Bridge chase' },
    { x: 5000, y: 2970, label: 'Showdown' },
  ];
  const hospital = { x: 2000, y: 350 };
  const policeStation = { x: 3050, y: 800 };

  // ---- Car spots ----------------------------------------------------------
  // Parked cars hug the edge of a street, clear of intersections; traffic
  // spawns sit in a driving lane, right-hand side, facing along the road.
  // A parked car must be clear of the crossings on its own street; the
  // streets it sits on do not count (it is on one of them by definition).
  function clearOfCrossings(x, y, axis) {
    if (axis === 'v') {
      for (const h of hStreets) {
        if (Math.abs(y - h.at) < 80) return false;
      }
    } else {
      for (const v of vStreets) {
        if (Math.abs(x - v.at) < 80) return false;
      }
    }
    return true;
  }
  const parkedSpots = [];
  for (let i = 0; i < 90 && parkedSpots.length < 44; i += 1) {
    const s = rng.pick(streets);
    const along = rng.range(120, (s.axis === 'v' ? WORLD_H : s.to) - 120);
    let x = 0;
    let y = 0;
    let angle = 0;
    if (s.axis === 'v') {
      x = s.at + (rng.chance(0.5) ? 1 : -1) * (s.width / 2 - 15);
      y = along;
      angle = Math.PI / 2;
    } else {
      x = along;
      y = s.at + (rng.chance(0.5) ? 1 : -1) * (s.width / 2 - 15);
      angle = 0;
    }
    if (x < 40 || x > WATER_X - 20 || y < 40 || y > WORLD_H - 40) continue;
    if (!clearOfCrossings(x, y, s.axis)) continue;
    parkedSpots.push({ x: Math.round(x), y: Math.round(y), angle });
  }
  const roadSpawns = [];
  for (const s of streets) {
    const lanes = s.axis === 'v'
      ? [{ off: -s.width / 4, angle: Math.PI / 2 }, { off: s.width / 4, angle: -Math.PI / 2 }]
      : [{ off: s.width / 4, angle: 0 }, { off: -s.width / 4, angle: Math.PI }];
    const len = s.axis === 'v' ? WORLD_H : s.to;
    const count = Math.max(2, Math.floor(len / 900));
    for (const lane of lanes) {
      for (let i = 0; i < count; i += 1) {
        const along = (i + 0.5) * (len / count) + rng.range(-140, 140);
        let x = 0;
        let y = 0;
        if (s.axis === 'v') { x = s.at + lane.off; y = along; }
        else { x = along; y = s.at + lane.off; }
        if (x < 30 || x > WORLD_W - 30 || y < 30 || y > WORLD_H - 30) continue;
        if (s.axis === 'h' && x > WATER_X - 20 && !s.bridge) continue;
        roadSpawns.push({ x: Math.round(x), y: Math.round(y), angle: lane.angle });
      }
    }
  }

  // ---- Queries ------------------------------------------------------------
  function isRoad(x, y) {
    for (const s of streets) {
      if (s.axis === 'v') {
        if (Math.abs(x - s.at) <= s.width / 2 && y >= s.from && y <= s.to) return true;
      } else if (Math.abs(y - s.at) <= s.width / 2 && x >= s.from && x <= s.to) {
        return true;
      }
    }
    return false;
  }

  function isWater(x, y) {
    return waterParts.some((w) => x >= w.x && x < w.x + w.w && y >= w.y && y < w.y + w.h);
  }

  function collideRect(x, y, w, h) {
    const r = { x, y, w, h };
    // Piers are walkable decks over the water, so a rectangle centred on a
    // pier does not count as being in the water.
    const cx = x + w / 2;
    const cy = y + h / 2;
    const onPier = piers.some((p) => cx >= p.x && cx < p.x + p.w && cy >= p.y && cy < p.y + p.h);
    if (!onPier && waterParts.some((wr) => rectsOverlap(r, wr))) return true;
    for (const b of buildings) {
      if (rectsOverlap(r, b)) return true;
    }
    return false;
  }

  function nearestRoadPoint(x, y) {
    let best = null;
    let bestD = Infinity;
    for (const s of streets) {
      let px = x;
      let py = y;
      if (s.axis === 'v') {
        px = clamp(x, s.at - s.width / 2 + 6, s.at + s.width / 2 - 6);
        py = clamp(y, s.from, s.to);
      } else {
        py = clamp(y, s.at - s.width / 2 + 6, s.at + s.width / 2 - 6);
        px = clamp(x, s.from, s.to);
      }
      const d = (px - x) * (px - x) + (py - y) * (py - y);
      if (d < bestD) { bestD = d; best = { x: px, y: py, street: s }; }
    }
    return best;
  }

  const world = {
    width: WORLD_W,
    height: WORLD_H,
    seed: state.seed,
    streets, roads: streets, blocks, buildings, solids: buildings,
    props, districts, water, waterParts, piers, parks,
    playerSpawn, missionSpawns, hospital, policeStation,
    parkedSpots, roadSpawns,
    isRoad, isWater, collideRect, nearestRoadPoint,
    get time() { return time.now; },
  };
  state.world = world;

  // ---- Update -------------------------------------------------------------
  function update(dt) {
    time.now += dt;
  }

  // ---- Draw ---------------------------------------------------------------
  // Resolve the canvas and the visible world rect. With no arguments the
  // renderer context is used (the camera transform is already applied by
  // main.js) and the view is computed from the centre-based camera.
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
      view = { x: 0, y: 0, width: WORLD_W, height: WORLD_H };
    }
    return { ctx, view };
  }

  function inView(view, x, y, w, h) {
    return x + w >= view.x - 40 && x - 40 <= view.x + view.width
      && y + h >= view.y - 40 && y - 40 <= view.y + view.height;
  }

  function drawGround(ctx, view) {
    ctx.fillStyle = '#6f7d5a';
    ctx.fillRect(view.x, view.y, view.width, view.height);
    // District ground tints.
    for (const d of districts) {
      if (!inView(view, d.x, d.y, d.w, d.h)) continue;
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = DISTRICT_TINTS[d.id];
      ctx.fillRect(d.x, d.y, d.w, d.h);
      ctx.globalAlpha = 1;
    }
    // Water with slow moving wave lines.
    for (const w of waterParts) {
      if (!inView(view, w.x, w.y, w.w, w.h)) continue;
      ctx.fillStyle = '#2e6f8e';
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 2;
      const off = (time.now * 14) % 46;
      for (let wy = w.y + 24 - off; wy < w.y + w.h; wy += 46) {
        ctx.beginPath();
        ctx.moveTo(w.x + 8, wy);
        ctx.lineTo(w.x + w.w - 8, wy);
        ctx.stroke();
      }
    }
    // Parks.
    for (const p of parks) {
      if (!inView(view, p.x, p.y, p.w, p.h)) continue;
      ctx.fillStyle = '#5d9150';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.strokeStyle = '#4a7a40';
      ctx.lineWidth = 3;
      ctx.strokeRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
    }
  }

  function drawStreets(ctx, view) {
    for (const s of streets) {
      const rx = s.axis === 'v' ? s.at - s.width / 2 : s.from;
      const ry = s.axis === 'v' ? s.from : s.at - s.width / 2;
      const rw = s.axis === 'v' ? s.width : s.to - s.from;
      const rh = s.axis === 'v' ? s.to - s.from : s.width;
      if (!inView(view, rx, ry, rw, rh)) continue;
      // Sidewalk border, then asphalt.
      ctx.fillStyle = '#9aa0ab';
      ctx.fillRect(rx - SIDEWALK, ry - SIDEWALK, rw + SIDEWALK * 2, rh + SIDEWALK * 2);
      ctx.fillStyle = s.bridge ? '#7d6a4f' : '#3a3f47';
      ctx.fillRect(rx, ry, rw, rh);
      // Centre dashed line.
      ctx.strokeStyle = '#e8c85a';
      ctx.lineWidth = 3;
      ctx.setLineDash([26, 22]);
      ctx.beginPath();
      if (s.axis === 'v') {
        ctx.moveTo(s.at, Math.max(s.from, view.y));
        ctx.lineTo(s.at, Math.min(s.to, view.y + view.height));
      } else {
        ctx.moveTo(Math.max(s.from, view.x), s.at);
        ctx.lineTo(Math.min(s.to, view.x + view.width), s.at);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (s.bridge) {
        // Bridge rails.
        ctx.strokeStyle = '#c9b48a';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(Math.max(s.from, view.x), s.at - s.width / 2 + 4);
        ctx.lineTo(Math.min(s.to, view.x + view.width), s.at - s.width / 2 + 4);
        ctx.moveTo(Math.max(s.from, view.x), s.at + s.width / 2 - 4);
        ctx.lineTo(Math.min(s.to, view.x + view.width), s.at + s.width / 2 - 4);
        ctx.stroke();
      }
    }
    // Piers over the water.
    for (const p of piers) {
      if (!inView(view, p.x, p.y, p.w, p.h)) continue;
      ctx.fillStyle = '#8a6f4d';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.strokeStyle = '#6b543a';
      ctx.lineWidth = 3;
      for (let px = p.x + 14; px < p.x + p.w; px += 22) {
        ctx.beginPath();
        ctx.moveTo(px, p.y + 3);
        ctx.lineTo(px, p.y + p.h - 3);
        ctx.stroke();
      }
    }
  }

  function drawBuildings(ctx, view) {
    for (let i = 0; i < buildings.length; i += 1) {
      const b = buildings[i];
      if (!inView(view, b.x - 30, b.y - 30, b.w + 60, b.h + 60)) continue;
      const sh = clamp(b.height * 0.35, 6, 60);
      // Long sun shadow to the south-east.
      ctx.fillStyle = 'rgba(20, 24, 34, 0.28)';
      ctx.fillRect(b.x + sh * 0.5, b.y + sh * 0.5, b.w, b.h);
      // Walls.
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      // Roof inset with a parapet edge.
      ctx.fillStyle = b.roof;
      ctx.fillRect(b.x + 5, b.y + 5, b.w - 10, b.h - 10);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x + 5.5, b.y + 5.5, b.w - 11, b.h - 11);
      // Tall towers get a lit window grid; small roofs get a skylight block.
      if (b.height >= 60) {
        const cols = Math.max(2, Math.floor(b.w / 22));
        const rows = Math.max(2, Math.floor(b.h / 22));
        const cw = (b.w - 12) / cols;
        const ch = (b.h - 12) / rows;
        for (let cx = 0; cx < cols; cx += 1) {
          for (let cy = 0; cy < rows; cy += 1) {
            const lit = ((cx * 7 + cy * 13 + i * 3) % 5) < 2;
            ctx.fillStyle = lit ? '#ffe9a3' : '#1d2733';
            ctx.fillRect(b.x + 8 + cx * cw, b.y + 8 + cy * ch, cw - 6, ch - 6);
          }
        }
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fillRect(b.x + b.w * 0.28, b.y + b.h * 0.3, b.w * 0.2, b.h * 0.4);
      }
      // Neon roof edge in Downtown, gently flickering.
      if (b.neon) {
        const flicker = 0.65 + 0.35 * Math.sin(time.now * 2.4 + i * 1.7);
        ctx.globalAlpha = flicker;
        ctx.strokeStyle = 'hsl(' + b.hue + ', 90%, 62%)';
        ctx.lineWidth = 3;
        ctx.strokeRect(b.x + 1.5, b.y + 1.5, b.w - 3, b.h - 3);
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawProps(ctx, view) {
    for (let i = 0; i < props.length; i += 1) {
      const p = props[i];
      if (!inView(view, p.x - 60, p.y - 60, 120, 120)) continue;
      if (p.kind === 'tree') {
        ctx.fillStyle = 'rgba(20, 24, 34, 0.25)';
        ctx.beginPath();
        ctx.arc(p.x + 5, p.y + 6, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = p.shade > 0.9 ? '#4e8f43' : '#3f7d38';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#6fae5f';
        ctx.beginPath();
        ctx.arc(p.x - p.r * 0.3, p.y - p.r * 0.3, p.r * 0.55, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'pond') {
        ctx.fillStyle = '#3f8fb5';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 0.6, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === 'lamp') {
        ctx.fillStyle = 'rgba(20, 24, 34, 0.3)';
        ctx.beginPath();
        ctx.arc(p.x + 3, p.y + 3, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2c313a';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffe9a3';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'hydrant') {
        ctx.fillStyle = '#c23b2e';
        ctx.fillRect(p.x - 4, p.y - 6, 8, 12);
        ctx.fillStyle = '#e8e8e8';
        ctx.fillRect(p.x - 4, p.y - 8, 8, 3);
      } else if (p.kind === 'bench') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle || 0);
        ctx.fillStyle = '#7a5a38';
        ctx.fillRect(-14, -5, 28, 10);
        ctx.fillStyle = '#5d4327';
        ctx.fillRect(-14, -8, 28, 3);
        ctx.restore();
      } else if (p.kind === 'billboard') {
        ctx.fillStyle = '#22262e';
        ctx.fillRect(p.x - 3, p.y - 3, p.w + 6, p.h + 6);
        ctx.fillStyle = 'hsl(' + p.hue + ', 70%, 22%)';
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.fillStyle = 'hsl(' + p.hue + ', 95%, 68%)';
        ctx.font = 'bold ' + Math.max(13, Math.floor(p.h * 0.42)) + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.text, p.x + p.w / 2, p.y + p.h / 2 + 1);
      } else if (p.kind === 'container') {
        ctx.fillStyle = 'hsl(' + p.hue + ', 55%, 42%)';
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 2;
        for (let cx = p.x + 12; cx < p.x + p.w; cx += 14) {
          ctx.beginPath();
          ctx.moveTo(cx, p.y + 2);
          ctx.lineTo(cx, p.y + p.h - 2);
          ctx.stroke();
        }
      } else if (p.kind === 'crate') {
        ctx.fillStyle = '#a8824f';
        ctx.fillRect(p.x, p.y, p.s, p.s);
        ctx.strokeStyle = '#6b543a';
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x + 1, p.y + 1, p.s - 2, p.s - 2);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.s, p.y + p.s);
        ctx.moveTo(p.x + p.s, p.y);
        ctx.lineTo(p.x, p.y + p.s);
        ctx.stroke();
      } else if (p.kind === 'buoy') {
        ctx.fillStyle = '#e2574c';
        ctx.beginPath();
        ctx.arc(p.x, p.y + Math.sin(time.now * 1.5 + i) * 2, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function draw(ctxArg, cameraArg) {
    const resolved = resolveView(ctxArg, cameraArg);
    if (!resolved) return;
    const { ctx, view } = resolved;
    drawGround(ctx, view);
    drawStreets(ctx, view);
    drawBuildings(ctx, view);
    drawProps(ctx, view);
  }

  return { world, update, draw };
}
