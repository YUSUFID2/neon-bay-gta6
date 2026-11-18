// Neon Bay — render.js
// Renderer HD: canvas disetel ke viewport x devicePixelRatio (cap 2),
// jadi gambar tetap tajam di 1920x1080, 1280x720, dan layar HiDPI.
// Semua gambar adalah bentuk vektor tajam — tidak ada sprite buram.

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const camera = { x: 0, y: 0, zoom: 1 };
  let dpr = 1;
  let viewW = 0; // lebar CSS viewport
  let viewH = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    canvas.style.width = viewW + 'px';
    canvas.style.height = viewH + 'px';
  }

  window.addEventListener('resize', resize);
  resize();

  function setCamera(x, y, zoom) {
    camera.x = x;
    camera.y = y;
    if (zoom !== undefined) camera.zoom = zoom;
  }

  // Terapkan transform kamera: dunia -> layar.
  function applyCamera() {
    ctx.setTransform(
      dpr * camera.zoom, 0, 0, dpr * camera.zoom,
      dpr * (viewW / 2 - camera.x * camera.zoom),
      dpr * (viewH / 2 - camera.y * camera.zoom),
    );
  }

  // Kembali ke koordinat layar (untuk HUD / menu).
  function resetTransform() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function clear(color) {
    resetTransform();
    ctx.fillStyle = color || '#0b0e1a';
    ctx.fillRect(0, 0, viewW, viewH);
  }

  function screenToWorld(sx, sy) {
    return {
      x: (sx - viewW / 2) / camera.zoom + camera.x,
      y: (sy - viewH / 2) / camera.zoom + camera.y,
    };
  }

  function worldToScreen(wx, wy) {
    return {
      x: (wx - camera.x) * camera.zoom + viewW / 2,
      y: (wy - camera.y) * camera.zoom + viewH / 2,
    };
  }

  // --- Helper gambar vektor (koordinat dunia, setelah applyCamera) ---

  function rect(x, y, w, h, color, stroke) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
    }
  }

  function roundRect(x, y, w, h, r, color, stroke) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  function circle(x, y, r, color, stroke) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  function line(x1, y1, x2, y2, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function poly(points, color, stroke) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  function ellipse(x, y, rx, ry, color, stroke) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // Bintang 5 sudut (untuk indikator wanted di dunia/HUD).
  function star(cx, cy, rOuter, rInner, color) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? rOuter : rInner;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  // Teks tajam: ukuran font diskalakan dengan zoom dunia bila diminta.
  function text(str, x, y, opts) {
    const o = opts || {};
    const size = o.size || 14;
    ctx.font = (o.bold ? '700 ' : '') + size + 'px system-ui, sans-serif';
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.baseline || 'alphabetic';
    if (o.glow) {
      ctx.shadowColor = o.glow;
      ctx.shadowBlur = o.glowBlur || 12;
    } else {
      ctx.shadowBlur = 0;
    }
    ctx.fillStyle = o.color || '#f2f5ff';
    ctx.fillText(str, x, y);
    ctx.shadowBlur = 0;
  }

  function textWidth(str, size, bold) {
    ctx.font = (bold ? '700 ' : '') + (size || 14) + 'px system-ui, sans-serif';
    return ctx.measureText(str).width;
  }

  function getSize() {
    return { viewW, viewH, dpr, pixelW: canvas.width, pixelH: canvas.height };
  }

  return {
    canvas,
    ctx,
    camera,
    resize,
    setCamera,
    applyCamera,
    resetTransform,
    clear,
    screenToWorld,
    worldToScreen,
    rect,
    roundRect,
    circle,
    ellipse,
    star,
    line,
    poly,
    text,
    textWidth,
    getSize,
  };
}
