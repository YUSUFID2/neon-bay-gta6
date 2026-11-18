// Neon Bay — live minimap. Top-down corner map showing city streets,
// the player arrow, police blips, the mission marker and a north
// indicator. Updated every frame from state.world / state.player /
// state.police / state.missions, with guards when any of them is absent.
// Self-contained: no sibling imports, all data from the shared state.

export function createMinimap(state) {
  const map = {
    // Radius of the square minimap in CSS pixels (before scale).
    size: 180,
    // World bounds cache, recomputed when the world changes.
    bounds: null,
    // Blink timer for the mission marker.
    blink: 0,

    update(dt) {
      map.blink += dt;
      const world = state && state.world ? state.world : null;
      if (!world) return;
      const w = typeof world.width === 'number' ? world.width : 0;
      const h = typeof world.height === 'number' ? world.height : 0;
      if (!map.bounds || map.bounds.w !== w || map.bounds.h !== h) {
        map.bounds = { w: w, h: h };
      }
    },

    // Konvensi draw main.js: dipanggil tanpa argumen; minimap digambar di
    // screen-space (resetTransform dulu) dengan ukuran CSS dari renderer.
    draw(ctxArg, cameraArg) {
      const r = state && state.renderer;
      const ctx = ctxArg || (r && r.ctx);
      if (!ctx) return;
      if (!ctxArg && r && typeof r.resetTransform === 'function') r.resetTransform();
      const world = state && state.world ? state.world : null;
      if (!world) return;
      const rs = (r && typeof r.getSize === 'function') ? r.getSize() : null;
      const vw = (state && state.viewWidth) || (rs ? rs.viewW : (ctx.canvas ? ctx.canvas.width : 1280));
      const vh = (state && state.viewHeight) || (rs ? rs.viewH : (ctx.canvas ? ctx.canvas.height : 720));
      const scale = vw >= 1600 ? 1.15 : vw <= 900 ? 0.85 : 1;
      const size = map.size * scale;
      const pad = 16 * scale;
      const x = vw - size - pad;
      const y = vh - size - pad - 64 * scale; // leave room for ammo/speed below
      const worldW = (map.bounds && map.bounds.w) || world.width || 1;
      const worldH = (map.bounds && map.bounds.h) || world.height || 1;
      const kx = size / Math.max(1, worldW);
      const ky = size / Math.max(1, worldH);
      const k = Math.min(kx, ky);
      const ox = x + (size - worldW * k) / 2;
      const oy = y + (size - worldH * k) / 2;

      ctx.save();
      // Frame.
      ctx.fillStyle = 'rgba(6, 12, 24, 0.78)';
      ctx.beginPath();
      ctx.roundRect(x - 4, y - 4, size + 8, size + 8, 10);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120, 220, 255, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Clip everything to the map square.
      ctx.beginPath();
      ctx.rect(x, y, size, size);
      ctx.clip();

      // Water / land background.
      ctx.fillStyle = '#0d2438';
      ctx.fillRect(x, y, size, size);
      ctx.fillStyle = '#12293d';
      ctx.fillRect(ox, oy, worldW * k, worldH * k);
      // Harbor water edge, when the world marks one.
      if (world.water && typeof world.water.x === 'number') {
        ctx.fillStyle = '#0d2438';
        ctx.fillRect(ox + world.water.x * k, oy + world.water.y * k,
          (world.water.w || 0) * k, (world.water.h || 0) * k);
      }

      map._drawStreets(ctx, world, ox, oy, k);
      map._drawBuildings(ctx, world, ox, oy, k);
      map._drawMission(ctx, ox, oy, k);
      map._drawPolice(ctx, ox, oy, k);
      map._drawPlayer(ctx, ox, oy, k);
      ctx.restore();

      map._drawNorth(ctx, x, y, size, scale);
    },

    _drawStreets(ctx, world, ox, oy, k) {
      const roads = world.roads || world.streets;
      if (!Array.isArray(roads)) return;
      ctx.save();
      ctx.strokeStyle = '#3a5a78';
      ctx.lineCap = 'round';
      for (let i = 0; i < roads.length; i++) {
        const r = roads[i];
        if (!r) continue;
        const x1 = typeof r.x1 === 'number' ? r.x1 : (typeof r.x === 'number' ? r.x : 0);
        const y1 = typeof r.y1 === 'number' ? r.y1 : (typeof r.y === 'number' ? r.y : 0);
        const x2 = typeof r.x2 === 'number' ? r.x2 : x1;
        const y2 = typeof r.y2 === 'number' ? r.y2 : y1;
        const wdt = (typeof r.width === 'number' ? r.width : 12) * k;
        ctx.lineWidth = Math.max(1.5, wdt);
        ctx.beginPath();
        ctx.moveTo(ox + x1 * k, oy + y1 * k);
        ctx.lineTo(ox + x2 * k, oy + y2 * k);
        ctx.stroke();
      }
      ctx.restore();
    },

    _drawBuildings(ctx, world, ox, oy, k) {
      const blocks = world.buildings || world.blocks;
      if (!Array.isArray(blocks)) return;
      ctx.save();
      ctx.fillStyle = '#1d3a52';
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (!b) continue;
        const bx = typeof b.x === 'number' ? b.x : 0;
        const by = typeof b.y === 'number' ? b.y : 0;
        const bw = typeof b.w === 'number' ? b.w : (typeof b.width === 'number' ? b.width : 0);
        const bh = typeof b.h === 'number' ? b.h : (typeof b.height === 'number' ? b.height : 0);
        if (bw <= 0 || bh <= 0) continue;
        ctx.fillRect(ox + bx * k, oy + by * k, Math.max(1, bw * k), Math.max(1, bh * k));
      }
      ctx.restore();
    },

    _missionTarget() {
      // state.missions adalah objek internal M (missions.js): marker =
      // { x, y, label, radius, kind } saat misi aktif.
      const missions = state && state.missions ? state.missions : null;
      if (!missions) return null;
      if (missions.marker && typeof missions.marker.x === 'number'
        && typeof missions.marker.y === 'number') {
        return missions.marker;
      }
      return null;
    },

    _drawMission(ctx, ox, oy, k) {
      const t = map._missionTarget();
      if (!t) return;
      const pulse = 1 + 0.25 * Math.sin(map.blink * 4);
      const r = 6 * pulse;
      const mx = ox + t.x * k;
      const my = oy + t.y * k;
      ctx.save();
      ctx.strokeStyle = '#ffb02e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mx, my, r + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffb02e';
      ctx.beginPath();
      ctx.arc(mx, my, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },

    _drawPolice(ctx, ox, oy, k) {
      const police = state && state.police ? state.police : null;
      const list = police && Array.isArray(police.units) ? police.units
        : (Array.isArray(police) ? police : null);
      if (!list) return;
      ctx.save();
      for (let i = 0; i < list.length; i++) {
        const u = list[i];
        if (!u || typeof u.x !== 'number' || typeof u.y !== 'number') continue;
        const px = ox + u.x * k;
        const py = oy + u.y * k;
        const onFoot = u.kind === 'foot' || u.onFoot === true;
        ctx.fillStyle = onFoot ? '#4da6ff' : '#ff4d5e';
        ctx.beginPath();
        ctx.arc(px, py, onFoot ? 2.5 : 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    },

    _drawPlayer(ctx, ox, oy, k) {
      const p = state && state.player ? state.player : null;
      if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return;
      const px = ox + p.x * k;
      const py = oy + p.y * k;
      const angle = typeof p.angle === 'number' ? p.angle
        : (typeof p.facing === 'number' ? p.facing : -Math.PI / 2);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#0a0f1e';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(-6, -5.5);
      ctx.lineTo(-3, 0);
      ctx.lineTo(-6, 5.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    },

    _drawNorth(ctx, x, y, size, scale) {
      // North indicator: small compass badge inside the top-left corner
      // of the map so it never overlaps other HUD elements.
      const nx = x + 14 * scale;
      const ny = y + 14 * scale;
      ctx.save();
      ctx.fillStyle = 'rgba(10, 15, 30, 0.85)';
      ctx.beginPath();
      ctx.arc(nx, ny, 11 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120, 220, 255, 0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#ffb02e';
      ctx.beginPath();
      ctx.moveTo(nx, ny - 7 * scale);
      ctx.lineTo(nx + 4 * scale, ny + 3 * scale);
      ctx.lineTo(nx - 4 * scale, ny + 3 * scale);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#e8f6ff';
      ctx.font = '700 ' + Math.round(9 * scale) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('N', nx, ny + 7 * scale);
      ctx.restore();
    },
  };
  return map;
}
