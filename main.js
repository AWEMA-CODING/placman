// =====================================
// PLACMAN v0 — Audio ULTRA léger (1 Audio) + Volume
// Controls: ZQSD + Flèches | Clic: Tirer | M: Mute | N: Next | E: wave
// =====================================

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// -------- ASSETS --------
const weapon = new Image();
weapon.src = "assets/weapon/slingshot.png";

const riftImg = new Image();
riftImg.src = "assets/fx/rift.png"; // optionnel

// =====================================
// AUDIO — 1 seule instance (anti-freeze PC lent)
// =====================================
const TRACKS = [
  { name: "Ancestral War Circle", src: "music/Ancestral War Circle.mp3" },
  { name: "Forest Masks at Dusk", src: "music/Forest Masks at Dusk.mp3" },
  { name: "Neon Mask Ritual", src: "music/Neon Mask Ritual.mp3" },
];

let musicEnabled = false;
let isMuted = false;
let trackIndex = 0;
let masterVolume = 0.35;

// Une seule instance Audio
const music = new Audio();
music.loop = true;
music.preload = "none"; // IMPORTANT: ultra léger
music.volume = masterVolume;

function applyVolume() {
  music.volume = isMuted ? 0 : masterVolume;
}

function updateTrackLabel() {
  const el = document.getElementById("trackName");
  if (!el) return;
  el.textContent = musicEnabled ? `♪ ${TRACKS[trackIndex].name}` : "—";
}

async function playCurrentTrack(forceRestart = false) {
  if (!musicEnabled) return;

  applyVolume();

  const targetSrc = TRACKS[trackIndex].src;

  // Si on change de piste, on charge la nouvelle
  const mustLoad = (music.src === "" || !music.src.endsWith(encodeURI(targetSrc)));
  if (mustLoad) {
    // on stop sans reset violent si possible
    try { music.pause(); } catch (e) {}
    music.src = targetSrc;
    // forcer un vrai restart pour une nouvelle piste
    forceRestart = true;
  }

  if (forceRestart) {
    try { music.currentTime = 0; } catch (e) {}
  }

  // Si déjà en lecture, ne touche à rien (évite freeze)
  if (!music.paused && !forceRestart) {
    updateTrackLabel();
    return;
  }

  try {
    await music.play();
  } catch (e) {
    // si le navigateur bloque: il faut un clic sur le bouton Musique
  }

  updateTrackLabel();
}

