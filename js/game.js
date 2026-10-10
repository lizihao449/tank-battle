/* ============================================================
 * 坦克大战 · 主逻辑  game.js
 * ------------------------------------------------------------
 * 状态机: title → playing ⇄ paused → levelclear / gameover → playing
 * 固定 60Hz 步长更新，渲染跟随 requestAnimationFrame
 * ============================================================ */

const PLAYER_SPAWN = { col: 4, row: 14 };
const ENEMY_SPAWNS = [
  { col: 0, row: 0 },
  { col: 7, row: 0 },
  { col: 15, row: 0 },
];
const BASE_ORIGIN = { col: 7, row: 14 };
const STEP = 1 / 60;

/* ============================================================
 *  地块贴图（离屏预渲染一次，之后 drawImage 复用）
 * ============================================================ */
const TileArt = (function () {
  function make(w, h, paint) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    paint(cv.getContext('2d'), w, h);
    return cv;
  }

  /* 砖：每 16px 一块，两块错缝 */
  const brick = make(TILE, TILE, (ctx) => {
    ctx.fillStyle = '#7a3b22';
    ctx.fillRect(0, 0, TILE, TILE);
    const bw = 16, bh = 8;
    for (let row = 0; row < TILE / bh; row++) {
      const offset = (row % 2) * (bw / 2);
      for (let x = -bw; x < TILE + bw; x += bw) {
        const bx = x + offset;
        ctx.fillStyle = row % 2 ? '#b8552f' : '#a94a28';
        ctx.fillRect(bx + 1, row * bh + 1, bw - 2, bh - 2);
        /* 顶部高光 */
        ctx.fillStyle = 'rgba(255,190,140,0.28)';
        ctx.fillRect(bx + 1, row * bh + 1, bw - 2, 2);
        /* 底部阴影 */
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(bx + 1, row * bh + bh - 3, bw - 2, 2);
      }
    }
    /* 外描边，让砖块边界清晰 */
    ctx.strokeStyle = 'rgba(40,14,6,0.75)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, TILE, TILE);
  });

  /* 钢：金属板 + 铆钉 */
  const steel = make(TILE, TILE, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, TILE, TILE);
    g.addColorStop(0, '#cdd8e6');
    g.addColorStop(0.5, '#8d9bad');
    g.addColorStop(1, '#69778a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, TILE, TILE);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(2, 2, TILE - 4, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(2, TILE - 5, TILE - 4, 3);
    /* 四角铆钉 */
    ctx.fillStyle = '#4a5666';
    for (const [px, py] of [[4, 4], [TILE - 8, 4], [4, TILE - 8], [TILE - 8, TILE - 8]]) {
      ctx.beginPath();
      ctx.arc(px + 2, py + 2, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(30,40,55,0.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, TILE, TILE);
  });

  /* 水：深蓝 + 波纹 */
  const water = make(TILE, TILE, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, TILE);
    g.addColorStop(0, '#123a63');
    g.addColorStop(1, '#0b2545');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, TILE, TILE);
    ctx.strokeStyle = 'rgba(120,200,255,0.42)';
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 3; i++) {
      const y = 7 + i * 9;
      ctx.beginPath();
      ctx.moveTo(3, y);
      ctx.quadraticCurveTo(10, y - 4, 16, y);
      ctx.quadraticCurveTo(23, y + 4, 29, y);
      ctx.stroke();
    }
  });

  /* 冰：淡蓝 + 裂纹 */
  const ice = make(TILE, TILE, (ctx) => {
    ctx.fillStyle = '#cfe9f7';
    ctx.fillRect(0, 0, TILE, TILE);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(0, 0, TILE, 3);
    ctx.strokeStyle = 'rgba(120,180,215,0.75)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(4, 5); ctx.lineTo(13, 15); ctx.lineTo(9, 24); ctx.lineTo(18, 30);
    ctx.moveTo(22, 3); ctx.lineTo(26, 12); ctx.lineTo(20, 20);
    ctx.moveTo(2, 27); ctx.lineTo(11, 26);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(150,200,230,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, TILE - 1, TILE - 1);
  });

  /* 树：画在最上层，半透明 + 抖动感 */
  const tree = make(TILE, TILE, (ctx) => {
    ctx.fillStyle = 'rgba(14,58,28,0.86)';
    ctx.fillRect(0, 0, TILE, TILE);
    const blobs = [[8, 8, 7], [22, 10, 8], [12, 23, 8], [26, 25, 6], [3, 20, 5]];
    for (const [x, y, r] of blobs) {
      ctx.fillStyle = '#1c6b34';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(120,220,120,0.34)';
      ctx.beginPath();
      ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  return { brick, steel, water, ice, tree };
})();

/* ============================================================
 *  游戏主体
 * ============================================================ */
const Game = {
  /* ---------------- 生命周期 ---------------- */
  init() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;

    this.state = 'title';
    this.grid = new Uint8Array(COLS * ROWS);
    this.mask = new Uint8Array(COLS * ROWS);
    this.tanks = [];
    this.bullets = [];
    this.explosions = [];
    this.powerups = [];
    this.player = null;
    this.base = null;
    this.shake = 0;
    this.acc = 0;
    this.last = 0;
    this.highScore = Number(localStorage.getItem('tankBattleHigh') || 0);
    this.flashFreeze = 0;

    /* 全局暂停 / 重开等由这里接管 */
    Input.hooks.onPause = () => this.togglePause();
    Input.hooks.onRestart = () => { if (this.state !== 'title') this.startRun(); };
    Input.hooks.onMute = () => this.toggleSound();
    Input.hooks.onAnyKey = () => Sfx.init();

    /* 标题页背后铺一张第一关的地图当背景板 */
    this.def = LEVELS[0];
    this.enemyQueue = [];
    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.loop = 1;
    this.powerLevel = 0;
    this.buildField(1);

    this.bindUI();
    this.syncHud();
    this.showScreen('title');

    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  },

  bindUI() {
    const on = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', (e) => { e.preventDefault(); Sfx.init(); fn(); });
    };
    on('btn-start', () => this.startRun());
    on('btn-resume', () => this.togglePause());
    on('btn-restart', () => this.startRun());
    on('btn-next', () => this.nextLevel());
    on('btn-sound', () => this.toggleSound());
    on('btn-pause', () => this.togglePause());

    Input.bindTouch();
  },

  /* ---------------- 一局游戏 ---------------- */
  startRun() {
    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.loop = 1;
    this.powerLevel = 0;
    this.kills = 0;
    this.state = 'playing';
    this.hideScreen();
    Sfx.init();
    Sfx.start();
    this.loadLevel(1);
    this.updateSoundBtn();
  },

  /* 只把地图地块铺进 grid —— 标题页也会用它当背景 */
  buildField(n) {
    const def = LEVELS[(n - 1) % LEVELS.length];
    this.grid.fill(T.EMPTY);
    this.mask.fill(0b1111);

    let baseCol = BASE_ORIGIN.col, baseRow = BASE_ORIGIN.row;
    for (let r = 0; r < ROWS; r++) {
      const line = def.map[r] || '';
      for (let c = 0; c < COLS; c++) {
        const ch = line[c] || '.';
        const i = r * COLS + c;
        if (ch === '#') this.grid[i] = T.BRICK;
        else if (ch === '@') this.grid[i] = T.STEEL;
        else if (ch === '~') this.grid[i] = T.WATER;
        else if (ch === 'T') this.grid[i] = T.TREE;
        else if (ch === 'I') this.grid[i] = T.ICE;
        else if (ch === 'E') {
          this.grid[i] = T.BASE;
          baseCol = Math.min(baseCol, c);
          baseRow = Math.min(baseRow, r);
        }
      }
    }

    this.base = new Base(this, baseCol, baseRow);
    this.baseCells = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.grid[r * COLS + c] === T.BASE) this.baseCells.push([c, r]);
      }
    }
  },

  loadLevel(n) {
    const def = LEVELS[(n - 1) % LEVELS.length];
    this.def = def;
    this.buildField(n);

    this.tanks.length = 0;
    this.bullets.length = 0;
    this.explosions.length = 0;
    this.powerups.length = 0;
    this.player = null;
    this.shake = 0;
    this.flashFreeze = 0;
    this.enemyQueue = this.buildQueue(def, this.loop);
    this.totalEnemies = this.enemyQueue.length;
    this.spawnTimer = 1.4;
    this.spawnIndex = 0;
    this.respawnTimer = 0;
    this.shovelTime = 0;
    this.freezeTime = 0;
    this.cleared = false;
    this.baseAlive = true;

    this.spawnPlayer(3.0);
    this.syncHud();
    this.animateLevelBanner();
  },

  nextLevel() {
    this.level++;
    if (this.level > FINAL_LEVEL) { this.level = 1; this.loop++; }
    this.state = 'playing';
    this.hideScreen();
    this.loadLevel(this.level);
  },

  /* 敌人出场顺序：四种型号轮流上，越往后越硬；周目越高数量越多 */
  buildQueue(def, loop) {
    const counts = Object.assign({}, def.enemies);
    const order = ['basic', 'fast', 'power', 'armor'];
    const q = [];
    let guard = 0;
    while (guard++ < 500) {
      let added = false;
      for (const t of order) {
        if (counts[t] > 0) { q.push(t); counts[t]--; added = true; }
      }
      if (!added) break;
    }
    /* 二周目起追加精锐 */
    for (let i = 1; i < loop; i++) {
      for (let k = 0; k < 6; k++) q.push(k % 2 ? 'armor' : 'power');
    }
    return q;
  },

  /* ---------------- 玩家 ---------------- */
  spawnPlayer(shieldSeconds) {
    const p = new Tank(this, {
      side: 'player', type: 'player',
      col: PLAYER_SPAWN.col, row: PLAYER_SPAWN.row, dir: 'up',
    });
    p.powerLevel = this.powerLevel;
    p.maxBullets = this.powerLevel >= 2 ? 2 : 1;
    p.shield = shieldSeconds;
    this.player = p;
    this.tanks.push(p);
    return p;
  },

  /* ---------------- 敌人出场 ---------------- */
  trySpawnEnemy() {
    if (!this.enemyQueue.length) return;
    const alive = this.tanks.filter((t) => t.side === 'enemy' && !t.dead).length;
    if (alive >= this.def.maxOnScreen) return;

    /* 找一个没被占住的出生点 */
    const order = [0, 1, 2];
    if (Math.random() < 0.5) order.reverse();
    for (const i of order) {
      const sp = ENEMY_SPAWNS[i];
      const x = sp.col * TILE + (TILE - TANK_SIZE) / 2;
      const y = sp.row * TILE + (TILE - TANK_SIZE) / 2;
      let blocked = false;
      for (const t of this.tanks) {
        if (t.dead) continue;
        if (aabb(x, y, TANK_SIZE, TANK_SIZE, t.x, t.y, TANK_SIZE)) { blocked = true; break; }
      }
      if (blocked) continue;

      const type = this.enemyQueue.shift();
      const e = new Tank(this, { side: 'enemy', type, col: sp.col, row: sp.row, dir: 'down' });
      /* 每 4 台里面有一台闪红，打掉会掉补给 */
      e.carrying = (this.spawnIndex % 4 === 3);
      this.spawnIndex++;
      this.tanks.push(e);
      if (e.carrying) Sfx.powerupDrop();
      return;
    }
  },

  /* ---------------- 主循环 ---------------- */
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dtMs = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;

    this.acc += dtMs;
    let guard = 0;
    while (this.acc >= STEP && guard++ < 8) {
      this.update(STEP);
      this.acc -= STEP;
    }
    this.render();
  },

  update(dt) {
    if (this.state === 'title' || this.state === 'paused' || this.state === 'gameover') {
      /* 结算画面还让爆炸继续播，视觉上更顺 */
      if (this.state !== 'title') {
        this.stepEffects(dt);
      }
      return;
    }

    if (this.state === 'levelclear') {
      this.stepEffects(dt);
      return;
    }

    /* ---- playing ---- */
    this.stepEffects(dt);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 60);
    if (this.flashFreeze > 0) this.flashFreeze -= dt;

    if (this.base) this.base.update(dt);

    /* 铁锹计时结束 → 变回砖 */
    if (this.shovelTime > 0) {
      this.shovelTime -= dt;
      if (this.shovelTime <= 0) this.restoreBaseWalls();
    }

    /* 时间冻结 */
    if (this.freezeTime > 0) this.freezeTime -= dt;

    for (const t of this.tanks) t.update(dt);
    for (const b of this.bullets) b.update(dt);
    for (const p of this.powerups) p.update(dt);

    this.tanks = this.tanks.filter((t) => !t.dead);
    this.bullets = this.bullets.filter((b) => !b.dead);
    this.explosions = this.explosions.filter((e) => !e.dead);
    this.powerups = this.powerups.filter((p) => !p.dead);

    /* 玩家复活 */
    if (!this.player || this.player.dead) {
      this.player = null;
      if (this.respawnTimer > 0) {
        this.respawnTimer -= dt;
        if (this.respawnTimer <= 0) {
          if (this.lives > 0) {
            this.spawnPlayer(3.0);
          } else {
            this.endGame('阵地失守');
          }
        }
      }
    }

    /* 敌人出场 */
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.trySpawnEnemy();
      this.spawnTimer = rand(1.4, 2.4);
    }

    /* 关卡结束判定 */
    const enemiesLeft = this.enemyQueue.length + this.tanks.filter((t) => t.side === 'enemy').length;
    if (!this.cleared && enemiesLeft === 0 && this.baseAlive) {
      this.cleared = true;
      this.clearTimer = 2.2;
    }
    if (this.cleared && this.state === 'playing') {
      this.clearTimer -= dt;
      if (this.clearTimer <= 0) this.completeLevel();
    }

    this.syncHud();
  },

  stepEffects(dt) {
    for (const e of this.explosions) e.update(dt);
    this.explosions = this.explosions.filter((e) => !e.dead);
  },

  /* ---------------- 世界查询接口（实体层回调） ---------------- */
  tile(c, r) {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return T.STEEL;
    return this.grid[r * COLS + c];
  },

  setTile(c, r, v) {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return;
    this.grid[r * COLS + c] = v;
    if (v === T.BRICK) this.mask[r * COLS + c] = 0b1111;
  },

  /* 子弹啃砖：把子弹覆盖到的 16px 象限打掉 */
  damageBrick(c, r, bullet) {
    const i = r * COLS + c;
    let mk = this.mask[i];
    const bx0 = bullet.x, bx1 = bullet.x + BULLET_SIZE;
    const by0 = bullet.y, by1 = bullet.y + BULLET_SIZE;
    const tx = c * TILE, ty = r * TILE;

    for (let qr = 0; qr < 2; qr++) {
      for (let qc = 0; qc < 2; qc++) {
        const qx0 = tx + qc * 16, qx1 = qx0 + 16;
        const qy0 = ty + qr * 16, qy1 = qy0 + 16;
        if (bx1 > qx0 && bx0 < qx1 && by1 > qy0 && by0 < qy1) {
          mk &= ~(1 << (qr * 2 + qc));
        }
      }
    }
    this.mask[i] = mk;
    if (mk === 0) this.grid[i] = T.EMPTY;
  },

  addExplosion(x, y, size, big) {
    this.explosions.push(new Explosion(x, y, size, big));
    if (big) this.shake = Math.min(14, this.shake + (size > 24 ? 10 : 5));
  },

  /* 敌人是否正对着玩家/基地 —— 决定要不要开火 */
  enemyWantsToFire(t) {
    const targets = [];
    if (this.player && !this.player.dead && this.player.spawning <= 0) targets.push(this.player);
    if (this.base && !this.base.destroyed) targets.push(this.base);

    const d = DIRS[t.dir];
    for (const tg of targets) {
      const dx = tg.cx - t.cx;
      const dy = tg.cy - t.cy;
      if (d.x !== 0) {
        if (Math.abs(dy) < TILE * 0.9 && Math.sign(dx) === Math.sign(d.x) && Math.abs(dx) > 4) return true;
      } else {
        if (Math.abs(dx) < TILE * 0.9 && Math.sign(dy) === Math.sign(d.y) && Math.abs(dy) > 4) return true;
      }
    }
    return false;
  },

  /* ---------------- 事件回调 ---------------- */
  onTankDestroyed(tank) {
    if (tank.side === 'player') {
      this.lives--;
      Sfx.explode();
      this.addExplosion(tank.cx, tank.cy, 34, true);
      this.respawnTimer = 1.3;
      return;
    }

    /* 敌人阵亡 */
    this.score += tank.cfg.score;
    this.kills++;
    Sfx.explode();
    this.addExplosion(tank.cx, tank.cy, tank.type === 'armor' ? 32 : 26, true);

    if (tank.carrying) {
      const type = POWERUP_TYPES[randInt(0, POWERUP_TYPES.length - 1)];
      this.powerups.push(new PowerUp(this, tank.x, tank.y, type));
    }
  },

  baseDestroyed() {
    if (this.base.destroyed) return;
    this.base.destroyed = true;
    this.baseAlive = false;
    Sfx.baseDown();
    this.addExplosion(this.base.cx, this.base.cy, 52, true);
    this.addExplosion(this.base.cx - 18, this.base.cy + 12, 40, true);
    this.shake = 18;
    setTimeout(() => {
      if (this.state === 'playing') this.endGame('老鹰被摧毁');
    }, 900);
  },

  applyPowerUp(type) {
    Sfx.pickup();
    this.score += 500;
    this.lastPower = POWERUP_NAME[type] || type;

    switch (type) {
      case 'star':
        this.powerLevel = Math.min(3, this.powerLevel + 1);
        if (this.player) {
          this.player.powerLevel = this.powerLevel;
          this.player.maxBullets = this.powerLevel >= 2 ? 2 : 1;
        }
        break;
      case 'grenade': {
        let n = 0;
        for (const t of this.tanks.slice()) {
          if (t.side === 'enemy' && !t.dead) { t.die(); n++; }
        }
        this.shake = 16;
        break;
      }
      case 'helmet':
        if (this.player) this.player.shield = 10;
        break;
      case 'shovel':
        this.fortifyBaseWalls();
        break;
      case 'tank':
        this.lives++;
        break;
      case 'clock':
        this.freezeTime = 8;
        this.flashFreeze = 0.35;
        for (const t of this.tanks) {
          if (t.side === 'enemy') t.frozen = 8;
        }
        break;
    }
  },

  /* 基地外围一圈的格子（老鹰占 2x2，往外扩一格就是那圈砖墙） */
  baseWallCells() {
    if (!this.baseCells || !this.baseCells.length) return [];

    let c0 = COLS, c1 = -1, r0 = ROWS, r1 = -1;
    for (const [c, r] of this.baseCells) {
      if (c < c0) c0 = c;
      if (c > c1) c1 = c;
      if (r < r0) r0 = r;
      if (r > r1) r1 = r;
    }

    const cells = [];
    for (let r = r0 - 1; r <= r1 + 1; r++) {
      for (let c = c0 - 1; c <= c1 + 1; c++) {
        if (c < 0 || r < 0 || c >= COLS || r >= ROWS) continue;
        if (this.tile(c, r) === T.BASE) continue;
        cells.push([c, r]);
      }
    }
    return cells;
  },

  fortifyBaseWalls() {
    const cells = this.baseWallCells();
    for (const [c, r] of cells) this.setTile(c, r, T.STEEL);
    this.shovelTime = 18;
  },

  restoreBaseWalls() {
    const cells = this.baseWallCells();
    for (const [c, r] of cells) {
      /* 只在被铁锹改造过的地方还原，别把玩家打通的缺口也补上 */
      if (this.tile(c, r) === T.STEEL) this.setTile(c, r, T.BRICK);
    }
    this.shovelTime = 0;
  },

  /* ---------------- 结算 ---------------- */
  completeLevel() {
    this.state = 'levelclear';
    Sfx.levelClear();
    const bonus = 1000 + this.level * 250;
    this.score += bonus;
    this.saveHigh();

    const last = this.level >= FINAL_LEVEL;
    setText('clear-title', last ? '全部关卡通关！' : `第 ${this.level} 关完成`);
    setText('clear-sub', `${this.def.name} / ${this.def.nameEn}`);
    setText('clear-bonus', `+${bonus}`);
    setText('clear-score', this.score.toLocaleString());
    setText('btn-next', last ? '进入二周目 ▶' : '下一关 ▶');
    this.showScreen('clear');
    this.hideScreen('over');
  },

  endGame(reason) {
    if (this.state === 'gameover') return;
    this.state = 'gameover';
    Sfx.gameOver();
    this.saveHigh();
    setText('over-reason', reason);
    setText('over-score', this.score.toLocaleString());
    setText('over-kills', String(this.kills));
    setText('over-stage', String(this.level));
    setText('over-best', this.highScore.toLocaleString());
    this.showScreen('over');
  },

  saveHigh() {
    if (this.score > this.highScore) {
      this.highScore = this.score;
      try { localStorage.setItem('tankBattleHigh', String(this.highScore)); } catch (e) { /* 隐私模式忽略 */ }
    }
  },

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      Input.clear();
      Sfx.blip();
      setText('pause-score', this.score.toLocaleString());
      this.showScreen('pause');
    } else if (this.state === 'paused') {
      this.state = 'playing';
      Sfx.blip();
      this.hideScreen('pause');
    }
  },

  toggleSound() {
    const muted = Sfx.toggle();
    this.updateSoundBtn();
    return muted;
  },

  updateSoundBtn() {
    const btn = document.getElementById('btn-sound');
    if (btn) {
      btn.textContent = Sfx.isMuted() ? '🔇' : '🔊';
      btn.title = Sfx.isMuted() ? '开启音效 (M)' : '静音 (M)';
    }
  },

  /* ---------------- UI 辅助 ---------------- */
  showScreen(name) {
    const el = document.getElementById('screen-' + name);
    const ov = document.getElementById('overlay');
    if (ov) ov.classList.add('is-on');
    if (el) el.classList.add('is-on');
  },
  hideScreen(name) {
    const ov = document.getElementById('overlay');
    if (name) {
      const el = document.getElementById('screen-' + name);
      if (el) el.classList.remove('is-on');
    } else {
      document.querySelectorAll('.screen').forEach((s) => s.classList.remove('is-on'));
    }
    if (!document.querySelector('.screen.is-on') && ov) ov.classList.remove('is-on');
  },

  animateLevelBanner() {
    const b = document.getElementById('banner');
    if (!b) return;
    b.textContent = `第 ${this.level} 关 · ${this.def.name}${this.loop > 1 ? `  (第 ${this.loop} 周目)` : ''}`;
    b.classList.remove('is-on');
    void b.offsetWidth;   // 重启动画
    b.classList.add('is-on');
  },

  syncHud() {
    setText('hud-level', this.loop > 1 ? `${this.level}·${this.loop}` : String(this.level));
    setText('hud-score', (this.score || 0).toLocaleString());
    setText('hud-lives', `×${Math.max(0, this.lives || 0)}`);
    setText('hud-best', this.highScore.toLocaleString());

    const stars = this.powerLevel || 0;
    setText('hud-power', '★'.repeat(stars) + '☆'.repeat(Math.max(0, 3 - stars)));

    const left = (this.enemyQueue ? this.enemyQueue.length : 0) +
      this.tanks.filter((t) => t.side === 'enemy' && !t.dead).length;
    const bar = document.getElementById('hud-enemies');
    if (bar && bar.dataset.n !== String(left)) {
      bar.dataset.n = String(left);
      bar.innerHTML = '';
      const frag = document.createDocumentFragment();
      for (let i = 0; i < left; i++) {
        const d = document.createElement('i');
        d.className = 'pip';
        frag.appendChild(d);
      }
      bar.appendChild(frag);
    }
  },

  /* ============================================================
   *  渲染
   * ============================================================ */
  render() {
    const ctx = this.ctx;
    ctx.save();

    /* 屏幕震动 */
    if (this.shake > 0.3) {
      ctx.translate(rand(-this.shake, this.shake) * 0.5, rand(-this.shake, this.shake) * 0.5);
    }

    /* 背景 */
    const bg = ctx.createLinearGradient(0, 0, 0, FIELD_H);
    bg.addColorStop(0, '#12182a');
    bg.addColorStop(1, '#0a0e18');
    ctx.fillStyle = bg;
    ctx.fillRect(-20, -20, FIELD_W + 40, FIELD_H + 40);

    this.drawGridGuides(ctx);

    if (this.grid) {
      this.drawTerrain(ctx);
      this.drawBase(ctx);

      for (const p of this.powerups) p.draw(ctx);
      for (const t of this.tanks) t.draw(ctx);
      for (const b of this.bullets) b.draw(ctx);
      for (const e of this.explosions) e.draw(ctx);

      /* 树林画在最上层，会挡住坦克 */
      this.drawTrees(ctx);
    }

    /* 冻结时整个战场泛蓝 */
    if (this.freezeTime > 0) {
      ctx.save();
      ctx.globalAlpha = 0.18 + 0.06 * Math.sin(performance.now() / 140);
      ctx.fillStyle = '#63d6ff';
      ctx.fillRect(0, 0, FIELD_W, FIELD_H);
      ctx.restore();
    }

    /* 捡到补给的提示条 */
    if (this.flashFreeze > 0) {
      ctx.save();
      ctx.globalAlpha = this.flashFreeze / 0.35;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, FIELD_W, FIELD_H);
      ctx.restore();
    }

    ctx.restore();
  },

  /* 淡淡的网格，让空场地不至于太空 */
  drawGridGuides(ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(90,120,180,0.09)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 1; c < COLS; c++) { ctx.moveTo(c * TILE, 0); ctx.lineTo(c * TILE, FIELD_H); }
    for (let r = 1; r < ROWS; r++) { ctx.moveTo(0, r * TILE); ctx.lineTo(FIELD_W, r * TILE); }
    ctx.stroke();
    ctx.restore();
  },

  drawTerrain(ctx) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        const t = this.grid[i];
        const x = c * TILE, y = r * TILE;
        switch (t) {
          case T.WATER: ctx.drawImage(TileArt.water, x, y); break;
          case T.ICE: ctx.drawImage(TileArt.ice, x, y); break;
          case T.STEEL: ctx.drawImage(TileArt.steel, x, y); break;
          case T.BRICK: {
            const mk = this.mask[i];
            if (mk === 0b1111) { ctx.drawImage(TileArt.brick, x, y); break; }
            /* 只画还剩下的象限 */
            for (let q = 0; q < 4; q++) {
              if (!(mk & (1 << q))) continue;
              const qc = q % 2, qr = (q - qc) / 2;
              ctx.drawImage(TileArt.brick, qc * 16, qr * 16, 16, 16, x + qc * 16, y + qr * 16, 16, 16);
            }
            break;
          }
          default: break;
        }
      }
    }
  },

  drawTrees(ctx) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.grid[r * COLS + c] === T.TREE) ctx.drawImage(TileArt.tree, c * TILE, r * TILE);
      }
    }
  },

  drawBase(ctx) {
    if (this.base) this.base.draw(ctx);
  },
};

/* ============================================================
 *  小工具
 * ============================================================ */
function setText(id, v) {
  const el = document.getElementById(id);
  if (el && el.textContent !== v) el.textContent = v;
}

/* ============================================================
 *  启动
 * ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  Game.init();
  /* 标题页的高分 */
  setText('title-best', Game.highScore.toLocaleString());
});
