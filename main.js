// =====================================================
// PLACMAN v0 — Obstacles/Cover + Tir sur ESPACE
// - Obstacles en monde: bloquent déplacement + tirs + line-of-sight
// - Tir: ESPACE (hold OK), Dash: SHIFT
// Controls: ZQSD + Flèches | ESPACE: Tirer | SHIFT: Dash | M: Mute | N: Next | E: Wave
// =====================================================

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// ---------------- ASSETS ----------------
const weapon = new Image();
weapon.src = "assets/weapon/slingshot.png";

const riftImg = new Image();
riftImg.src = "assets/fx/rift.png"; // optionnel

// =====================================================
// AUDIO (stable)
// =====================================================
const TRACKS = [
  { name: "Ancestral War Circle", src: "music/Ancestral War Circle.mp3" },
  { name: "Forest Masks at Dusk", src: "music/Forest Masks at Dusk.mp3" },
  { name: "Neon Mask Ritual", src: "music/Neon Mask Ritual.mp3" },
];

let musicEnabled = false;
let isMuted = false;
let trackIndex = 0;
let masterVolume = 0.35;

const audios = TRACKS.map((t) => {
  const a = new Audio(t.src);
  a.loop = true;
  a.preload = "auto";
  a.volume = masterVolume;
  return a;
});

function applyVolume() {
  const v = isMuted ? 0 : masterVolume;
  for (const a of audios) a.volume = v;
}

function stopAllMusic(resetTime = false) {
  for (const a of audios) {
    a.pause();
    if (resetTime) a.currentTime = 0;
  }
}

function updateTrackLabel() {
  const el = document.getElementById("trackName");
  if (!el) return;
  el.textContent = musicEnabled ? `♪ ${TRACKS[trackIndex].name}` : "—";
}

async function playCurrentTrack(forceRestart = false) {
  applyVolume();
  if (!musicEnabled) return;

  const a = audios[trackIndex];

  if (forceRestart) {
    stopAllMusic(true);
  } else {
    for (let i = 0; i < audios.length; i++) {
      if (i !== trackIndex) audios[i].pause();
    }
  }

  if (!a.paused) {
    updateTrackLabel();
    return;
  }

  try { await a.play(); } catch (e) {}
  updateTrackLabel();
}

function nextTrack() {
  trackIndex = (trackIndex + 1) % TRACKS.length;
  if (musicEnabled) playCurrentTrack(true);
  else updateTrackLabel();
}

// UI volume
const vol = document.getElementById("vol");
const volValue = document.getElementById("volValue");
if (vol && volValue) {
  vol.value = String(Math.round(masterVolume * 100));
  volValue.textContent = `${vol.value}%`;
  vol.addEventListener("input", () => {
    masterVolume = Math.max(0, Math.min(1, Number(vol.value) / 100));
    volValue.textContent = `${vol.value}%`;
    applyVolume();
  });
}

const btnMusic = document.getElementById("btnMusic");
const btnNext = document.getElementById("btnNext");

if (btnMusic) {
  btnMusic.addEventListener("click", () => {
    musicEnabled = !musicEnabled;
    btnMusic.textContent = musicEnabled ? "⏸︎ Musique" : "▶︎ Musique";
    if (musicEnabled) playCurrentTrack(false);
    else stopAllMusic(false);
    updateTrackLabel();
  });
}
if (btnNext) btnNext.addEventListener("click", nextTrack);

// =====================================================
// INPUT
// =====================================================
const keys = {};
document.addEventListener("keydown", (e) => {
  keys[e.key] = true;

  if (e.key === "m" || e.key === "M") { isMuted = !isMuted; applyVolume(); }
  if (e.key === "n" || e.key === "N") { nextTrack(); }
  if (e.key === "e" || e.key === "E") { spawnEnemyWave(10); }

  if (pactChoiceActive) {
    if (e.key === "1") pickPact(0);
    if (e.key === "2") pickPact(1);
    if (e.key === "3") pickPact(2);
  }
});
document.addEventListener("keyup", (e) => (keys[e.key] = false));

// Click = seulement pour "débloquer" audio navigateur (pas de tir)
canvas.addEventListener("click", () => {
  if (musicEnabled) playCurrentTrack(false);
});

// =====================================================
// GAME STATE
// =====================================================
let gameActive = true;
let pausedForPact = false;

let aura = 100;
let kills = 0;
let score = 0;
let level = 1;
let enemiesKilledThisLevel = 0;
const ENEMIES_PER_LEVEL = 20;

let playerHP = 100;
const playerMaxHP = 100;

// CAMERA (monde)
let camX = 0;
let camY = 0;

const screenCenterX = () => canvas.width / 2;
const screenCenterY = () => canvas.height / 2;

// Player perks
const perks = {
  auraRegenMult: 1.0,
  piercingShots: false,
  dashCooldownMult: 1.0,
};

// Dash
let dashCooldown = 0;
let dashIFrames = 0;

// Fire rate player (hold space)
let playerShootCD = 0;