function pauseMusic() {
  try { music.pause(); } catch (e) {}
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

// boutons
const btnMusic = document.getElementById("btnMusic");
const btnNext = document.getElementById("btnNext");

if (btnMusic) {
  btnMusic.addEventListener("click", async () => {
    musicEnabled = !musicEnabled;
    btnMusic.textContent = musicEnabled ? "⏸︎ Musique" : "▶︎ Musique";
    if (musicEnabled) {
      await playCurrentTrack(false); // reprend sans reset si déjà chargé
    } else {
      pauseMusic(); // pause sans reset
    }
  });
}

if (btnNext) btnNext.addEventListener("click", nextTrack);

// =====================================
// INPUT
// =====================================
const keys = {};
document.addEventListener("keydown", (e) => {
  keys[e.key] = true;

  if (e.key === "m" || e.key === "M") {
    isMuted = !isMuted;
    applyVolume();
  }
  if (e.key === "n" || e.key === "N") {
    nextTrack();
  }
  if (e.key === "e" || e.key === "E") {
    spawnEnemyWave(10);
  }
});
document.addEventListener("keyup", (e) => (keys[e.key] = false));

// IMPORTANT: clic = tirer, mais NE RELANCE JAMAIS la musique ici
canvas.addEventListener("click", () => {
  shoot();
});

// =====================================
// GAME STATE
// =====================================
let gameActive = true;
let aura = 100;
let kills = 0;
let score = 0;
let level = 1;
let enemiesKilledThisLevel = 0;
const ENEMIES_PER_LEVEL = 20;

// PLAYER HP
let playerHP = 10000;
let playerMaxHP = 10000;

// CAMERA (monde)
let camX = 0;
let camY = 0;

const screenCenterX = () => canvas.width / 2;
const screenCenterY = () => canvas.height / 2;

// Projectiles joueur (écran)
const projectiles = [];

// Entities (monde)
let rifts = [];
let enemies = [];

// Projectiles ennemis (écran)
const enemyProjectiles = [];

// spawn
let riftTimer = 0;
const BASE_RIFT_INTERVAL_MIN = 140;
const BASE_RIFT_INTERVAL_MAX = 240;

// SPEED / TEST BOOST
const PLAYER_SPEED_MULT = 1.35;
const ENEMY_SPEED_MULT = 1.6;
const SHOT_SPEED = -16;
const DAMAGE_PER_HIT = 20;
const RIFT_MULTI_SPAWN = 3;

// Particles
const particles = [];

// =====================================
// HELPERS
// =====================================
function rand(min, max) { return Math.random() * (max - min) + min; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function worldToScreen(wx, wy) {
  return { x: wx - camX, y: wy - camY };
}
function playerWorldPos() {
  return { x: camX + screenCenterX(), y: camY + screenCenterY() };
}

// =====================================
// SHOOT (player)
// =====================================
function shoot() {
  if (!gameActive) return;
  if (aura <= 0) return;

  aura -= 1;

  projectiles.push({
    x: screenCenterX(),
    y: canvas.height - 140,
    vy: SHOT_SPEED,
    r: 7
  });
}

// =====================================
// MOVEMENT (caméra) — ZQSD + flèches
// =====================================
let lastCamX = 0;
let lastCamY = 0;
let idleTimer = 0;

function updateMovement() {
  if (!gameActive) return;

  const speed = 4.5 * PLAYER_SPEED_MULT;

  const up    = keys["z"] || keys["Z"] || keys["ArrowUp"];
  const down  = keys["s"] || keys["S"] || keys["ArrowDown"];
  const left  = keys["q"] || keys["Q"] || keys["ArrowLeft"];
  const right = keys["d"] || keys["D"] || keys["ArrowRight"];

  if (up) camY -= speed;
  if (down) camY += speed;
  if (left) camX -= speed;
  if (right) camX += speed;

  // regen aura
  if (aura < 100) aura += 0.03;
  aura = clamp(aura, 0, 100);

  // raison de se déplacer : stagnation
  const moved = Math.abs(camX - lastCamX) + Math.abs(camY - lastCamY);
  if (moved < 0.2) idleTimer++;
  else idleTimer = 0;

  if (idleTimer > 140) {
    playerHP = clamp(playerHP - 0.08, 0, playerMaxHP);
    aura = clamp(aura - 0.05, 0, 100);
    if (playerHP <= 0) gameActive = false;
  }

  lastCamX = camX;
  lastCamY = camY;
}

// =====================================
// PARTICLES
// =====================================
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

// =====================================
// BACKGROUND
// =====================================
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

  ctx.fillStyle = "rgba(255,255,255,0.04)";
  for (let i = 0; i < 60; i++) {
    const wx = i * 97;
    const wy = i * 67;
    const s = worldToScreen(wx, wy);
    const x = ((s.x % canvas.width) + canvas.width) % canvas.width;
    const y = ((s.y % canvas.height) + canvas.height) % canvas.height;
    ctx.fillRect(x, y, 1, 1);
  }

  // indicateur stagnation
  if (idleTimer > 140) {
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "rgba(255,80,80,1)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }
}

// =====================================
// HUD / CROSSHAIR / WEAPON
// =====================================
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

  ctx.globalAlpha = 0.3;
  ctx.fillStyle = "rgba(255,100,255,0.5)";
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHUD() {
  ctx.fillStyle = "white";
  ctx.font = "bold 16px Arial";
  ctx.fillText("AURA: " + Math.floor(aura), 15, 25);
  ctx.fillText("KILLS: " + kills, 15, 50);
  ctx.fillText("SCORE: " + score, 15, 75);
  ctx.fillText("NIVEAU: " + level, 15, 100);

  // aura bar
  const barWidth = 160;
  const barHeight = 12;

  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(13, 105, barWidth + 4, barHeight + 4);

  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 1;
  ctx.strokeRect(13, 105, barWidth + 4, barHeight + 4);

  const gradient = ctx.createLinearGradient(15, 0, 15 + barWidth, 0);
  gradient.addColorStop(0, "rgba(180,80,255,0.9)");
  gradient.addColorStop(1, "rgba(255,100,200,0.9)");
  ctx.fillStyle = gradient;
  ctx.fillRect(15, 107, barWidth * (aura / 100), barHeight);

  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "11px Arial";
  ctx.fillText("Progrès: " + enemiesKilledThisLevel + "/" + ENEMIES_PER_LEVEL, 15, 135);

  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "12px Arial";
  ctx.fillText("ZQSD/Flèches | Clic: Tirer | M: Mute | N: Next | E: Wave", 15, canvas.height - 15);

  // HP bar
  const hpW = 160;
  const hpH = 10;
  const hpX = 15;
  const hpY = 150;

  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(hpX - 2, hpY - 2, hpW + 4, hpH + 4);

  ctx.fillStyle = "rgba(255,80,80,0.85)";
  ctx.fillRect(hpX, hpY, hpW * (playerHP / playerMaxHP), hpH);

  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.strokeRect(hpX - 2, hpY - 2, hpW + 4, hpH + 4);

  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "11px Arial";
  ctx.fillText("HP: " + Math.floor(playerHP) + "/" + playerMaxHP, hpX, hpY + 22);
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

// =====================================
// PROJECTILES (player)
// =====================================
function updateProjectiles() {
  for (const p of projectiles) p.y += p.vy;
  for (let i = projectiles.length - 1; i >= 0; i--) {
    if (projectiles[i].y < -50) projectiles.splice(i, 1);
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

    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

// =====================================
// RIFTS
// =====================================
function spawnRift() {
  const wx = rand(camX + 140, camX + canvas.width - 140);
  const wy = rand(camY + 120, camY + canvas.height - 240);

  rifts.push({
    x: wx, y: wy,
    life: 420,
    spawnLeft: RIFT_MULTI_SPAWN,
    pulse: rand(0, Math.PI * 2),
    rotation: 0
  });
}

function updateRifts() {
  riftTimer--;
  if (riftTimer <= 0) {
    spawnRift();
    const reduction = Math.min(level - 1, 10) * 10;
    const intervalMax = BASE_RIFT_INTERVAL_MAX - reduction;
    const intervalMin = BASE_RIFT_INTERVAL_MIN - reduction;
    riftTimer = Math.floor(rand(intervalMin, intervalMax));
  }

  for (const r of rifts) {
    r.life--;
    r.pulse += 0.08;
    r.rotation += 0.02;

    if (r.life < 380 && r.spawnLeft > 0) {
      if (r.life % 25 === 0) {
        r.spawnLeft--;
        spawnEnemyFromRift(r.x + rand(-10, 10), r.y + rand(-10, 10));
      }
    }
  }

  for (let i = rifts.length - 1; i >= 0; i--) {
    if (rifts[i].life <= 0) rifts.splice(i, 1);
  }
}

function drawRifts() {
  for (const r of rifts) {
    const s = worldToScreen(r.x, r.y);
    const t = r.life / 420;
    const size = 36 + (1 - t) * 28 + Math.sin(r.pulse) * 4;
    const glow = 18 + Math.sin(r.pulse * 1.2) * 5;

    // perf: ne draw pas si trop hors écran
    if (s.x < -120 || s.x > canvas.width + 120 || s.y < -120 || s.y > canvas.height + 120) continue;

    if (riftImg.complete && riftImg.naturalWidth > 0) {
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.drawImage(riftImg, s.x - size, s.y - size, size * 2, size * 2);
      ctx.restore();
      continue;
    }

    ctx.save();
    ctx.globalAlpha = 0.15 + Math.sin(r.pulse) * 0.05;
    const gg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, size + glow);
    gg.addColorStop(0, "rgba(180,80,255,0.8)");
    gg.addColorStop(1, "rgba(180,80,255,0)");
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.arc(s.x, s.y, size + glow, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.7;
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

// =====================================
// ENEMIES (chase + tirs simples)
// =====================================
function spawnEnemyFromRift(wx, wy) {
  enemies.push({
    x: wx, y: wy,
    r: 18,
    speed: 0.7 * ENEMY_SPEED_MULT,
    hp: 30,
    maxHp: 30,
    phase: rand(0, Math.PI * 2),
    shootCooldown: Math.floor(rand(25, 70)),
    shootRate: Math.floor(rand(45, 85)),
  });

  const s = worldToScreen(wx, wy);
  createParticles(s.x, s.y, "rgba(180,80,255,0.9)", 10);
}

function spawnEnemyWave(count = 10) {
  if (!gameActive) return;
  const p = playerWorldPos();

  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count;
    const dist = rand(350, 700);
    const wx = p.x + Math.cos(a) * dist + rand(-40, 40);
    const wy = p.y + Math.sin(a) * dist + rand(-40, 40);
    spawnEnemyFromRift(wx, wy);
  }
}

function updateEnemies() {
  const p = playerWorldPos();

  for (const e of enemies) {
    e.phase += 0.05;

    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;

    e.x += (dx / d) * e.speed;
    e.y += (dy / d) * e.speed;
    e.x += Math.sin(e.phase) * 0.2;

    e.shootCooldown--;
    if (e.shootCooldown <= 0) {
      if (d < 1200) enemyShoot(e, dx, dy, d);
      e.shootCooldown = e.shootRate;
    }
  }
}

function drawEnemies() {
  for (const e of enemies) {
    const s = worldToScreen(e.x, e.y);
    if (s.x < -80 || s.x > canvas.width + 80 || s.y < -80 || s.y > canvas.height + 80) continue;

    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + e.r + 5, e.r * 0.8, e.r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.95;
    const bg = ctx.createRadialGradient(s.x - e.r * 0.3, s.y - e.r * 0.3, 0, s.x, s.y, e.r);
    bg.addColorStop(0, "rgba(130,50,180,1)");
    bg.addColorStop(1, "rgba(70,15,100,1)");
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(s.x, s.y, e.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "rgba(200,120,255,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, e.r * 0.6, 0, Math.PI * 2);
    ctx.stroke();

    // HP
    const w = 44, h = 6;
    const hpRatio = e.hp / e.maxHp;
    const hpY = s.y - e.r - 16;

    ctx.globalAlpha = 0.7;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(s.x - w / 2 - 1, hpY - 1, w + 2, h + 2);

    ctx.globalAlpha = 0.9;
    ctx.fillStyle = hpRatio > 0.5 ? "rgba(180,80,255,0.9)" : "rgba(255,80,80,0.9)";
    ctx.fillRect(s.x - w / 2, hpY, w * hpRatio, h);

    ctx.restore();
  }
}

// tirs ennemis: linéaires esquivables
function enemyShoot(enemy, dx, dy, d) {
  const es = worldToScreen(enemy.x, enemy.y);
  const speed = 6.5;

  enemyProjectiles.push({
    x: es.x,
    y: es.y,
    vx: (dx / d) * speed,
    vy: (dy / d) * speed,
    r: 5
  });
}

function updateEnemyProjectiles() {
  for (const p of enemyProjectiles) {
    p.x += p.vx;
    p.y += p.vy;
  }
  for (let i = enemyProjectiles.length - 1; i >= 0; i--) {
    const p = enemyProjectiles[i];
    if (p.x < -80 || p.x > canvas.width + 80 || p.y < -80 || p.y > canvas.height + 80) {
      enemyProjectiles.splice(i, 1);
    }
  }
}
function drawEnemyProjectiles() {
  for (const p of enemyProjectiles) {
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(255,80,120,0.9)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 3.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// =====================================
// COLLISIONS
// =====================================
function handleHits() {
  for (let pi = projectiles.length - 1; pi >= 0; pi--) {
    const p = projectiles[pi];

    for (let ei = enemies.length - 1; ei >= 0; ei--) {
      const e = enemies[ei];
      const es = worldToScreen(e.x, e.y);

      const dx = p.x - es.x;
      const dy = p.y - es.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < p.r + e.r) {
        e.hp -= DAMAGE_PER_HIT;
        projectiles.splice(pi, 1);

        createParticles(es.x, es.y, "rgba(255,100,100,0.9)", 6);

        if (e.hp <= 0) {
          enemies.splice(ei, 1);
          kills++;
          enemiesKilledThisLevel++;
          score += 100;
          aura = clamp(aura + 5, 0, 100);

          createParticles(es.x, es.y, "rgba(180,80,255,0.9)", 14);

          if (enemiesKilledThisLevel >= ENEMIES_PER_LEVEL) levelUp();
        }
        break;
      }
    }
  }
}

function handleEnemyHitsOnPlayer() {
  if (!gameActive) return;

  const px = screenCenterX();
  const py = screenCenterY();
  const pr = 22;

  for (let i = enemyProjectiles.length - 1; i >= 0; i--) {
    const p = enemyProjectiles[i];
    const dx = p.x - px;
    const dy = p.y - py;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < p.r + pr) {
      enemyProjectiles.splice(i, 1);
      playerHP = clamp(playerHP - 10, 0, playerMaxHP);
      createParticles(px, py, "rgba(255,80,80,0.9)", 10);
      if (playerHP <= 0) gameActive = false;
    }
  }
}

// =====================================
// LEVEL UP
// =====================================
function levelUp() {
  level++;
  enemiesKilledThisLevel = 0;
  aura = 100;
  score += 500;

  for (let i = 0; i < 24; i++) {
    createParticles(
      rand(100, canvas.width - 100),
      rand(100, canvas.height - 100),
      "rgba(255,215,0,0.9)",
      4
    );
  }
}

// =====================================
// SENSOR + MINI MAP
// =====================================
function getNearestEnemyInfo() {
  if (enemies.length === 0) return null;
  const p = playerWorldPos();
  let best = null;
  let bestD = Infinity;

  for (const e of enemies) {
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    const d = Math.sqrt(dx*dx + dy*dy);
    if (d < bestD) { bestD = d; best = { e, dx, dy, d }; }
  }
  return best;
}

function drawEnemySensorArrow() {
  const info = getNearestEnemyInfo();
  if (!info) return;

  const angle = Math.atan2(info.dy, info.dx);
  const baseX = canvas.width / 2;
  const baseY = canvas.height - 90;
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
  ctx.fillText("ENEMY ~ " + Math.floor(info.d), canvas.width / 2, canvas.height - 58);
  ctx.restore();
}

const MAP_RANGE = 2200;
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
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);

  function mm(wx, wy) {
    const dx = wx - p.x;
    const dy = wy - p.y;
    const nx = clamp(dx / MAP_RANGE, -1, 1);
    const ny = clamp(dy / MAP_RANGE, -1, 1);
    return {
      mx: x + w / 2 + nx * (w / 2 - 8),
      my: y + h / 2 + ny * (h / 2 - 8),
      clipped: (Math.abs(dx) > MAP_RANGE || Math.abs(dy) > MAP_RANGE)
    };
  }

  for (const r of rifts) {
    const p2 = mm(r.x, r.y);
    ctx.fillStyle = p2.clipped ? "rgba(180,80,255,0.35)" : "rgba(180,80,255,0.85)";
    ctx.beginPath(); ctx.arc(p2.mx, p2.my, 3, 0, Math.PI * 2); ctx.fill();
  }

  for (const e of enemies) {
    const p2 = mm(e.x, e.y);
    ctx.fillStyle = p2.clipped ? "rgba(255,90,90,0.35)" : "rgba(255,90,90,0.85)";
    ctx.beginPath(); ctx.arc(p2.mx, p2.my, 3, 0, Math.PI * 2); ctx.fill();
  }

  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, 3.5, 0, Math.PI * 2); ctx.fill();

  ctx.globalAlpha = 0.65;
  ctx.fillStyle = "white";
  ctx.font = "11px Arial";
  ctx.textAlign = "left";
  ctx.fillText("MINI-MAP", x + 8, y + 16);

  ctx.restore();
}

// =====================================
// MAIN LOOP
// =====================================
function loop() {
  if (gameActive) {
    updateMovement();
    updateProjectiles();
    updateRifts();
    updateEnemies();
    updateParticles();
    handleHits();
    updateEnemyProjectiles();
    handleEnemyHitsOnPlayer();
  }

  drawBackground();
  drawRifts();
  drawEnemies();

  drawParticles();
  drawProjectiles();
  drawEnemyProjectiles();

  drawWeapon();
  drawHUD();
  drawCrosshair();
  drawEnemySensorArrow();
  drawMiniMap();

  requestAnimationFrame(loop);
}

// init
riftTimer = Math.floor(rand(BASE_RIFT_INTERVAL_MIN, BASE_RIFT_INTERVAL_MAX));
updateTrackLabel();
loop();
