'use strict';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const ASSETS = 'assets';

const DESIGN_H = 900;          // virtual design height; everything scales from it
const WALK_SPEED = 320;        // player speed, design px / second
const EDGE_MARGIN = 140;       // how close to a screen edge the player may get
const PLAYER_SCALE = 0.28;    // applied to the 600x1000 source frames

const BTN_SIZE = 140;          // on-screen button diameter, design px
const BTN_MARGIN = 28;         // button distance from screen corners, design px

const GROUND_H = 289;                       // paralax/3.png natural height
const GROUND_Y = DESIGN_H - GROUND_H;       // ground strip sits at page bottom
const FEET_Y = GROUND_Y + 170;              // player's feet on the grass surface
const FAR_LAYER_Y = 0;                    // 1.png offset from the top of the page
const MID_LAYER_Y = 330;                     // 2.png offset from the top of the page

// scroll speed relative to the player/camera: 1.png slowest, 3.png = 1:1
const PARALLAX = { far: 0.15, mid: 0.45, ground: 1.0 };

const ANIM_FPS = { idle: 6, walk: 30 };

// ---------------------------------------------------------------------------
// Asset loading
// ---------------------------------------------------------------------------
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load ' + src));
    img.src = src;
  });
}

// Frame ranges must match the files in assets/animations/<folder>/.
const ANIM_RANGES = {
  idle: { first: 14, last: 85 }, // 0014.png .. 0085.png
  walk: { first: 13, last: 68 }, // 0013.png .. 0068.png
};

function loadFrames(folder) {
  const { first, last } = ANIM_RANGES[folder];
  const attempts = [];
  for (let i = first; i <= last; i++) {
    const name = String(i).padStart(4, '0') + '.png';
    attempts.push(loadImage(`${ASSETS}/animations/${folder}/${name}`));
  }
  return Promise.all(attempts);
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const keys = { left: false, right: false };
const btns = { left: false, right: false };
const btnPointers = new Map(); // pointerId -> 'left' | 'right'

const player = {
  worldX: 0,
  facing: 1,          // 1 = right (native sprite direction), -1 = left
  state: 'idle',
  animTime: 0,
};

let cameraX = 0;
let assets = null;    // { far, mid, ground, banner, anims: { idle: [], walk: [] } }

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

window.addEventListener('keydown', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') { keys.left = true; e.preventDefault(); }
  if (e.code === 'ArrowRight' || e.code === 'KeyD') { keys.right = true; e.preventDefault(); }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
});

// On-screen buttons live in the bottom corners; both are circles.
function buttonGeometry() {
  const scale = canvas.height / DESIGN_H;
  const size = BTN_SIZE * scale;
  const margin = BTN_MARGIN * scale;
  const y = canvas.height - margin - size;
  return {
    size,
    left: { x: margin, y },
    right: { x: canvas.width - margin - size, y },
  };
}

function hitButton(px, py) {
  const g = buttonGeometry();
  const r = g.size / 2;
  for (const side of ['left', 'right']) {
    const cx = g[side].x + r;
    const cy = g[side].y + r;
    if ((px - cx) ** 2 + (py - cy) ** 2 <= r * r) return side;
  }
  return null;
}