// Entities
const projectiles = [];        // player bullets (screen): {x,y,vy,r,pierce}
const enemyProjectiles = [];   // enemy bullets (screen): {x,y,vx,vy,r,kind,dmg}
const particles = [];
const rifts = [];
const enemies = [];
let boss = null;

// Spawn settings
let riftTimer = 0;
const BASE_RIFT_INTERVAL_MIN = 120;
const BASE_RIFT_INTERVAL_MAX = 220;

// Speeds
const PLAYER_SPEED_MULT = 1.25;
const ENEMY_SPEED_MULT = 1.5;
const SHOT_SPEED = -16;

// Rifts
let RIFT_MULTI_SPAWN = 3;

// Map / sensor
const MAP_RANGE = 2200;

// =====================================================
// OBSTACLES / COVER (WORLD)
// rect obstacles: {x,y,w,h, kind}
// =====================================================
const obstacles = [];
let obstacleAnchorCellX = 0;
let obstacleAnchorCellY = 0;
const CELL = 900; // taille “chunk” monde

function rand(min, max) { return Math.random() * (max - min) + min; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function dist(ax, ay, bx, by) { const dx=ax-bx, dy=ay-by; return Math.sqrt(dx*dx+dy*dy); }

function worldToScreen(wx, wy) { return { x: wx - camX, y: wy - camY }; }
function playerWorldPos() { return { x: camX + screenCenterX(), y: camY + screenCenterY() }; }

function rectContainsPoint(r, px, py) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

function rectIntersectsCircle(r, cx, cy, cr) {
  const nx = clamp(cx, r.x, r.x + r.w);
  const ny = clamp(cy, r.y, r.y + r.h);
  const dx = cx - nx, dy = cy - ny;
  return (dx*dx + dy*dy) <= cr*cr;
}

function segmentIntersectsRect(x1,y1,x2,y2,r) {
  // Liang-Barsky (rapide) / version simple param t
  const dx = x2 - x1;
  const dy = y2 - y1;

  let t0 = 0, t1 = 1;

  function clip(p, q) {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  }

  if (
    clip(-dx, x1 - r.x) &&
    clip( dx, r.x + r.w - x1) &&
    clip(-dy, y1 - r.y) &&
    clip( dy, r.y + r.h - y1)
  ) return true;

  return false;
}

function generateObstaclesForCell(cellX, cellY) {
  // déjà généré ?
  const key = `${cellX}:${cellY}`;
  for (const o of obstacles) if (o._cellKey === key) return;

  const baseX = cellX * CELL;
  const baseY = cellY * CELL;

  const count = 10; // densité
  for (let i = 0; i < count; i++) {
    const w = rand(60, 140);
    const h = rand(50, 120);
    const x = baseX + rand(80, CELL - 80 - w);
    const y = baseY + rand(80, CELL - 80 - h);

    // évite de coller un obstacle pile sur le spawn center de départ (zone 0)
    // (ok même si ça spawn proche, ça fait du gameplay)
    obstacles.push({
      x, y, w, h,
      kind: Math.random() < 0.5 ? "rock" : "ruin",
      _cellKey: key
    });
  }
}

function ensureObstaclesAroundPlayer() {
  const p = playerWorldPos();
  const cx = Math.floor(p.x / CELL);
  const cy = Math.floor(p.y / CELL);

  if (cx === obstacleAnchorCellX && cy === obstacleAnchorCellY) return;

  obstacleAnchorCellX = cx;
  obstacleAnchorCellY = cy;

  // génère 3x3 autour
  for (let yy = cy - 1; yy <= cy + 1; yy++) {
    for (let xx = cx - 1; xx <= cx + 1; xx++) {
      generateObstaclesForCell(xx, yy);
    }
  }

  // limite mémoire (garde obstacles proches)
  const keepRadius = 2;
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const ox = Math.floor(obstacles[i].x / CELL);
    const oy = Math.floor(obstacles[i].y / CELL);
    if (Math.abs(ox - cx) > keepRadius || Math.abs(oy - cy) > keepRadius) {
      obstacles.splice(i, 1);
    }
  }
}

// =====================================================
// ENEMY TYPES
// =====================================================
const ENEMY_TYPES = {
  berserker: { color: "rgba(255,80,80,1)", hp: 24, speed: 1.25, canShoot: false },
  shaman:    { color: "rgba(200,120,255,1)", hp: 34, speed: 0.85, canShoot: true,  hasChargedShot: true },
  sprinter:  { color: "rgba(120,255,160,1)", hp: 28, speed: 1.35, canShoot: true,  stopToShoot: true },
  tank:      { color: "rgba(120,160,255,1)", hp: 65, speed: 0.60, canShoot: true }
};

function pickEnemyTypeForLevel() {
  const pool = ["berserker"];
  if (level >= 2) pool.push("sprinter");
  if (level >= 3) pool.push("tank");
  if (level >= 4) pool.push("shaman");
  if (level >= 6) pool.push("berserker", "sprinter");
  return pool[Math.floor(Math.random() * pool.length)];
}

