// Neon Bay — story missions. Six missions in a chain, each a list of
// objectives with a map/minimap marker (via state.missions.marker) and a HUD
// objective line (via state.hud.objective). No imports: all data arrives in
// `state`, all randomness from state.rng. The integrator owns the player,
// vehicles, police and world; this module only reads them (guarded) and asks
// the combat module, when present, to spawn mission enemies and pickups.
//
// Expected state shape (everything guarded, fallbacks included):
//   state.rng                    objek rng seeded { next, range, int, pick, chance }
//   state.player { x, y, cash? }   player position; cash may live on state.cash
//   state.cash                     number, the player's money
//   state.police { wanted }        wanted level 0..5
//   state.world { width, height }  world size in world units
//   state.hud { objective }        written by this module for the HUD
//   state.combat { kills, spawnEnemy(x, y, opts), clearMissionEnemies(),
//                  giveWeapon(name) }  present once combat is wired in
//   state.audio { play(name) }     optional sound hook, never required

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

function fallbackRng() {
  let a = 0x9e3779b9;
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

export function createMissions(state) {
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

  // Anchor points as fractions of the world so the chain adapts to any city
  // size the world builder produces.
  function pt(fx, fy) {
    return { x: Math.round(fx * worldWidth()), y: Math.round(fy * worldHeight()) };
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
  // player.cash -> state.cash TIAP FRAME, jadi menambah state.cash saja
  // akan tertimpa frame berikutnya dan reward misi hilang. Tulis ke
  // player.cash dulu, lalu samakan cerminannya.
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

  function getWanted() {
    if (state.police && typeof state.police.wanted === 'number') return state.police.wanted;
    if (typeof state.wanted === 'number') return state.wanted;
    return 0;
  }

  function setWanted(level) {
    const value = clamp(Math.round(level), 0, 5);
    if (state.police && typeof state.police.wanted === 'number') state.police.wanted = value;
    else state.wanted = value;
  }

  // audio.js tidak punya play(name); petakan ke metode yang memang ada.
  function playSound(name) {
    if (!state.audio) return;
    try {
      if (name === 'objective' || name === 'missionComplete') {
        if (typeof state.audio.pickup === 'function') state.audio.pickup();
      } else if (name === 'missionStart') {
        if (typeof state.audio.stinger === 'function') state.audio.stinger('mission');
      } else if (name === 'missionFail') {
        if (typeof state.audio.stinger === 'function') state.audio.stinger('fail');
      }
    } catch (err) { /* sound never blocks the game */ }
  }

  // Mission definitions. `objectives` run in order; each one is:
  //   kind: 'goto' | 'timedGoto' | 'pickup' | 'loseWanted' | 'shootout'
  //   x, y: target point (fractions resolved at start)
  //   radius: how close counts as arrived
  //   label: HUD objective line
  //   time: seconds allowed (timedGoto)
  //   count: enemies to beat (shootout)
  //   wanted: wanted level to set when this objective starts
  //   enemies: [{ dx, dy, kind }] spawn offsets around the target (shootout)
  function buildList() {
    const garage = pt(0.22, 0.62);
    const hideout = pt(0.78, 0.3);
    // Milo menunggu di JALAN (Bay St, y=800 — tepat di tengah jalan
    // horizontal, bisa dicapai dari segala arah), bukan di dalam gedung:
    // titik lama (0.55, 0.18) = (2816, 922) jatuh di tengah blok/gedung
    // dan hanya bisa didekati lewat gang sempit.
    const northside = pt(0.55, 800 / 5120); // (2816, 800)
    const oldTown = pt(0.16, 0.3);
    const boatyard = pt(0.85, 0.78);
    const downtownDrop = pt(0.45, 0.45);
    const bridgeWest = pt(0.38, 0.72);
    const bridgeEast = pt(0.66, 0.72);
    const harbor = pt(0.82, 0.82);
    return [
      {
        id: 'getaway',
        title: 'The Long Way Home',
        reward: 400,
        status: 'available',
        objectives: [
          { kind: 'goto', x: garage.x, y: garage.y, radius: 90, label: 'Get to Rosa\'s garage' },
          { kind: 'timedGoto', x: hideout.x, y: hideout.y, radius: 100, time: 90, label: 'Reach the hideout before time runs out' },
        ],
      },
      {
        id: 'pickup',
        title: 'The Quiet Pickup',
        reward: 600,
        status: 'locked',
        objectives: [
          { kind: 'goto', x: northside.x, y: northside.y, radius: 90, label: 'Pick up Milo in Northside' },
          { kind: 'pickup', x: northside.x, y: northside.y, radius: 70, label: 'Milo is in the car — now lose the cops', wanted: 2 },
          { kind: 'loseWanted', label: 'Lose the wanted level' },
        ],
      },
      {
        id: 'turf',
        title: 'Turf War',
        reward: 900,
        status: 'locked',
        objectives: [
          { kind: 'goto', x: oldTown.x, y: oldTown.y, radius: 110, label: 'Get to the Old Town alley' },
          {
            kind: 'shootout', x: oldTown.x, y: oldTown.y, radius: 320, count: 5,
            label: 'Take out the Vipers (0/5)',
            enemies: [
              { dx: -60, dy: -40, kind: 'viper' },
              { dx: 70, dy: -60, kind: 'viper' },
              { dx: 0, dy: 80, kind: 'viper' },
              { dx: -90, dy: 60, kind: 'viper' },
              { dx: 90, dy: 40, kind: 'viper' },
            ],
          },
        ],
      },
      {
        id: 'heist',
        title: 'Harbor Lights',
        reward: 1200,
        status: 'locked',
        objectives: [
          { kind: 'goto', x: boatyard.x, y: boatyard.y, radius: 100, label: 'Grab the crate at the Harborfront boatyard' },
          { kind: 'pickup', x: boatyard.x, y: boatyard.y, radius: 70, label: 'Crate secured — deliver it to the Downtown drop' },
          { kind: 'goto', x: downtownDrop.x, y: downtownDrop.y, radius: 100, label: 'Deliver the crate Downtown' },
        ],
      },
      {
        id: 'bridge',
        title: 'Bridge Run',
        reward: 1500,
        status: 'locked',
        objectives: [
          { kind: 'goto', x: bridgeWest.x, y: bridgeWest.y, radius: 100, label: 'Get to the west end of the bridge' },
          { kind: 'timedGoto', x: bridgeEast.x, y: bridgeEast.y, radius: 110, time: 75, label: 'Cross the bridge — don\'t stop', wanted: 3 },
        ],
      },
      {
        id: 'showdown',
        title: 'Harbor Showdown',
        reward: 2500,
        status: 'locked',
        objectives: [
          { kind: 'goto', x: harbor.x, y: harbor.y, radius: 120, label: 'Get to the harbor' },
          {
            kind: 'shootout', x: harbor.x, y: harbor.y, radius: 360, count: 8,
            label: 'Take down Kane\'s crew (0/8)',
            enemies: [
              { dx: -80, dy: -60, kind: 'viper' },
              { dx: 80, dy: -70, kind: 'viper' },
              { dx: -40, dy: 90, kind: 'viper' },
              { dx: 60, dy: 90, kind: 'viper' },
              { dx: -120, dy: 20, kind: 'viper' },
              { dx: 120, dy: 10, kind: 'viper' },
              { dx: 0, dy: -110, kind: 'viper' },
              { dx: 0, dy: 0, kind: 'boss' },
            ],
          },
        ],
      },
    ];
  }

  const M = {
    current: -1,
    status: 'idle', // idle | active | failed | storyDone
    list: buildList(),
    objectiveIndex: 0,
    objective: null,
    marker: null, // { x, y, label, radius, kind } for map + minimap
    timer: 0,
    message: '',
    messageKind: '', // 'brief' | 'complete' | 'fail'
    failReason: '',
    failedIndex: -1,
    killsAtStart: 0,
    pulse: 0,
  };
  state.missions = M;

  function currentDef() {
    if (M.current < 0 || M.current >= M.list.length) return null;
    return M.list[M.current];
  }

  function setObjective(index) {
    const def = currentDef();
    if (!def) return;
    const obj = def.objectives[index];
    if (!obj) return;
    M.objectiveIndex = index;
    M.objective = obj;
    M.timer = typeof obj.time === 'number' ? obj.time : 0;
    if (typeof obj.wanted === 'number') setWanted(obj.wanted);
    if (obj.kind === 'shootout') {
      M.killsAtStart = state.combat && typeof state.combat.kills === 'number' ? state.combat.kills : 0;
      if (state.combat && typeof state.combat.spawnEnemy === 'function') {
        for (const e of obj.enemies || []) {
          const ex = obj.x + e.dx + (rng.next() - 0.5) * 40;
          const ey = obj.y + e.dy + (rng.next() - 0.5) * 40;
          state.combat.spawnEnemy(ex, ey, { kind: e.kind || 'viper', mission: true });
        }
      }
      if (state.combat && typeof state.combat.giveWeapon === 'function' && M.current === 2) {
        state.combat.giveWeapon('shotgun');
      }
    }
    if (state.hud) state.hud.objective = obj.label;
    if (typeof obj.x === 'number' && typeof obj.y === 'number') {
      M.marker = { x: obj.x, y: obj.y, label: obj.label, radius: obj.radius || 90, kind: obj.kind };
    } else {
      M.marker = null;
    }
  }

  function advanceObjective() {
    const def = currentDef();
    if (!def) return;
    playSound('objective');
    if (M.objectiveIndex + 1 < def.objectives.length) {
      setObjective(M.objectiveIndex + 1);
    } else {
      completeMission();
    }
  }

  function startMission(index) {
    if (index < 0 || index >= M.list.length) return false;
    const def = M.list[index];
    if (def.status !== 'available' && def.status !== 'failed') return false;
    if (M.status === 'active') return false;
    M.current = index;
    M.status = 'active';
    M.failedIndex = -1;
    def.status = 'active';
    M.message = def.id;
    M.messageKind = 'brief';
    playSound('missionStart');
    setObjective(0);
    return true;
  }

  function failMission(reason) {
    if (M.status !== 'active') return false;
    const def = currentDef();
    if (def) def.status = 'failed';
    M.failedIndex = M.current;
    M.current = -1;
    M.status = 'failed';
    M.objective = null;
    M.marker = null;
    M.timer = 0;
    if (state.hud) {
      state.hud.objective = '';
      state.hud.objectiveTimer = 0;
    }
    if (state.combat && typeof state.combat.clearMissionEnemies === 'function') {
      state.combat.clearMissionEnemies();
    }
    // message stays the mission id so the integrator can look up the fail
    // line in STORY; the raw cause is kept separately for debugging.
    M.message = def ? def.id : '';
    M.messageKind = 'fail';
    M.failReason = reason || 'failed';
    playSound('missionFail');
    return true;
  }

  function retryFailed() {
    if (M.failedIndex < 0) return false;
    return startMission(M.failedIndex);
  }

  function completeMission() {
    const def = currentDef();
    if (!def) return false;
    addCash(def.reward);
    def.status = 'done';
    const next = M.list[M.current + 1];
    if (next && next.status === 'locked') next.status = 'available';
    M.message = def.id;
    M.messageKind = 'complete';
    M.current = -1;
    M.objective = null;
    M.marker = null;
    M.timer = 0;
    if (state.hud) state.hud.objective = '';
    if (state.combat && typeof state.combat.clearMissionEnemies === 'function') {
      state.combat.clearMissionEnemies();
    }
    playSound('missionComplete');
    if (M.list.every((m) => m.status === 'done')) {
      M.status = 'storyDone';
    } else {
      M.status = 'idle';
    }
    return true;
  }

  function update(dt) {
    M.pulse += dt;
    if (M.status !== 'active') return;
    const def = currentDef();
    const obj = M.objective;
    if (!def || !obj) return;

    if (M.timer > 0) {
      M.timer -= dt;
      if (state.hud) state.hud.objectiveTimer = Math.max(0, Math.ceil(M.timer));
      if (M.timer <= 0) {
        failMission('time');
        return;
      }
    } else if (state.hud) {
      state.hud.objectiveTimer = 0;
    }

    if (obj.kind === 'goto' || obj.kind === 'timedGoto' || obj.kind === 'pickup') {
      const pos = playerPos();
      if (pos && dist(pos.x, pos.y, obj.x, obj.y) <= (obj.radius || 90)) advanceObjective();
    } else if (obj.kind === 'loseWanted') {
      if (getWanted() <= 0) advanceObjective();
    } else if (obj.kind === 'shootout') {
      const kills = state.combat && typeof state.combat.kills === 'number'
        ? state.combat.kills - M.killsAtStart
        : 0;
      const done = Math.min(kills, obj.count || 0);
      const label = obj.label.replace(/\(\d+\/\d+\)/, `(${done}/${obj.count})`);
      if (state.hud) state.hud.objective = label;
      if (M.marker) M.marker.label = label;
      if (kills >= (obj.count || 0)) advanceObjective();
    }
  }

  // Konvensi draw main.js: dipanggil tanpa argumen SETELAH main
  // menerapkan transform kamera — gambar dalam koordinat dunia, ctx dari
  // state.renderer.ctx, tanpa translate tambahan. Bila marker di luar
  // layar, panah kuning dijepit ke tepi view (tetap koordinat dunia).
  function draw() {
    const r = state.renderer;
    if (!r || !r.ctx || M.status !== 'active' || !M.marker) return;
    const ctx = r.ctx;
    const size = (r.getSize && r.getSize()) || { viewW: 1280, viewH: 720 };
    const cam = state.camera || { x: 0, y: 0, zoom: 1 };
    const zoom = cam.zoom || 1;
    const view = {
      x: cam.x - size.viewW / 2 / zoom,
      y: cam.y - size.viewH / 2 / zoom,
      w: size.viewW / zoom,
      h: size.viewH / zoom,
    };
    const mx = M.marker.x;
    const my = M.marker.y;
    const onScreen = mx >= view.x - 80 && mx <= view.x + view.w + 80
      && my >= view.y - 80 && my <= view.y + view.h + 80;

    ctx.save();
    if (onScreen) {
      // Objective zone circle.
      const radius = M.marker.radius || 90;
      ctx.beginPath();
      ctx.arc(mx, my, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(250, 204, 21, 0.08)';
      ctx.fill();
      ctx.setLineDash([10, 8]);
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      // Pulsing beacon ring.
      const pulseR = 26 + ((M.pulse * 40) % 34);
      ctx.beginPath();
      ctx.arc(mx, my, pulseR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(250, 204, 21, ${0.7 - pulseR / 90})`;
      ctx.lineWidth = 3;
      ctx.stroke();
      // Diamond marker.
      ctx.beginPath();
      ctx.moveTo(mx, my - 26);
      ctx.lineTo(mx + 18, my);
      ctx.lineTo(mx, my + 26);
      ctx.lineTo(mx - 18, my);
      ctx.closePath();
      ctx.fillStyle = '#facc15';
      ctx.fill();
      ctx.strokeStyle = '#713f12';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Label.
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      const label = M.marker.label || '';
      const tw = ctx.measureText ? ctx.measureText(label).width : label.length * 7;
      ctx.fillRect(mx - tw / 2 - 6, my - 58, tw + 12, 20);
      ctx.fillStyle = '#fde68a';
      ctx.fillText(label, mx, my - 44);
    } else {
      // Off-screen: panah di tepi view menunjuk ke marker.
      const cx = view.x + view.w / 2;
      const cy = view.y + view.h / 2;
      const dx = mx - cx;
      const dy = my - cy;
      const scale = Math.min(
        (view.w / 2 - 40) / Math.abs(dx || 1),
        (view.h / 2 - 40) / Math.abs(dy || 1),
      );
      const ax = cx + dx * Math.min(scale, 1);
      const ay = cy + dy * Math.min(scale, 1);
      const angle = Math.atan2(dy, dx);
      ctx.translate(ax, ay);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.lineTo(-10, -12);
      ctx.lineTo(-10, 12);
      ctx.closePath();
      ctx.fillStyle = '#facc15';
      ctx.fill();
      ctx.strokeStyle = '#713f12';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  // Reset seluruh rantai misi (dipakai New Game): misi 1 tersedia,
  // sisanya terkunci, tidak ada yang aktif.
  function resetAll() {
    M.list.forEach((m, i) => { m.status = i === 0 ? 'available' : 'locked'; });
    M.current = -1;
    M.status = 'idle';
    M.objectiveIndex = 0;
    M.objective = null;
    M.marker = null;
    M.timer = 0;
    M.message = '';
    M.messageKind = '';
    M.failReason = '';
    M.failedIndex = -1;
    M.killsAtStart = 0;
  }

  // Cross-module API: the combat module calls state.missions.failMission on
  // wasted, so the functions must live on the state object itself, not
  // only on the object this factory returns.
  M.startMission = startMission;
  M.failMission = failMission;
  M.completeMission = completeMission;
  M.retryFailed = retryFailed;
  M.resetAll = resetAll;

  return {
    update,
    draw,
    startMission,
    failMission,
    completeMission,
    retryFailed,
    resetAll,
    getCash,
    state: M,
  };
}
