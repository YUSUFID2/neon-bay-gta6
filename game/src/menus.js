// Neon Bay — start screen, pause menu and game-over / busted / wasted
// screens. All screens are drawn on the canvas; buttons respond to the
// mouse and to keyboard selection (arrows + Enter). The shared state
// carries menus.screen: 'title' | 'playing' | 'paused' | 'gameover',
// plus menus.endKind ('wasted' | 'busted' | 'complete') and the callbacks
// the integrator wires in (onNewGame, onContinue, onResume, onRestart,
// onSave, onQuitToTitle). Self-contained: no sibling imports.

export function createMenus(state) {
  const menus = {
    // Currently visible screen.
    screen: 'title',
    // 'wasted' | 'busted' | 'complete' — meaningful on the gameover screen.
    endKind: 'wasted',
    // Index of the keyboard-selected button on the current screen.
    selected: 0,
    // Buttons laid out by the last draw call: {label, x, y, w, h, action}.
    buttons: [],
    // Mouse position in CSS pixels, updated by the integrator via
    // menus.setMouse(x, y) or by state.mouse when present.
    mouseX: -1,
    mouseY: -1,
    // Button under the mouse, or -1.
    hover: -1,
    // Seconds since the current screen opened (for fade-in animation).
    screenTime: 0,
    // Message shown briefly after an action, e.g. "Game saved".
    notice: '',
    noticeTime: 0,

    showScreen(name) {
      const allowed = ['title', 'playing', 'paused', 'gameover'];
      if (allowed.indexOf(name) === -1) return;
      menus.screen = name;
      menus.selected = 0;
      menus.hover = -1;
      menus.buttons = [];
      menus.screenTime = 0;
      menus.notice = '';
      menus.noticeTime = 0;
      if (state) {
        if (!state.menus) state.menus = {};
        state.menus.screen = name;
        state.menus.endKind = menus.endKind;
      }
    },

    setEndKind(kind) {
      if (kind === 'wasted' || kind === 'busted' || kind === 'complete') {
        menus.endKind = kind;
        if (state && state.menus) state.menus.endKind = kind;
      }
    },

    setMouse(x, y) {
      menus.mouseX = x;
      menus.mouseY = y;
    },

    // Call from the integrator's click handler; returns true if a
    // button consumed the click.
    click(x, y) {
      if (menus.screen === 'playing') return false;
      for (let i = 0; i < menus.buttons.length; i++) {
        const b = menus.buttons[i];
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
          menus._activate(b.action);
          return true;
        }
      }
      return false;
    },

    // Call from the integrator's key handler; returns true if handled.
    key(key) {
      if (menus.screen === 'playing') return false;
      const k = String(key).toLowerCase();
      if (k === 'arrowdown' || k === 's') {
        menus.selected = (menus.selected + 1) % Math.max(1, menus.buttons.length);
        return true;
      }
      if (k === 'arrowup' || k === 'w') {
        menus.selected = (menus.selected - 1 + Math.max(1, menus.buttons.length))
          % Math.max(1, menus.buttons.length);
        return true;
      }
      if (k === 'enter' || k === ' ') {
        const b = menus.buttons[menus.selected];
        if (b) menus._activate(b.action);
        return true;
      }
      if (k === 'escape' || k === 'p') {
        if (menus.screen === 'paused') menus._activate('resume');
        return true;
      }
      if (k === 'm') {
        menus._toggleMute();
        return true;
      }
      return false;
    },

    _toggleMute() {
      if (!state) return;
      state.muted = !state.muted;
      menus.notice = state.muted ? 'Sound muted' : 'Sound on';
      menus.noticeTime = 2;
    },

    _activate(action) {
      const hooks = state && state.menuHooks ? state.menuHooks : {};
      const call = function (name) {
        if (hooks && typeof hooks[name] === 'function') hooks[name]();
      };
      if (action === 'new') {
        call('onNewGame');
        menus.showScreen('playing');
      } else if (action === 'continue') {
        call('onContinue');
        menus.showScreen('playing');
      } else if (action === 'resume') {
        call('onResume');
        menus.showScreen('playing');
      } else if (action === 'restart') {
        call('onRestartMission');
        menus.showScreen('playing');
      } else if (action === 'save') {
        call('onSave');
        const failed = state && state.save && state.save.lastError;
        menus.notice = failed ? 'Save failed — storage unavailable' : 'Game saved';
        menus.noticeTime = 2.5;
      } else if (action === 'quit') {
        call('onQuitToTitle');
        menus.showScreen('title');
      } else if (action === 'retry') {
        call('onRestartMission');
        menus.showScreen('playing');
      } else if (action === 'mute') {
        menus._toggleMute();
      }
    },

    update(dt) {
      menus.screenTime += dt;
      if (menus.noticeTime > 0) menus.noticeTime -= dt;
      if (menus.noticeTime <= 0) menus.notice = '';
      // Keep hover in sync with the mouse (integrator may feed state.mouse).
      const mx = menus.mouseX >= 0 ? menus.mouseX
        : (state && state.mouse && typeof state.mouse.x === 'number' ? state.mouse.x : -1);
      const my = menus.mouseY >= 0 ? menus.mouseY
        : (state && state.mouse && typeof state.mouse.y === 'number' ? state.mouse.y : -1);
      menus.hover = -1;
      if (mx >= 0 && my >= 0) {
        for (let i = 0; i < menus.buttons.length; i++) {
          const b = menus.buttons[i];
          if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
            menus.hover = i;
            break;
          }
        }
      }
    },

    // Konvensi draw main.js: dipanggil tanpa argumen; menu digambar di
    // screen-space (resetTransform dulu) dengan ukuran CSS dari renderer.
    draw(ctxArg, cameraArg) {
      const r = state && state.renderer;
      const ctx = ctxArg || (r && r.ctx);
      if (!ctx) return;
      if (!ctxArg && r && typeof r.resetTransform === 'function') r.resetTransform();
      if (menus.screen === 'playing') return;
      const size = (r && typeof r.getSize === 'function') ? r.getSize() : null;
      const vw = (state && state.viewWidth) || (size ? size.viewW : (ctx.canvas ? ctx.canvas.width : 1280));
      const vh = (state && state.viewHeight) || (size ? size.viewH : (ctx.canvas ? ctx.canvas.height : 720));
      const fade = Math.min(1, menus.screenTime / 0.35);
      ctx.save();
      ctx.globalAlpha = fade;
      if (menus.screen === 'title') menus._drawTitle(ctx, vw, vh);
      else if (menus.screen === 'paused') menus._drawPaused(ctx, vw, vh);
      else if (menus.screen === 'gameover') menus._drawGameOver(ctx, vw, vh);
      if (menus.notice) {
        ctx.globalAlpha = Math.min(1, menus.noticeTime);
        ctx.font = '700 15px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#7dffb0';
        ctx.fillText(menus.notice, vw / 2, vh - 36);
      }
      ctx.restore();
    },

    _dim(ctx, vw, vh, alpha) {
      ctx.fillStyle = 'rgba(4, 8, 18, ' + alpha + ')';
      ctx.fillRect(0, 0, vw, vh);
    },

    _layoutButtons(ctx, vw, vh, labels, startY, gap) {
      menus.buttons = [];
      const bw = 320;
      const bh = 46;
      const x = (vw - bw) / 2;
      for (let i = 0; i < labels.length; i++) {
        menus.buttons.push({
          label: labels[i].label,
          action: labels[i].action,
          x: x,
          y: startY + i * gap,
          w: bw,
          h: bh,
        });
      }
      return menus.buttons;
    },

    _drawButtons(ctx) {
      for (let i = 0; i < menus.buttons.length; i++) {
        const b = menus.buttons[i];
        const active = i === menus.selected || i === menus.hover;
        ctx.save();
        ctx.fillStyle = active ? 'rgba(255, 176, 46, 0.92)' : 'rgba(10, 18, 34, 0.85)';
        ctx.beginPath();
        ctx.roundRect(b.x, b.y, b.w, b.h, 8);
        ctx.fill();
        ctx.strokeStyle = active ? '#ffd94d' : 'rgba(120, 220, 255, 0.45)';
        ctx.lineWidth = active ? 2 : 1;
        ctx.stroke();
        ctx.fillStyle = active ? '#0a0f1e' : '#e8f6ff';
        ctx.font = '700 17px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
        ctx.restore();
      }
    },

    _drawTitle(ctx, vw, vh) {
      menus._dim(ctx, vw, vh, 0.62);
      const cx = vw / 2;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Neon title.
      ctx.shadowColor = '#ff2fb3';
      ctx.shadowBlur = 28;
      ctx.fillStyle = '#ff7ad9';
      ctx.font = '900 ' + Math.round(Math.min(84, vw * 0.07)) + 'px system-ui, sans-serif';
      ctx.fillText('NEON BAY', cx, vh * 0.22);
      ctx.shadowColor = '#37e0ff';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#8fe8ff';
      ctx.font = '700 20px system-ui, sans-serif';
      ctx.fillText('A NEON BAY CRIME STORY', cx, vh * 0.22 + 58);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(232, 246, 255, 0.75)';
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillText('Jax Moreno is back in town — broke, and in debt to Rosa.',
        cx, vh * 0.22 + 92);

      const hasSave = state && state.save && typeof state.save.hasSave === 'function'
        ? state.save.hasSave() : false;
      const items = [{ label: 'NEW GAME', action: 'new' }];
      if (hasSave) items.push({ label: 'CONTINUE', action: 'continue' });
      const muted = state && state.muted;
      items.push({ label: muted ? 'SOUND: MUTED  (M)' : 'SOUND: ON  (M)', action: 'mute' });
      const startY = vh * 0.46;
      menus._layoutButtons(ctx, vw, vh, items, startY, 58);
      menus._drawButtons(ctx);

      // Controls list.
      const controls = [
        'WASD / Arrows — walk      Shift — sprint      E — enter / exit car',
        'F — steal car      Mouse — aim      Click — shoot      R — reload',
        'Space — handbrake      Esc / P — pause      M — mute',
      ];
      ctx.fillStyle = 'rgba(232, 246, 255, 0.7)';
      ctx.font = '600 14px system-ui, sans-serif';
      for (let i = 0; i < controls.length; i++) {
        ctx.fillText(controls[i], cx, vh * 0.46 + items.length * 58 + 30 + i * 24);
      }
      ctx.fillStyle = 'rgba(232, 246, 255, 0.4)';
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillText('↑ ↓ select   ·   Enter confirm   ·   Click buttons with the mouse',
        cx, vh - 24);
      ctx.restore();
    },

    _drawPaused(ctx, vw, vh) {
      menus._dim(ctx, vw, vh, 0.55);
      const cx = vw / 2;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#e8f6ff';
      ctx.font = '900 44px system-ui, sans-serif';
      ctx.fillText('PAUSED', cx, vh * 0.24);
      const items = [
        { label: 'RESUME', action: 'resume' },
        { label: 'RESTART MISSION', action: 'restart' },
        { label: 'SAVE GAME', action: 'save' },
        { label: 'QUIT TO TITLE', action: 'quit' },
      ];
      menus._layoutButtons(ctx, vw, vh, items, vh * 0.36, 58);
      menus._drawButtons(ctx);
      ctx.restore();
    },

    _drawGameOver(ctx, vw, vh) {
      const kind = menus.endKind;
      const isComplete = kind === 'complete';
      menus._dim(ctx, vw, vh, isComplete ? 0.45 : 0.68);
      const cx = vw / 2;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const p = state && state.player ? state.player : null;
      let title = 'WASTED';
      let color = '#ff4d5e';
      let sub = 'Jax went down. The hospital bill stings.';
      if (kind === 'busted') {
        title = 'BUSTED';
        color = '#4da6ff';
        sub = 'The cops caught Jax. Bail took a bite out of the cash.';
      } else if (isComplete) {
        title = 'MISSION COMPLETE';
        color = '#7dffb0';
        sub = 'Rosa is pleased. The payout is in the pocket.';
      }
      ctx.shadowColor = color;
      ctx.shadowBlur = 24;
      ctx.fillStyle = color;
      ctx.font = '900 56px system-ui, sans-serif';
      ctx.fillText(title, cx, vh * 0.26);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(232, 246, 255, 0.85)';
      ctx.font = '600 16px system-ui, sans-serif';
      ctx.fillText(sub, cx, vh * 0.26 + 48);
      if (p && typeof p.cash === 'number') {
        ctx.fillStyle = '#7dffb0';
        ctx.font = '800 20px system-ui, sans-serif';
        ctx.fillText('CASH  $' + Math.floor(p.cash).toLocaleString('en-US'),
          cx, vh * 0.26 + 84);
      }
      const items = isComplete
        ? [{ label: 'CONTINUE', action: 'resume' }, { label: 'QUIT TO TITLE', action: 'quit' }]
        : [{ label: 'RETRY MISSION', action: 'retry' }, { label: 'QUIT TO TITLE', action: 'quit' }];
      menus._layoutButtons(ctx, vw, vh, items, vh * 0.46, 58);
      menus._drawButtons(ctx);
      ctx.restore();
    },
  };
  // Mirror the initial screen onto the shared state for the integrator.
  if (state) {
    if (!state.menus) state.menus = {};
    state.menus.screen = menus.screen;
    state.menus.endKind = menus.endKind;
  }
  return menus;
}