// =====================================================
// SHOOT (player) — ESPACE (hold)
// =====================================================
function shoot() {
  if (!gameActive || pausedForPact) return;
  if (aura <= 0) return;

  aura -= 1;

  projectiles.push({
    x: screenCenterX(),
    y: canvas.height - 140,
    vy: SHOT_SPEED,
    r: 7,
    pierce: perks.piercingShots ? 2 : 0
  });
}

// =====================================================
// MOVEMENT + DASH (SHIFT)
// collision player vs obstacles (world)
// =====================================================
let lastCamX = 0;
let lastCamY = 0;
let idleTimer = 0;
const BASE_AURA_REGEN = 0.035;

function tryMoveCam(dx, dy) {
  // On tente d'abord X puis Y (sliding)
  let nx = camX + dx;
  let ny = camY;

  // player future world pos
  let p = { x: nx + screenCenterX(), y: ny + screenCenterY() };
  const pr = 22;

  let blockedX = false;
  for (const o of obstacles) {
    if (rectIntersectsCircle(o, p.x, p.y, pr)) { blockedX = true; break; }
  }
  if (!blockedX) camX = nx;

  nx = camX;
  ny = camY + dy;
  p = { x: nx + screenCenterX(), y: ny + screenCenterY() };

  let blockedY = false;
  for (const o of obstacles) {
    if (rectIntersectsCircle(o, p.x, p.y, pr)) { blockedY = true; break; }
  }
  if (!blockedY) camY = ny;
}

function updateMovement() {
  if (!gameActive || pausedForPact) return;

  ensureObstaclesAroundPlayer();

  const speed = 4.5 * PLAYER_SPEED_MULT;

  const up    = keys["z"] || keys["Z"] || keys["ArrowUp"];
  const down  = keys["s"] || keys["S"] || keys["ArrowDown"];
  const left  = keys["q"] || keys["Q"] || keys["ArrowLeft"];
  const right = keys["d"] || keys["D"] || keys["ArrowRight"];

  // Dash (SHIFT)
  if (dashCooldown > 0) dashCooldown--;
  if (dashIFrames > 0) dashIFrames--;

  const dashPressed = keys["Shift"] || keys["ShiftLeft"] || keys["ShiftRight"];
  if (dashPressed && dashCooldown <= 0 && (up || down || left || right)) {
    const dashPower = 42;
    let mx = 0, my = 0;
    if (up) my -= 1;
    if (down) my += 1;
    if (left) mx -= 1;
    if (right) mx += 1;
    const d = Math.sqrt(mx*mx + my*my) || 1;

    tryMoveCam((mx/d)*dashPower, (my/d)*dashPower);

    dashIFrames = 18;
    dashCooldown = Math.floor(110 * perks.dashCooldownMult);
    createParticles(screenCenterX(), screenCenterY(), "rgba(255,150,255,0.9)", 14);
  }

  // Normal move (avec collision)
  let dx = 0, dy = 0;
  if (up) dy -= speed;
  if (down) dy += speed;
  if (left) dx -= speed;
  if (right) dx += speed;
  if (dx !== 0 || dy !== 0) tryMoveCam(dx, dy);

  // regen aura
  let regen = BASE_AURA_REGEN * perks.auraRegenMult;
  if (aura < 100) aura += regen;
  aura = clamp(aura, 0, 100);

  // stagnation punish
  const moved = Math.abs(camX - lastCamX) + Math.abs(camY - lastCamY);
  if (moved < 0.18) idleTimer++;
  else idleTimer = 0;

  if (idleTimer > 150) {
    playerHP = clamp(playerHP - 0.10, 0, playerMaxHP);
    aura = clamp(aura - 0.07, 0, 100);
    if (playerHP <= 0) gameActive = false;
  }

  lastCamX = camX;
  lastCamY = camY;

  // Tir ESPACE (hold) + fire rate
  if (playerShootCD > 0) playerShootCD--;
  const firePressed = keys[" "] || keys["Space"] || keys["Spacebar"];
  if (firePressed && playerShootCD <= 0) {
    shoot();
    playerShootCD = 10; // cadence (réglable)
  }
}

