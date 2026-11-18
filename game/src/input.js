// Neon Bay — input.js
// Keyboard + mouse menjadi satu object state yang dibaca main loop.
// Edge-trigger (wasPressed) dibersihkan tiap frame lewat update().

export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set(); // tombol yang baru ditekan sejak frame lalu
  const mouse = {
    x: 0,
    y: 0,          // posisi dalam koordinat CSS canvas
    down: false,
    clicked: false, // klik baru sejak frame lalu
    clickX: 0,
    clickY: 0,
  };

  const PREVENT = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
  ]);

  function onKeyDown(e) {
    if (PREVENT.has(e.code)) e.preventDefault();
    if (!e.repeat) pressed.add(e.code);
    keys.add(e.code);
  }

  function onKeyUp(e) {
    keys.delete(e.code);
  }

  function onBlur() {
    keys.clear();
  }

  function canvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onMouseMove(e) {
    const p = canvasPos(e);
    mouse.x = p.x;
    mouse.y = p.y;
  }

  function onMouseDown(e) {
    const p = canvasPos(e);
    mouse.x = p.x;
    mouse.y = p.y;
    mouse.down = true;
    mouse.clicked = true;
    mouse.clickX = p.x;
    mouse.clickY = p.y;
  }

  function onMouseUp() {
    mouse.down = false;
  }

  function onContextMenu(e) {
    e.preventDefault();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  if (canvas) {
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('contextmenu', onContextMenu);
  }

  function isDown(code) {
    return keys.has(code);
  }

  // True hanya pada frame pertama tombol ditekan.
  function wasPressed(code) {
    return pressed.has(code);
  }

  // Sumbu gerak -1..1 dari WASD / panah.
  function moveAxis() {
    let x = 0;
    let y = 0;
    if (isDown('KeyA') || isDown('ArrowLeft')) x -= 1;
    if (isDown('KeyD') || isDown('ArrowRight')) x += 1;
    if (isDown('KeyW') || isDown('ArrowUp')) y -= 1;
    if (isDown('KeyS') || isDown('ArrowDown')) y += 1;
    if (x !== 0 && y !== 0) {
      const inv = 1 / Math.sqrt(2);
      x *= inv;
      y *= inv;
    }
    return { x, y };
  }

  // Dipanggil main loop di akhir tiap frame: bersihkan edge-trigger.
  function update() {
    pressed.clear();
    mouse.clicked = false;
  }

  // refresh() — dipanggil main loop di AWAL tiap frame, sebelum modul
  // lain update. Menurunkan tombol mentah menjadi field datar yang dibaca
  // modul gameplay (vehicles, combat): up/down/left/right, handbrake,
  // firing/mouseDown, reload, enterPressed/stealPressed/exitPressed,
  // switchWeapon, aim. Field-field ini polos (bukan getter) supaya modul
  // boleh mengonsumsinya (mis. combat mengosongkan reload/switchWeapon
  // setelah dipakai) tanpa melempar di strict mode. `inCar` membedakan
  // E = masuk mobil (jalan kaki) vs E = keluar mobil (mengemudi).
  function refresh(inCar) {
    api.up = isDown('KeyW') || isDown('ArrowUp');
    api.down = isDown('KeyS') || isDown('ArrowDown');
    api.left = isDown('KeyA') || isDown('ArrowLeft');
    api.right = isDown('KeyD') || isDown('ArrowRight');
    api.handbrake = isDown('Space');
    api.firing = mouse.down;
    api.mouseDown = mouse.down;
    api.reload = wasPressed('KeyR');
    const ePressed = wasPressed('KeyE');
    api.enterPressed = ePressed && !inCar;
    api.exitPressed = ePressed && !!inCar;
    api.stealPressed = wasPressed('KeyF');
    if (wasPressed('Digit1')) api.switchWeapon = 'pistol';
    else if (wasPressed('Digit2')) api.switchWeapon = 'shotgun';
    else if (wasPressed('KeyQ')) api.switchWeapon = 'cycle';
    else api.switchWeapon = null;
    api.aim = { x: mouse.x, y: mouse.y };
    return api;
  }

  const api = {
    keys,
    mouse,
    isDown,
    wasPressed,
    moveAxis,
    update,
    refresh,
    consumeClick,
    destroy,
    // Field datar untuk modul gameplay; diisi refresh() tiap frame.
    up: false,
    down: false,
    left: false,
    right: false,
    handbrake: false,
    firing: false,
    mouseDown: false,
    reload: false,
    enterPressed: false,
    stealPressed: false,
    exitPressed: false,
    switchWeapon: null,
    aim: { x: 0, y: 0 },
  };

  // Ambil + bersihkan satu klik (dipakai menu: satu klik = satu aksi).
  function consumeClick() {
    if (!mouse.clicked) return null;
    mouse.clicked = false;
    return { x: mouse.clickX, y: mouse.clickY };
  }

  function destroy() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    if (canvas) {
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
    }
  }

  return api;
}