canvas.addEventListener('pointerdown', (e) => {
  const side = hitButton(e.clientX, e.clientY);
  if (side) {
    btnPointers.set(e.pointerId, side);
    btns[side] = true;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
});

function releasePointer(e) {
  const side = btnPointers.get(e.pointerId);
  if (side) {
    btnPointers.delete(e.pointerId);
    btns[side] = [...btnPointers.values()].includes(side);
  }
}
canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
function update(dt) {
  const right = keys.right || btns.right;
  const left = keys.left || btns.left;
  const dir = (right ? 1 : 0) - (left ? 1 : 0);

  if (dir !== 0) {
    player.facing = dir;
    if (player.state !== 'walk') { player.state = 'walk'; player.animTime = 0; }
    player.worldX += dir * WALK_SPEED * dt;
  } else if (player.state !== 'idle') {
    player.state = 'idle';
    player.animTime = 0;
  }
  player.animTime += dt;

  // The player moves freely on screen; only when he pushes past an edge
  // margin does the camera (and with it the ground, 1:1) follow him.
  const scale = canvas.height / DESIGN_H;
  const viewW = canvas.width / scale;
  const screenX = player.worldX - cameraX;
  if (screenX < EDGE_MARGIN) cameraX = player.worldX - EDGE_MARGIN;
  else if (screenX > viewW - EDGE_MARGIN) cameraX = player.worldX - (viewW - EDGE_MARGIN);
}

// ---------------------------------------------------------------------------
// Draw
// ---------------------------------------------------------------------------
function drawTiledLayer(img, designY, factor, scale) {
  const w = img.width * scale;
  const h = Math.ceil(img.height * scale);
  const y = Math.round(designY * scale);
  let start = (-cameraX * factor * scale) % w;
  if (start > 0) start -= w;
  // Snap every tile to whole pixels and round its width up so neighbouring
  // tiles overlap by up to 1px instead of leaving a subpixel seam.
  for (let i = 0; start + i * w < canvas.width; i++) {
    const left = start + i * w;
    const x = Math.floor(left);
    ctx.drawImage(img, x, y, Math.ceil(left + w) - x, h);
  }
}

function draw() {
  const scale = canvas.height / DESIGN_H;

  // sky behind everything, matched to 1.png's palette
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, '#8fb6bb');
  sky.addColorStop(1, '#dde6d5');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawTiledLayer(assets.far, FAR_LAYER_Y, PARALLAX.far, scale);  // 1.png, top of page
  drawTiledLayer(assets.mid, MID_LAYER_Y, PARALLAX.mid, scale);  // 2.png, offset down
  drawTiledLayer(assets.ground, GROUND_Y, PARALLAX.ground, scale); // 3.png, walk area

  // player
  const frames = assets.anims[player.state];
  const fps = ANIM_FPS[player.state];
  const frame = frames[Math.floor(player.animTime * fps) % frames.length];
  const pw = frame.width * PLAYER_SCALE * scale;
  const ph = frame.height * PLAYER_SCALE * scale;
  const sx = (player.worldX - cameraX) * scale;

  ctx.save();
  ctx.translate(sx, FEET_Y * scale);
  if (player.facing < 0) ctx.scale(-1, 1);
  ctx.drawImage(frame, -pw / 2, -ph, pw, ph);
  ctx.restore();

  // fixed banner in the middle of the screen (screen space, never scrolls)
  const bw = assets.banner.width * 0.9 * scale;
  const bh = assets.banner.height * 0.9 * scale;
  ctx.drawImage(assets.banner, (canvas.width - bw) / 2, canvas.height * 0.25 - bh / 2, bw, bh);

  // on-screen movement buttons (screen space, never scroll)
  const g = buttonGeometry();
  ctx.drawImage(btns.left ? assets.btnLeftPressed : assets.btnLeft,
    g.left.x, g.left.y, g.size, g.size);
  ctx.drawImage(btns.right ? assets.btnRightPressed : assets.btnRight,
    g.right.x, g.right.y, g.size, g.size);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function drawLoadingScreen(text) {
  ctx.fillStyle = '#8fb6bb';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.font = '24px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  ctx.textAlign = 'left';
}

async function boot() {
  drawLoadingScreen('Loading…');
  try {
    const [far, mid, ground, banner, btnLeft, btnLeftPressed, btnRight, btnRightPressed, idle, walk] = await Promise.all([
      loadImage(`${ASSETS}/paralax/1.png`),
      loadImage(`${ASSETS}/paralax/2.png`),
      loadImage(`${ASSETS}/paralax/3.png`),
      loadImage(`${ASSETS}/static/hb-small.png`),
      loadImage(`${ASSETS}/static/btn-left-normal.png`),
      loadImage(`${ASSETS}/static/btn-left-pressed.png`),
      loadImage(`${ASSETS}/static/btn-right-normal.png`),
      loadImage(`${ASSETS}/static/btn-right-pressed.png`),
      loadFrames('idle'),
      loadFrames('walk'),
    ]);
    assets = { far, mid, ground, banner, btnLeft, btnLeftPressed, btnRight, btnRightPressed, anims: { idle, walk } };
  } catch (err) {
    drawLoadingScreen(err.message);
    return;
  }

  // start with the player in the middle of the screen
  const scale = canvas.height / DESIGN_H;
  cameraX = player.worldX - (canvas.width / scale) / 2;

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(Math.max((now - last) / 1000, 0), 0.05);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot();