// =====================================================
// PARTICLES
// =====================================================
function createParticles(x, y, color, count = 8) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count;
    particles.push({
      x, y,
      vx: Math.cos(angle) * rand(1, 3),
      vy: Math.sin(angle) * rand(1, 3),
      life: 30,
      maxLife: 30,
      r: rand(2, 4),
      color
    });
  }
}
function updateParticles() {
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy;
    p.vx *= 0.98; p.vy *= 0.98;
    p.life--;
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    if (particles[i].life <= 0) particles.splice(i, 1);
  }
}
function drawParticles() {
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = p.life / p.maxLife;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// =====================================================
// BACKGROUND + OBSTACLES DRAW
// =====================================================
function drawBackground() {
  ctx.fillStyle = "#080010";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(255,255,255,0.08)";
  for (let i = 0; i < 120; i++) {
    const wx = i * 53;
    const wy = i * 31;
    const s = worldToScreen(wx, wy);
    const x = ((s.x % (canvas.width + 60)) + (canvas.width + 60)) - 30;
    const y = ((s.y % (canvas.height + 60)) + (canvas.height + 60)) - 30;
    const size = 1 + (i % 3) * 0.5;
    ctx.fillRect(x, y, size, size);
  }

  if (idleTimer > 150) {
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "rgba(255,80,80,1)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }
}

function drawObstacles() {
  for (const o of obstacles) {
    // Convert world rect to screen rect
    const s = worldToScreen(o.x, o.y);
    const rx = s.x, ry = s.y;

    // skip far
    if (rx < -220 || rx > canvas.width + 220 || ry < -220 || ry > canvas.height + 220) continue;

    ctx.save();

    // shadow
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#000";
    ctx.fillRect(rx + 6, ry + o.h - 10, o.w - 6, 10);

    // body
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = (o.kind === "rock") ? "rgba(30,20,45,0.95)" : "rgba(24,14,36,0.95)";
    ctx.fillRect(rx, ry, o.w, o.h);

    // edge highlight
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 2;
    ctx.strokeRect(rx, ry, o.w, o.h);

    // faint rune
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = "rgba(180,80,255,0.8)";
    ctx.beginPath();
    ctx.moveTo(rx + 10, ry + 12);
    ctx.lineTo(rx + o.w - 12, ry + o.h - 14);
    ctx.stroke();

    ctx.restore();
  }
}

// =====================================================
// PROJECTILES (player) + obstacle collision
// =====================================================
function updateProjectiles() {
  for (const p of projectiles) p.y += p.vy;

  // bullet vs obstacles
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const b = projectiles[i];

    // convert bullet to world pos at that screen pixel
    const bwx = camX + b.x;
    const bwy = camY + b.y;

    let hitObstacle = false;
    for (const o of obstacles) {
      if (rectContainsPoint(o, bwx, bwy)) {
        hitObstacle = true;
        // impact fx (screen)
        createParticles(b.x, b.y, "rgba(255,200,255,0.6)", 10);
        break;
      }
    }
    if (hitObstacle) {
      projectiles.splice(i, 1);
      continue;
    }

    if (b.y < -80) projectiles.splice(i, 1);
  }
}

function drawProjectiles() {
  for (const p of projectiles) {
    ctx.save();
    ctx.globalAlpha = 0.95;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
    g.addColorStop(0, "rgba(255,200,255,1)");
    g.addColorStop(0.6, "rgba(200,100,255,1)");
    g.addColorStop(1, "rgba(150,50,200,0.8)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// =====================================================
// RIFTS (inchangé minimal)
// =====================================================
function spawnRift() {
  const wx = rand(camX + 140, camX + canvas.width - 140);
  const wy = rand(camY + 120, camY + canvas.height - 240);

  rifts.push({
    x: wx, y: wy,
    life: 520,
    pulse: rand(0, Math.PI * 2),
    rotation: 0,
    spawnLeft: RIFT_MULTI_SPAWN,
  });
}

function updateRifts() {
  riftTimer--;
  if (riftTimer <= 0) {
    spawnRift();
    const reduction = Math.min(level - 1, 12) * 8;
    const intervalMax = clamp(BASE_RIFT_INTERVAL_MAX - reduction, 80, BASE_RIFT_INTERVAL_MAX);
    const intervalMin = clamp(BASE_RIFT_INTERVAL_MIN - reduction, 50, BASE_RIFT_INTERVAL_MIN);
    riftTimer = Math.floor(rand(intervalMin, intervalMax));
  }

  for (const r of rifts) {
    r.life--;
    r.pulse += 0.08;
    r.rotation += 0.02;

    if (r.life < 480 && r.spawnLeft > 0 && r.life % 22 === 0) {
      r.spawnLeft--;
      spawnEnemyFromRift(r.x + rand(-18, 18), r.y + rand(-18, 18));
    }
  }

  for (let i = rifts.length - 1; i >= 0; i--) {
    if (rifts[i].life <= 0) rifts.splice(i, 1);
  }
}

function drawRifts() {
  for (const r of rifts) {
    const s = worldToScreen(r.x, r.y);
    const t = r.life / 520;
    const size = 34 + (1 - t) * 30 + Math.sin(r.pulse) * 4;

    if (riftImg.complete && riftImg.naturalWidth > 0) {
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.drawImage(riftImg, s.x - size, s.y - size, size * 2, size * 2);
      ctx.restore();
      continue;
    }

    ctx.save();
    ctx.globalAlpha = 0.18 + Math.sin(r.pulse) * 0.05;
    ctx.fillStyle = "rgba(180,80,255,1)";
    ctx.beginPath();
    ctx.arc(s.x, s.y, size + 18, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.70;
    ctx.strokeStyle = "rgba(210,140,255,1)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(s.x, s.y, size, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "rgba(10,0,20,1)";
    ctx.beginPath();
    ctx.arc(s.x, s.y, size * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// =====================================================
// ENEMIES + LOS (obstacles block shots)
// =====================================================
function hasLineOfSightWorld(ax, ay, bx, by) {
  for (const o of obstacles) {
    if (segmentIntersectsRect(ax, ay, bx, by, o)) return false;
  }
  return true;
}

function spawnEnemyFromRift(wx, wy) {
  const typeKey = pickEnemyTypeForLevel();
  const T = ENEMY_TYPES[typeKey];

  enemies.push({
    x: wx, y: wy,
    r: 18,
    type: typeKey,
    color: T.color,
    speed: (T.speed * 0.7) * ENEMY_SPEED_MULT,
    hp: T.hp,
    maxHp: T.hp,
    phase: rand(0, Math.PI * 2),

    canShoot: !!T.canShoot,
    stopToShoot: !!T.stopToShoot,
    hasChargedShot: !!T.hasChargedShot,

    shootCooldown: Math.floor(rand(35, 85)),
    shootRate: Math.floor(rand(55, 110)),

    charging: false,
    chargeTimer: 0,
    chargeMax: 70,
    chargeWindup: 0
  });

  const s = worldToScreen(wx, wy);
  createParticles(s.x, s.y, "rgba(180,80,255,0.9)", 10);
}

function spawnEnemyWave(count = 10) {
  if (!gameActive || pausedForPact) return;
  const p = playerWorldPos();

  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count;
    const distR = rand(450, 850);
    const wx = p.x + Math.cos(a) * distR + rand(-60, 60);
    const wy = p.y + Math.sin(a) * distR + rand(-60, 60);
    spawnEnemyFromRift(wx, wy);
  }
}

function enemyShootLinear(enemy, dx, dy, d, speed = 6.3) {
  const es = worldToScreen(enemy.x, enemy.y);
  enemyProjectiles.push({
    x: es.x, y: es.y,
    vx: (dx / d) * speed,
    vy: (dy / d) * speed,
    r: 5, kind: "linear", dmg: 9
  });
}

function enemyShootCharged(enemy, dx, dy, d) {
  const es = worldToScreen(enemy.x, enemy.y);
  const speed = 7.2;
  enemyProjectiles.push({
    x: es.x, y: es.y,
    vx: (dx / d) * speed,
    vy: (dy / d) * speed,
    r: 9, kind: "charged", dmg: 18
  });
}

function updateShamanShooting(e, dx, dy, d, los) {
  if (!e.charging) {
    e.shootCooldown--;
    if (e.shootCooldown <= 0) {
      const willCharge = Math.random() < 0.35;
      if (willCharge && d < 1400 && los) {
        e.charging = true;
        e.chargeTimer = e.chargeMax;
        e.chargeWindup = 0;
      } else {
        if (d < 1200 && los) enemyShootLinear(e, dx, dy, d, 6.0);
        e.shootCooldown = e.shootRate;
      }
    }
  } else {
    e.chargeTimer--;
    e.chargeWindup = clamp(e.chargeWindup + 1, 0, e.chargeMax);
    if (e.chargeTimer <= 0) {
      if (los) enemyShootCharged(e, dx, dy, d);
      e.charging = false;
      e.shootCooldown = Math.floor(rand(70, 130));
    }
  }
}

function enemyAvoidObstacles(e, nx, ny) {
  // Si collision, essaie de "glisser" perpendiculaire
  for (const o of obstacles) {
    if (rectIntersectsCircle(o, nx, ny, e.r)) {
      return true;
    }
  }
  return false;
}

function updateEnemies() {
  if (!gameActive || pausedForPact) return;

  const p = playerWorldPos();

  for (const e of enemies) {
    e.phase += 0.05;

    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.sqrt(dx*dx + dy*dy) || 1;

    // move
    let moveFactor = 1.0;
    if (e.stopToShoot && d < 520) {
      if (e.shootCooldown < 18) moveFactor = 0.2;
    }

    const vx = (dx / d) * e.speed * moveFactor;
    const vy = (dy / d) * e.speed * moveFactor;

    // tentative de déplacement + évitement simple
    let nx = e.x + vx;
    let ny = e.y + vy;

    if (enemyAvoidObstacles(e, nx, ny)) {
      // try slide 1
      nx = e.x + (-vy) * 0.9;
      ny = e.y + (vx) * 0.9;
      if (enemyAvoidObstacles(e, nx, ny)) {
        // try slide 2
        nx = e.x + (vy) * 0.9;
        ny = e.y + (-vx) * 0.9;
        if (!enemyAvoidObstacles(e, nx, ny)) { e.x = nx; e.y = ny; }
      } else {
        e.x = nx; e.y = ny;
      }
    } else {
      e.x = nx; e.y = ny;
    }

    // wobble
    e.x += Math.sin(e.phase) * 0.20;

    // LOS check (world)
    const los = hasLineOfSightWorld(e.x, e.y, p.x, p.y);

    // shooting
    if (e.canShoot) {
      if (e.hasChargedShot) {
        updateShamanShooting(e, dx, dy, d, los);
      } else {
        e.shootCooldown--;
        if (e.shootCooldown <= 0) {
          if (d < 1200 && los) enemyShootLinear(e, dx, dy, d, 6.4);
          e.shootCooldown = e.shootRate;
        }
      }
    }
  }
}

function drawEnemies() {
  for (const e of enemies) {
    const s = worldToScreen(e.x, e.y);
    if (s.x < -120 || s.x > canvas.width + 120 || s.y < -120 || s.y > canvas.height + 120) continue;

    ctx.save();

    // shadow
    ctx.globalAlpha = 0.20;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + e.r + 5, e.r * 0.8, e.r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // halo
    ctx.globalAlpha = 0.20;
    const halo = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, e.r * 1.9);
    halo.addColorStop(0, e.color.replace("1)", "0.5)"));
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(s.x, s.y, e.r * 1.9, 0, Math.PI * 2);
    ctx.fill();

    // body
    ctx.globalAlpha = 0.95;
    const body = ctx.createRadialGradient(s.x - e.r * 0.25, s.y - e.r * 0.25, 0, s.x, s.y, e.r);
    body.addColorStop(0, "rgba(255,255,255,0.15)");
    body.addColorStop(1, e.color.replace("1)", "0.85)"));
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(s.x, s.y, e.r, 0, Math.PI * 2);
    ctx.fill();

    // charge signal
    if (e.charging) {
      const t = e.chargeWindup / e.chargeMax;
      ctx.globalAlpha = 0.22 + t * 0.35;
      ctx.strokeStyle = "rgba(255,215,0,0.95)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, e.r + 6 + t * 14, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = 0.16 + t * 0.28;
      ctx.fillStyle = "rgba(255,215,0,0.75)";
      ctx.beginPath();
      ctx.arc(s.x, s.y, e.r * 0.55 + t * 8, 0, Math.PI * 2);
      ctx.fill();
    }

    // HP
    const w = 44, h = 6;
    const hpRatio = e.hp / e.maxHp;
    const hpY = s.y - e.r - 16;

    ctx.globalAlpha = 0.70;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(s.x - w/2 - 1, hpY - 1, w + 2, h + 2);

    ctx.globalAlpha = 0.95;
    ctx.fillStyle = hpRatio > 0.5 ? "rgba(180,80,255,0.95)" : "rgba(255,80,80,0.95)";
    ctx.fillRect(s.x - w/2, hpY, w * hpRatio, h);

    ctx.restore();
  }
}

// =====================================================
// Enemy projectiles + obstacle collision
// =====================================================
function updateEnemyProjectiles() {
  for (const p of enemyProjectiles) {
    p.x += p.vx;
    p.y += p.vy;
  }

  for (let i = enemyProjectiles.length - 1; i >= 0; i--) {
    const b = enemyProjectiles[i];

    // obstacle hit?
    const bwx = camX + b.x;
    const bwy = camY + b.y;

    let hitObstacle = false;
    for (const o of obstacles) {
      if (rectContainsPoint(o, bwx, bwy)) {
        hitObstacle = true;
        createParticles(b.x, b.y, "rgba(255,80,120,0.6)", 10);
        break;
      }
    }
    if (hitObstacle) {
      enemyProjectiles.splice(i, 1);
      continue;
    }

    if (b.x < -120 || b.x > canvas.width + 120 || b.y < -120 || b.y > canvas.height + 120) {
      enemyProjectiles.splice(i, 1);
    }
  }
}

function drawEnemyProjectiles() {
  for (const p of enemyProjectiles) {
    ctx.save();

    if (p.kind === "charged") {
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = "rgba(255,215,0,0.9)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 3.4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.globalAlpha = 0.90;
      ctx.fillStyle = "rgba(255,80,120,0.9)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 3.0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

// =====================================================
// COLLISIONS bullets vs enemies + enemy bullets vs player
// =====================================================
function handleHits() {
  for (let pi = projectiles.length - 1; pi >= 0; pi--) {
    const p = projectiles[pi];

    for (let ei = enemies.length - 1; ei >= 0; ei--) {
      const e = enemies[ei];
      const es = worldToScreen(e.x, e.y);
      const d = dist(p.x, p.y, es.x, es.y);

      if (d < p.r + e.r) {
        e.hp -= 20;
        createParticles(es.x, es.y, "rgba(255,100,100,0.9)", 6);

        if (p.pierce > 0) p.pierce--;
        else projectiles.splice(pi, 1);

        if (e.hp <= 0) {
          enemies.splice(ei, 1);
          kills++;
          enemiesKilledThisLevel++;
          score += 100;
          aura = clamp(aura + 6, 0, 100);
          createParticles(es.x, es.y, "rgba(180,80,255,0.9)", 14);

          if (enemiesKilledThisLevel >= ENEMIES_PER_LEVEL) levelUp();
        }
        break;
      }
    }
  }
}

function handleEnemyHitsOnPlayer() {
  if (!gameActive || pausedForPact) return;
  if (dashIFrames > 0) return;

  const px = screenCenterX();
  const py = screenCenterY();
  const pr = 22;

  for (let i = enemyProjectiles.length - 1; i >= 0; i--) {
    const p = enemyProjectiles[i];
    const d = dist(px, py, p.x, p.y);

    if (d < p.r + pr) {
      enemyProjectiles.splice(i, 1);
      playerHP = clamp(playerHP - (p.dmg || 10), 0, playerMaxHP);
      createParticles(px, py, "rgba(255,80,80,0.9)", 10);
      if (playerHP <= 0) gameActive = false;
    }
  }
}

// =====================================================
// PACTS (simple)
// =====================================================
let pactChoiceActive = false;
let currentPacts = null;

function generatePacts() {
  return [
    { title: "PACTE DE RÉGEN", desc: "Aura regen +40%", apply: () => { perks.auraRegenMult *= 1.4; } },
    { title: "PACTE PERCANT", desc: "Tirs traversants (2 cibles)", apply: () => { perks.piercingShots = true; } },
    { title: "PACTE DU VENT", desc: "Dash cooldown -35%", apply: () => { perks.dashCooldownMult *= 0.65; } },
  ];
}

function levelUp() {
  level++;
  enemiesKilledThisLevel = 0;
  aura = 100;
  playerHP = clamp(playerHP + 20, 0, playerMaxHP);
  score += 500;

  RIFT_MULTI_SPAWN = clamp(3 + Math.floor(level / 3), 3, 7);

  currentPacts = generatePacts();
  pactChoiceActive = true;
  pausedForPact = true;

  createParticles(screenCenterX(), screenCenterY(), "rgba(255,215,0,0.85)", 20);
}

function pickPact(index) {
  if (!pactChoiceActive || !currentPacts) return;
  const p = currentPacts[index];
  if (!p) return;
  p.apply();
  pactChoiceActive = false;
  pausedForPact = false;
}

function drawPactOverlay() {
  ctx.save();
  ctx.globalAlpha = 0.80;
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;

  ctx.fillStyle = "rgba(255,215,0,0.95)";
  ctx.font = "bold 22px Arial";
  ctx.textAlign = "center";
  ctx.fillText("CHOISIS UN PACTE (1 / 2 / 3)", canvas.width/2, 90);

  const boxW = 520, boxH = 72, startY = 140;
  for (let i = 0; i < 3; i++) {
    const bx = (canvas.width - boxW) / 2;
    const by = startY + i * (boxH + 16);

    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(bx, by, boxW, boxH);

    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = "rgba(255,215,0,0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, boxW, boxH);

    ctx.globalAlpha = 1;
    ctx.fillStyle = "white";
    ctx.font = "bold 16px Arial";
    ctx.textAlign = "left";
    ctx.fillText(`${i+1}. ${currentPacts[i].title}`, bx + 18, by + 28);

    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = "13px Arial";
    ctx.fillText(currentPacts[i].desc, bx + 18, by + 52);
  }

  ctx.restore();
}

// =====================================================
// HUD / WEAPON / CROSSHAIR
// =====================================================
function drawCrosshair() {
  const cx = screenCenterX();
  const cy = screenCenterY() - 60;

  ctx.save();
  ctx.strokeStyle = "rgba(255,100,255,0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 8, cy); ctx.lineTo(cx - 3, cy);
  ctx.moveTo(cx + 3, cy); ctx.lineTo(cx + 8, cy);
  ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy - 3);
  ctx.moveTo(cx, cy + 3); ctx.lineTo(cx, cy + 8);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,150,255,0.9)";
  ctx.beginPath();
  ctx.arc(cx, cy, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "rgba(255,100,255,0.5)";
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawWeapon() {
  const w = 170;
  const h = 220;
  const x = canvas.width / 2 - w / 2;
  const y = canvas.height - h - 8;

  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(canvas.width / 2, canvas.height - 18, 85, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (weapon.complete && weapon.naturalWidth > 0) {
    ctx.drawImage(weapon, x, y, w, h);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "white";
    ctx.fillText("loading weapon...", x + 20, y + 40);
  }
}

function drawHUD() {
  ctx.save();
  ctx.fillStyle = "white";
  ctx.font = "bold 16px Arial";
  ctx.fillText("AURA: " + Math.floor(aura), 15, 25);
  ctx.fillText("KILLS: " + kills, 15, 50);
  ctx.fillText("SCORE: " + Math.floor(score), 15, 75);
  ctx.fillText("NIVEAU: " + level, 15, 100);

  // aura bar
  const barWidth = 160, barHeight = 12;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(13, 105, barWidth + 4, barHeight + 4);
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.strokeRect(13, 105, barWidth + 4, barHeight + 4);

  const gradient = ctx.createLinearGradient(15, 0, 15 + barWidth, 0);
  gradient.addColorStop(0, "rgba(180,80,255,0.9)");
  gradient.addColorStop(1, "rgba(255,100,200,0.9)");
  ctx.fillStyle = gradient;
  ctx.fillRect(15, 107, barWidth * (aura / 100), barHeight);

  // HP
  const hpW = 160, hpH = 10, hpX = 15, hpY = 150;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(hpX - 2, hpY - 2, hpW + 4, hpH + 4);
  ctx.fillStyle = "rgba(255,80,80,0.85)";
  ctx.fillRect(hpX, hpY, hpW * (playerHP / playerMaxHP), hpH);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.strokeRect(hpX - 2, hpY - 2, hpW + 4, hpH + 4);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "11px Arial";
  ctx.fillText("HP: " + Math.floor(playerHP) + "/" + playerMaxHP, hpX, hpY + 22);

  // info
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "11px Arial";
  ctx.fillText("Dash CD: " + Math.max(0, dashCooldown), 15, hpY + 44);
  ctx.fillText("Progrès: " + enemiesKilledThisLevel + "/" + ENEMIES_PER_LEVEL, 15, hpY + 64);

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillText("ESPACE: tirer | SHIFT: dash", 15, canvas.height - 14);

  ctx.restore();

  if (pactChoiceActive) drawPactOverlay();

  if (!gameActive) {
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "white";
    ctx.font = "bold 28px Arial";
    ctx.textAlign = "center";
    ctx.fillText("GAME OVER", canvas.width / 2, canvas.height / 2 - 10);
    ctx.font = "14px Arial";
    ctx.fillText("Recharge la page pour recommencer", canvas.width / 2, canvas.height / 2 + 20);
    ctx.restore();
  }
}

// =====================================================
// Enemy sensor + minimap (simple)
// =====================================================
function getNearestEnemyInfo() {
  const p = playerWorldPos();
  let best = null;
  let bestD = Infinity;

  for (const e of enemies) {
    const dE = dist(p.x, p.y, e.x, e.y);
    if (dE < bestD) {
      bestD = dE;
      best = { x: e.x, y: e.y, d: dE, label: e.type.toUpperCase() };
    }
  }
  return best;
}

function drawEnemySensorArrow() {
  const info = getNearestEnemyInfo();
  if (!info) return;

  const p = playerWorldPos();
  const dx = info.x - p.x;
  const dy = info.y - p.y;
  const angle = Math.atan2(dy, dx);

  const baseX = canvas.width / 2;
  const baseY = canvas.height - 88;
  const size = clamp(18 + (180 / (info.d + 60)), 18, 40);

  ctx.save();
  ctx.translate(baseX, baseY);
  ctx.rotate(angle);

  ctx.globalAlpha = 0.85;
  ctx.fillStyle = "rgba(255,150,255,0.9)";
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.7, -size * 0.45);
  ctx.lineTo(-size * 0.45, 0);
  ctx.lineTo(-size * 0.7, size * 0.45);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 0.20;
  ctx.beginPath();
  ctx.arc(0, 0, size * 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "12px Arial";
  ctx.textAlign = "center";
  ctx.fillText(`${info.label} ~ ${Math.floor(info.d)}`, canvas.width / 2, canvas.height - 54);
  ctx.restore();
}

function drawMiniMap() {
  const w = 220, h = 70;
  const x = (canvas.width - w) / 2;
  const y = canvas.height - h - 10;

  const p = playerWorldPos();

  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.strokeRect(x, y, w, h);

  function mm(wx, wy) {
    const dx = wx - p.x;
    const dy = wy - p.y;
    const nx = clamp(dx / MAP_RANGE, -1, 1);
    const ny = clamp(dy / MAP_RANGE, -1, 1);
    return {
      mx: x + w / 2 + nx * (w / 2 - 8),
      my: y + h / 2 + ny * (h / 2 - 8),
    };
  }

  // obstacles (petits points)
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  for (const o of obstacles) {
    const c = mm(o.x + o.w/2, o.y + o.h/2);
    ctx.beginPath();
    ctx.arc(c.mx, c.my, 2, 0, Math.PI*2);
    ctx.fill();
  }

  // rifts
  ctx.globalAlpha = 0.8;
  for (const r of rifts) {
    const c = mm(r.x, r.y);
    ctx.fillStyle = "rgba(180,80,255,0.85)";
    ctx.beginPath();
    ctx.arc(c.mx, c.my, 3, 0, Math.PI*2);
    ctx.fill();
  }

  // enemies
  for (const e of enemies) {
    const c = mm(e.x, e.y);
    ctx.fillStyle = "rgba(255,90,90,0.85)";
    ctx.beginPath();
    ctx.arc(c.mx, c.my, 3, 0, Math.PI*2);
    ctx.fill();
  }

  // player
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.arc(x + w/2, y + h/2, 3.5, 0, Math.PI*2);
  ctx.fill();

  ctx.globalAlpha = 0.65;
  ctx.fillStyle = "white";
  ctx.font = "11px Arial";
  ctx.textAlign = "left";
  ctx.fillText("MINI-MAP", x + 8, y + 16);

  ctx.restore();
}

// =====================================================
// MAIN LOOP
// =====================================================
function loop() {
  if (gameActive) {
    updateMovement();
    updateProjectiles();
    updateRifts();
    updateEnemies();
    updateParticles();
    updateEnemyProjectiles();

    handleHits();
    handleEnemyHitsOnPlayer();
  }

  drawBackground();

  // monde
  drawRifts();
  drawObstacles();
  drawEnemies();

  // écran
  drawParticles();
  drawProjectiles();
  drawEnemyProjectiles();

  drawWeapon();
  drawCrosshair();
  drawEnemySensorArrow();
  drawMiniMap();
  drawHUD();

  requestAnimationFrame(loop);
}

// init
riftTimer = Math.floor(rand(BASE_RIFT_INTERVAL_MIN, BASE_RIFT_INTERVAL_MAX));
ensureObstaclesAroundPlayer();
updateTrackLabel();
loop();
