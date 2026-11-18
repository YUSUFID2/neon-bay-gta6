// Neon Bay — HUD overlay (health, armor, wanted stars, cash, ammo,
// current objective, speed, clock). Drawn in screen coordinates so it
// stays crisp on HiDPI displays. Self-contained: no sibling imports,
// all data comes from the shared state object passed to the factory.

export function createHUD(state) {
  const hud = {
    // Blinking accent timer for low-health warning and star flashes.
    blink: 0,
    // Cached clock string, recomputed only when the minute changes.
    clockText: '08:00',
    clockMinute: -1,

    update(dt) {
      hud.blink += dt;
      // Jam utama tinggal di state.clockMin (menit sejak 00:00, milik
      // main.js); bentuk state.clock.* / state.timeMinutes hanya fallback.
      if (state && typeof state.clockMin === 'number') {
        const m = Math.floor(state.clockMin);
        if (m !== hud.clockMinute) {
          hud.clockMinute = m;
          const hours = Math.floor(m / 60) % 24;
          const mins = m % 60;
          hud.clockText =
            String(hours).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
        }
        return;
      }
      const clock = state && state.clock;
      if (clock && typeof clock.minutes === 'number') {
        const m = Math.floor(clock.minutes);
        if (m !== hud.clockMinute) {
          hud.clockMinute = m;
          const hours = Math.floor(m / 60) % 24;
          const mins = m % 60;
          hud.clockText =
            String(hours).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
        }
      } else if (clock && typeof clock.hour === 'number'
        && typeof clock.minute === 'number') {
        const m = Math.floor(clock.hour) * 60 + Math.floor(clock.minute);
        if (m !== hud.clockMinute) {
          hud.clockMinute = m;
          hud.clockText = String(Math.floor(clock.hour) % 24).padStart(2, '0')
            + ':' + String(Math.floor(clock.minute) % 60).padStart(2, '0');
        }
      } else if (state && typeof state.timeMinutes === 'number') {
        const m = Math.floor(state.timeMinutes);
        if (m !== hud.clockMinute) {
          hud.clockMinute = m;
          const hours = Math.floor(m / 60) % 24;
          const mins = m % 60;
          hud.clockText =
            String(hours).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
        }
      }
    },

    // Konvensi draw main.js: dipanggil tanpa argumen; HUD digambar di
    // screen-space (resetTransform dulu) dengan ukuran CSS dari renderer.
    draw(ctxArg, cameraArg) {
      const r = state && state.renderer;
      const ctx = ctxArg || (r && r.ctx);
      if (!ctx) return;
      if (!ctxArg && r && typeof r.resetTransform === 'function') r.resetTransform();
      const size = (r && typeof r.getSize === 'function') ? r.getSize() : null;
      const w = size ? size.viewW : (ctx.canvas ? ctx.canvas.width : 1280);
      const h = size ? size.viewH : (ctx.canvas ? ctx.canvas.height : 720);
      // Canvas is scaled by devicePixelRatio by the engine, so CSS-pixel
      // layout uses the logical size stored on the state when available.
      const vw = (state && state.viewWidth) || w;
      const vh = (state && state.viewHeight) || h;
      const p = state && state.player ? state.player : null;
      const scale = vw >= 1600 ? 1.15 : vw <= 900 ? 0.85 : 1;

      hud._drawStatus(ctx, p, vw, scale);
      hud._drawWanted(ctx, p, vw, scale);
      hud._drawCash(ctx, p, vw, scale);
      hud._drawAmmo(ctx, p, vw, vh, scale);
      hud._drawObjective(ctx, vw, scale);
      hud._drawSpeed(ctx, p, vw, vh, scale);
      hud._drawClock(ctx, vw, scale);
    },

    _panel(ctx, x, y, pw, ph, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha == null ? 0.55 : alpha;
      ctx.fillStyle = '#0a0f1e';
      ctx.beginPath();
      ctx.roundRect(x, y, pw, ph, 8);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(120, 220, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    },

    _bar(ctx, x, y, bw, bh, frac, fill, glow) {
      const f = Math.max(0, Math.min(1, frac));
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.beginPath();
      ctx.roundRect(x, y, bw, bh, bh / 2);
      ctx.fill();
      if (f > 0) {
        ctx.fillStyle = fill;
        if (glow) {
          ctx.shadowColor = fill;
          ctx.shadowBlur = 8;
        }
        ctx.beginPath();
        ctx.roundRect(x + 1, y + 1, Math.max(bh - 2, (bw - 2) * f), bh - 2, (bh - 2) / 2);
        ctx.fill();
      }
      ctx.restore();
    },

    _drawStatus(ctx, p, vw, scale) {
      const x = 16 * scale;
      const y = 14 * scale;
      const bw = 220 * scale;
      const health = p && typeof p.health === 'number' ? p.health : 100;
      const maxHealth = p && typeof p.maxHealth === 'number' ? p.maxHealth : 100;
      const armor = p && typeof p.armor === 'number' ? p.armor : 0;
      const maxArmor = p && typeof p.maxArmor === 'number' ? p.maxArmor : 100;
      const low = health / Math.max(1, maxHealth) < 0.25;
      const pulse = low ? 0.6 + 0.4 * Math.sin(hud.blink * 6) : 1;

      hud._panel(ctx, x - 6 * scale, y - 6 * scale, bw + 12 * scale, 74 * scale);
      ctx.save();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = '700 ' + Math.round(13 * scale) + 'px system-ui, sans-serif';
      ctx.fillStyle = '#e8f6ff';
      ctx.fillText('JAX MORENO', x, y + 9 * scale);
      ctx.globalAlpha = pulse;
      ctx.font = '700 ' + Math.round(11 * scale) + 'px system-ui, sans-serif';
      ctx.fillStyle = '#7dffb0';
      ctx.fillText('HP', x, y + 27 * scale);
      hud._bar(ctx, x + 26 * scale, y + 20 * scale, bw - 26 * scale, 13 * scale,
        health / Math.max(1, maxHealth), low ? '#ff4d5e' : '#37e08a', true);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#8fd8ff';
      ctx.fillText('ARMOR', x, y + 46 * scale);
      hud._bar(ctx, x + 26 * scale, y + 39 * scale, bw - 26 * scale, 13 * scale,
        armor / Math.max(1, maxArmor), '#4da6ff', false);
      ctx.fillStyle = 'rgba(232, 246, 255, 0.75)';
      ctx.font = '600 ' + Math.round(11 * scale) + 'px system-ui, sans-serif';
      ctx.fillText(Math.round(health) + ' / ' + Math.round(maxHealth),
        x + bw - 52 * scale, y + 27 * scale);
      ctx.restore();
    },

    _drawWanted(ctx, p, vw, scale) {
      // Wanted tinggal di state.wanted (angka 0-5, milik police.js),
      // bukan di player.
      const wanted = state && typeof state.wanted === 'number'
        ? Math.max(0, Math.min(5, Math.round(state.wanted)))
        : (p && typeof p.wanted === 'number'
          ? Math.max(0, Math.min(5, Math.round(p.wanted))) : 0);
      const cx = vw / 2;
      const y = 20 * scale;
      const starR = 13 * scale;
      const gap = 34 * scale;
      const total = 5 * gap - (gap - starR * 2);
      const x0 = cx - total / 2;
      const flash = wanted >= 3 ? 0.55 + 0.45 * Math.sin(hud.blink * 5) : 1;
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#0a0f1e';
      ctx.beginPath();
      ctx.roundRect(x0 - 14 * scale, y - 16 * scale, total + 28 * scale, 34 * scale, 8);
      ctx.fill();
      ctx.globalAlpha = 1;
      for (let i = 0; i < 5; i++) {
        const sx = x0 + starR + i * gap;
        hud._star(ctx, sx, y + 1 * scale, starR,
          i < wanted ? (wanted >= 3 ? '#ffb02e' : '#ffd94d') : 'rgba(255,255,255,0.18)',
          i < wanted ? flash : 1);
      }
      ctx.restore();
    },

    _star(ctx, cx, cy, r, color, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      if (color !== 'rgba(255,255,255,0.18)') {
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
      }
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 === 0 ? r : r * 0.45;
        const px = cx + Math.cos(ang) * rad;
        const py = cy + Math.sin(ang) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },

    _drawCash(ctx, p, vw, scale) {
      const cash = p && typeof p.cash === 'number' ? Math.floor(p.cash) : 0;
      const text = '$' + cash.toLocaleString('en-US');
      ctx.save();
      ctx.font = '800 ' + Math.round(20 * scale) + 'px system-ui, sans-serif';
      const tw = ctx.measureText(text).width;
      const x = vw - tw - 28 * scale;
      const y = 14 * scale;
      hud._panel(ctx, x - 10 * scale, y - 4 * scale, tw + 20 * scale, 32 * scale);
      ctx.fillStyle = '#7dffb0';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y + 12 * scale);
      ctx.restore();
    },

    _drawAmmo(ctx, p, vw, vh, scale) {
      // Senjata pemain adalah OBJEK (kontrak state.player.weapon, ditulis
      // combat.js): { name, ammoInMag, magSize, reserveAmmo, reloading }.
      // Fallback: senjata combat saat ini, lalu angka mentah player.
      let weapon = p && p.weapon && typeof p.weapon === 'object' ? p.weapon : null;
      if (!weapon && state && state.combat && state.combat.weapons) {
        const c = state.combat;
        const w = c.weapons[c.current] || c.weapons.pistol;
        if (w) {
          weapon = {
            name: w.name, ammoInMag: w.mag, magSize: w.magSize,
            reserveAmmo: w.reserve, reloading: !!c.reloading,
          };
        }
      }
      if (!weapon && p) {
        weapon = {
          name: 'Pistol', ammoInMag: p.ammo || 0, magSize: 12,
          reserveAmmo: p.reserve || 0, reloading: false,
        };
      }
      const name = weapon && weapon.name ? String(weapon.name).toUpperCase() : 'PISTOL';
      const mag = weapon && typeof weapon.ammoInMag === 'number' ? weapon.ammoInMag : 0;
      const magSize = weapon && typeof weapon.magSize === 'number' ? weapon.magSize : 12;
      const reserve = weapon && typeof weapon.reserveAmmo === 'number' ? weapon.reserveAmmo : 0;
      const reloading = weapon && weapon.reloading;
      const text = reloading ? 'RELOADING…' : mag + ' / ' + reserve;
      ctx.save();
      ctx.font = '800 ' + Math.round(18 * scale) + 'px system-ui, sans-serif';
      const tw = ctx.measureText(text).width;
      const x = vw - tw - 28 * scale;
      const y = vh - 58 * scale;
      hud._panel(ctx, x - 10 * scale, y - 6 * scale, tw + 20 * scale, 34 * scale);
      ctx.fillStyle = reloading ? '#ffb02e' : '#e8f6ff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y + 11 * scale);
      ctx.font = '700 ' + Math.round(11 * scale) + 'px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(232, 246, 255, 0.65)';
      ctx.fillText(name + '  ·  MAG ' + magSize, x, y - 12 * scale);
      ctx.restore();
    },

    _drawObjective(ctx, vw, scale) {
      // state.missions adalah objek internal M (missions.js): current =
      // INDEX angka, objective = { label }, list[index].title.
      const missions = state && state.missions ? state.missions : null;
      const idx = missions && typeof missions.current === 'number' ? missions.current : -1;
      const def = missions && Array.isArray(missions.list) && idx >= 0
        ? missions.list[idx] : null;
      const objLabel = missions && missions.objective && missions.objective.label
        ? String(missions.objective.label) : null;
      const text = objLabel
        || (state && state.objective ? String(state.objective)
          : 'Free roam — cause chaos, earn cash, lose the cops.');
      const title = def && def.title ? String(def.title).toUpperCase() : 'NEON BAY';
      ctx.save();
      ctx.font = '700 ' + Math.round(12 * scale) + 'px system-ui, sans-serif';
      const titleW = ctx.measureText(title).width;
      ctx.font = '600 ' + Math.round(13 * scale) + 'px system-ui, sans-serif';
      const textW = ctx.measureText(text).width;
      const pw = Math.max(titleW, textW) + 24 * scale;
      const x = 16 * scale;
      const y = 96 * scale;
      hud._panel(ctx, x - 6 * scale, y - 6 * scale, pw + 12 * scale, 48 * scale, 0.5);
      ctx.fillStyle = '#ffb02e';
      ctx.font = '700 ' + Math.round(12 * scale) + 'px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('◆ ' + title, x, y + 9 * scale);
      ctx.fillStyle = '#e8f6ff';
      ctx.font = '600 ' + Math.round(13 * scale) + 'px system-ui, sans-serif';
      ctx.fillText(text, x, y + 29 * scale);
      ctx.restore();
    },

    _drawSpeed(ctx, p, vw, vh, scale) {
      const car = p && p.vehicle ? p.vehicle : null;
      if (!car) return;
      const speed = typeof car.speed === 'number' ? Math.abs(car.speed) : 0;
      const kmh = Math.round(speed * 3.6);
      const text = kmh + ' km/h';
      ctx.save();
      ctx.font = '800 ' + Math.round(26 * scale) + 'px system-ui, sans-serif';
      const tw = ctx.measureText(text).width;
      const x = vw - tw - 28 * scale;
      const y = vh - 118 * scale;
      hud._panel(ctx, x - 10 * scale, y - 8 * scale, tw + 20 * scale, 42 * scale);
      ctx.fillStyle = '#e8f6ff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y + 13 * scale);
      ctx.font = '700 ' + Math.round(11 * scale) + 'px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(232, 246, 255, 0.65)';
      const carName = car.type ? String(car.type).toUpperCase()
        : (car.name ? String(car.name).toUpperCase() : 'CAR');
      ctx.fillText(carName, x, y - 14 * scale);
      ctx.restore();
    },

    _drawClock(ctx, vw, scale) {
      ctx.save();
      ctx.font = '700 ' + Math.round(15 * scale) + 'px system-ui, sans-serif';
      const tw = ctx.measureText(hud.clockText).width;
      const x = vw - tw - 28 * scale;
      const y = 56 * scale;
      hud._panel(ctx, x - 10 * scale, y - 4 * scale, tw + 20 * scale, 28 * scale);
      ctx.fillStyle = '#e8f6ff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(hud.clockText, x, y + 10 * scale);
      ctx.restore();
    },
  };
  return hud;
}
