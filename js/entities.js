/* ============================================================
 * 坦克大战 · 实体层  entities.js
 * ------------------------------------------------------------
 * 这里放所有会动的东西：坦克 / 子弹 / 爆炸 / 补给。
 * 所有类的方法都接收 game 实例 g，避免到处写全局变量。
 * ============================================================ */

/* ---------------- 基础常量 ---------------- */
const TILE = 32;
const COLS = 16;
const ROWS = 16;
const FIELD_W = COLS * TILE;   // 512
const FIELD_H = ROWS * TILE;   // 512
const TANK_SIZE = 24;          // 比格子略小，方便在 1 格宽的走廊里拐弯
const BULLET_SIZE = 6;

/* 地块类型 */
const T = {
  EMPTY: 0,
  BRICK: 1,
  STEEL: 2,
  WATER: 3,
  TREE: 4,
  ICE: 5,
  BASE: 6,
};

/* 方向表：索引即旋转角度顺序 */
const DIRS = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};
const DIR_LIST = ['up', 'right', 'down', 'left'];
const PERP = { up: [1, -1], down: [1, -1], left: [0, -1], right: [0, -1] };

/* 敌人型号参数 */
const ENEMY_TYPES = {
  basic: { speed: 68, bulletSpeed: 190, hp: 1, score: 100, maxBullets: 1, fireGap: 1.25, body: '#c9d4e3', trim: '#7c8aa3' },
  fast: { speed: 118, bulletSpeed: 190, hp: 1, score: 200, maxBullets: 1, fireGap: 1.25, body: '#6fe3ff', trim: '#2a8fb0' },
  power: { speed: 68, bulletSpeed: 300, hp: 1, score: 300, maxBullets: 2, fireGap: 0.85, body: '#ffd166', trim: '#b8841f' },
  armor: { speed: 68, bulletSpeed: 200, hp: 4, score: 400, maxBullets: 1, fireGap: 1.1, body: '#9dff6f', trim: '#3f8f22' },
};
/* 装甲车挨打后按血量变色，越打越"红" */
const ARMOR_COLORS = ['#9dff6f', '#7fe3ff', '#ffd166', '#ff8f6f'];

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const aabb = (a, ax, ay, as, bx, by, bs) => ax < bx + bs && ax + as > bx && ay < by + bs && ay + as > by;

/* ============================================================
 *  地形工具
 * ============================================================ */

/* 坦克尺寸的矩形是否撞到不可通行的地块（越界也算撞） */
function rectHitsTiles(g, x, y, w, h, canSwim) {
  if (x < 0 || y < 0 || x + w > FIELD_W || y + h > FIELD_H) return true;
  const c0 = Math.floor(x / TILE), c1 = Math.floor((x + w - 0.001) / TILE);
  const r0 = Math.floor(y / TILE), r1 = Math.floor((y + h - 0.001) / TILE);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const t = g.tile(c, r);
      if (t === T.BRICK || t === T.STEEL || t === T.BASE) return true;
      if (t === T.WATER && !canSwim) return true;
    }
  }
  return false;
}

/* 坦克与其它坦克是否重叠 */
function rectHitsTank(g, self, x, y) {
  for (const t of g.tanks) {
    if (t === self || t.dead || t.spawning > 0) continue;
    if (aabb(x, y, TANK_SIZE, TANK_SIZE, t.x, t.y, TANK_SIZE)) return true;
  }
  return false;
}

/* ============================================================
 *  坦克
 * ============================================================ */
class Tank {
  constructor(g, opts) {
    this.g = g;
    this.side = opts.side;             // 'player' | 'enemy'
    this.type = opts.type;             // 'player' | basic/fast/power/armor
    this.dir = opts.dir || (this.side === 'player' ? 'up' : 'down');
    this.x = opts.col * TILE + (TILE - TANK_SIZE) / 2;
    this.y = opts.row * TILE + (TILE - TANK_SIZE) / 2;
    this.dead = false;

    const cfg = this.side === 'player' ? null : ENEMY_TYPES[this.type];
    this.cfg = cfg;

    this.maxHp = this.side === 'player' ? 1 : cfg.hp;
    this.hp = this.maxHp;
    this.speed = this.side === 'player' ? 96 : cfg.speed;
    this.baseBulletSpeed = this.side === 'player' ? 200 : cfg.bulletSpeed;
    this.maxBullets = this.side === 'player' ? 1 : cfg.maxBullets;
    this.bulletPower = this.side === 'player' ? 1 : 1;
    this.fireGap = this.side === 'player' ? 0.34 : cfg.fireGap;

    this.cool = 0;
    this.shots = 0;                    // 场上属于本车的子弹数
    this.spawning = 0.85;              // 出生保护动画时长
    this.shield = 0;                   // 护盾剩余秒数
    this.frozen = 0;                   // 被时钟冻结的剩余秒数
    this.carrying = false;             // 是否是"闪红"的补给车
    this.blink = 0;
    this.tread = 0;                    // 履带滚动相位
    this.moving = false;
    this.iceTime = 0;                  // 冰面打滑剩余时间
    this.ai = this.side === 'enemy' ? { dirTimer: 0, fireTimer: rand(0.3, 1.2), stuck: 0 } : null;
  }

  get cx() { return this.x + TANK_SIZE / 2; }
  get cy() { return this.y + TANK_SIZE / 2; }
  get col() { return Math.floor(this.cx / TILE); }
  get row() { return Math.floor(this.cy / TILE); }

  /* 玩家火力等级 0..3 */
  get level() { return this.side === 'player' ? Math.min(3, this.powerLevel || 0) : 0; }

  onTile() { return this.g.tile(this.col, this.row); }

  /* ---------------- 开火 ---------------- */
  fire() {
    if (this.cool > 0 || this.shots >= this.maxBullets || this.spawning > 0) return false;

    const d = DIRS[this.dir];
    const power = this.side === 'player'
      ? (this.level >= 3 ? 3 : 1)
      : 1;
    const speed = this.baseBulletSpeed * (this.side === 'player' && this.level >= 1 ? 1.5 : 1);

    /* 从炮口位置射出 */
    const muzzle = TANK_SIZE / 2 + BULLET_SIZE / 2 + 2;
    let bx = this.cx + d.x * muzzle - BULLET_SIZE / 2;
    let by = this.cy + d.y * muzzle - BULLET_SIZE / 2;

    /* 贴墙时枪口可能已经在地图外，稍微回缩一点 */
    bx = clamp(bx, 0, FIELD_W - BULLET_SIZE);
    by = clamp(by, 0, FIELD_H - BULLET_SIZE);

    this.g.bullets.push(new Bullet(this.g, this, bx, by, this.dir, speed, power));
    this.shots++;
    this.cool = this.fireGap;
    if (this.side === 'player') Sfx.shoot(); else Sfx.enemyShoot();
    return true;
  }

  /* ---------------- 转向 + 网格吸附 ---------------- */
  /* 这是"手感"的关键：换轴时把垂直坐标对齐到格心，
     不然 24px 的车身会在 32px 的走廊口卡住，非常难受。 */
  setDir(nd) {
    if (this.dir === nd) return;
    const wasH = this.dir === 'left' || this.dir === 'right';
    const isH = nd === 'left' || nd === 'right';
    this.dir = nd;

    if (wasH !== isH) {
      const off = (TILE - TANK_SIZE) / 2;
      if (isH) {
        /* 改成横着走 → 对齐 y */
        const snapped = Math.round((this.y - off) / TILE) * TILE + off;
        if (!rectHitsTiles(this.g, this.x, snapped, TANK_SIZE, TANK_SIZE, false) &&
            !rectHitsTank(this.g, this, this.x, snapped)) {
          this.y = snapped;
        }
      } else {
        /* 改成竖着走 → 对齐 x */
        const snapped = Math.round((this.x - off) / TILE) * TILE + off;
        if (!rectHitsTiles(this.g, snapped, this.y, TANK_SIZE, TANK_SIZE, false) &&
            !rectHitsTank(this.g, this, snapped, this.y)) {
          this.x = snapped;
        }
      }
    }
  }

  /* ---------------- 移动（带"自动找缝"辅助） ---------------- */
  move(dt) {
    const d = DIRS[this.dir];
    const dist = this.speed * dt;
    const nx = this.x + d.x * dist;
    const ny = this.y + d.y * dist;

    if (this.fits(nx, ny)) { this.x = nx; this.y = ny; return true; }

    /* 被挡住时，尝试左右/上下微调最多 8px 进入走廊口 */
    const axis = (this.dir === 'left' || this.dir === 'right') ? 'y' : 'x';
    for (let s = 1; s <= 8; s++) {
      for (const sign of [1, -1]) {
        const sx = axis === 'x' ? nx + sign * s : nx;
        const sy = axis === 'y' ? ny + sign * s : ny;
        if (this.fits(sx, sy)) { this.x = sx; this.y = sy; return true; }
      }
    }
    return false;
  }

  fits(x, y) {
    if (rectHitsTiles(this.g, x, y, TANK_SIZE, TANK_SIZE, false)) return false;
    if (rectHitsTank(this.g, this, x, y)) return false;
    return true;
  }

  /* ---------------- 更新 ---------------- */
  update(dt) {
    if (this.spawning > 0) { this.spawning -= dt; return; }
    if (this.cool > 0) this.cool -= dt;
    if (this.shield > 0) this.shield -= dt;
    if (this.frozen > 0) { this.frozen -= dt; return; }
    this.blink += dt;

    if (this.side === 'player') this.updatePlayer(dt);
    else this.updateAI(dt);
  }

  updatePlayer(dt) {
    const want = Input.dir();

    /* 冰面：松开键之后会继续滑一小段 */
    if (this.onTile() === T.ICE) {
      if (want) { this.setDir(want); this.iceTime = 0.30; }
      else if (this.iceTime > 0) this.iceTime -= dt;
    } else {
      this.iceTime = 0;
      if (want) this.setDir(want);
    }

    const willMove = want || (this.onTile() === T.ICE && this.iceTime > 0);
    if (willMove) {
      this.moving = this.move(dt);
    } else {
      this.moving = false;
    }

    if (this.moving) this.tread += dt * (this.speed / 9);
    if (Input.fire()) this.fire();
  }

  /* ---------------- 敌人 AI ---------------- */
  updateAI(dt) {
    const a = this.ai;
    a.dirTimer -= dt;
    a.fireTimer -= dt;

    const moved = this.move(dt);
    this.moving = moved;
    if (moved) this.tread += dt * (this.speed / 9);

    /* 撞墙了就换个方向；否则到点也换 */
    if (!moved) {
      a.stuck += dt;
      if (a.stuck > 0.12) { this.chooseDir(); a.stuck = 0; a.dirTimer = rand(0.4, 1.2); }
    } else if (a.dirTimer <= 0) {
      this.chooseDir();
      a.dirTimer = rand(0.8, 2.2);
    }

    if (a.fireTimer <= 0) {
      const wantFire = this.g.enemyWantsToFire(this) || Math.random() < 0.30;
      if (wantFire) {
        if (this.fire()) a.fireTimer = rand(0.5, 1.3);
        else a.fireTimer = 0.2;
      } else {
        a.fireTimer = rand(0.25, 0.8);
      }
    }
  }

  /* 选一个方向：六成概率往玩家/基地方向压，四成纯随机 */
  chooseDir() {
    const g = this.g;
    const base = g.base;
    const target = (Math.random() < 0.62 && g.player && !g.player.dead)
      ? { x: g.player.cx, y: g.player.cy }
      : { x: base.cx, y: base.cy };

    const dx = target.x - this.cx;
    const dy = target.y - this.cy;

    const cands = [];
    /* 朝目标的两个方向优先 */
    if (Math.abs(dx) > 8) cands.push(dx > 0 ? 'right' : 'left');
    if (Math.abs(dy) > 8) cands.push(dy > 0 ? 'down' : 'up');
    /* 再补上备选，避免死胡同里卡死 */
    cands.push('down', 'left', 'right', 'up');

    for (const d of cands) {
      if (d === 'left' && this.cx < TILE * 2) continue;
      if (d === 'right' && this.cx > FIELD_W - TILE * 2) continue;
      if (d === 'up' && this.cy < TILE * 2) continue;

      this.setDir(d);
      const dd = DIRS[d];
      if (this.fits(this.x + dd.x * 3, this.y + dd.y * 3)) return;
      /* setDir 可能会吸附坐标，这里再确认一次没被卡住 */
      if (this.fits(this.x, this.y)) return;
    }
    this.dir = DIR_LIST[randInt(0, 3)];
  }

  /* ---------------- 挨打 ---------------- */
  damage(power) {
    if (this.spawning > 0 || this.shield > 0) return false;
    if (this.side === 'player') {
      this.die();
      return true;
    }
    this.hp -= 1;
    if (this.hp <= 0) { this.die(); return true; }
    Sfx.hitSteel();
    return false;
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.g.onTankDestroyed(this);
  }

  /* ---------------- 绘制 ---------------- */
  draw(ctx) {
    if (this.spawning > 0) { this.drawSpawn(ctx); return; }

    /* 补给车闪红 */
    let body, trim;
    if (this.side === 'player') {
      body = '#ffd54a'; trim = '#b8841f';
    } else if (this.type === 'armor') {
      body = ARMOR_COLORS[clamp(this.maxHp - this.hp, 0, 3)];
      trim = '#3f8f22';
    } else {
      body = this.cfg.body; trim = this.cfg.trim;
    }
    if (this.carrying && Math.floor(this.blink * 6) % 2 === 0) {
      body = '#ff4d6d'; trim = '#8f1f33';
    }

    drawTankShape(ctx, this.x, this.y, TANK_SIZE, this.dir, body, trim, this.tread, this.moving);

    /* 护盾 */
    if (this.shield > 0) {
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(this.blink * 22);
      ctx.strokeStyle = '#7ff0ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, TANK_SIZE * 0.78, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#7ff0ff';
      ctx.fill();
      ctx.restore();
    }

    /* 被冻结时盖一层冰蓝 */
    if (this.frozen > 0) {
      ctx.save();
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = '#63d6ff';
      ctx.fillRect(this.x, this.y, TANK_SIZE, TANK_SIZE);
      ctx.restore();
    }
  }

  drawSpawn(ctx) {
    const cx = this.cx, cy = this.cy;
    const t = 1 - this.spawning / 0.85;
    const r = TANK_SIZE * 0.55 * (0.25 + t * 0.9);
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = this.carrying ? '#ff4d6d' : '#8ef7ff';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const rr = r * (1 - i * 0.26);
      if (rr <= 0) continue;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, (Math.PI * 2 * i / 3) + t * 6, (Math.PI * 2 * i / 3) + t * 6 + Math.PI * 1.35);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/* ============================================================
 *  坦克外形（程序化绘制，不依赖图片资源）
 * ============================================================ */
function drawTankShape(ctx, x, y, s, dir, body, trim, tread, moving) {
  const half = s / 2;
  ctx.save();
  ctx.translate(x + half, y + half);

  const ang = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 }[dir];
  ctx.rotate(ang);

  const h = half;                 // 局部坐标：-h..h
  const treadW = s * 0.24;        // 履带宽度
  const bodyW = s - treadW * 2 - 1;

  /* 履带 */
  ctx.fillStyle = trim;
  ctx.fillRect(-h, -h, treadW, s);
  ctx.fillRect(h - treadW, -h, treadW, s);

  /* 履带纹路（随移动滚动） */
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  const step = 4;
  const phase = ((tread % step) + step) % step;
  for (let i = -h + phase; i < h; i += step) {
    ctx.fillRect(-h, i, treadW, 1.6);
    ctx.fillRect(h - treadW, i, treadW, 1.6);
  }

  /* 车身 */
  ctx.fillStyle = body;
  ctx.fillRect(-h + treadW, -h + 1, bodyW, s - 2);

  /* 车身高光/阴影，做出一点立体感 */
  ctx.fillStyle = 'rgba(255,255,255,0.24)';
  ctx.fillRect(-h + treadW, -h + 1, bodyW, s * 0.16);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(-h + treadW, h - 1 - s * 0.16, bodyW, s * 0.16);

  /* 炮塔 */
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.26, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();

  /* 炮管 */
  ctx.fillStyle = trim;
  ctx.fillRect(-s * 0.085, -h - s * 0.06, s * 0.17, s * 0.42);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(-s * 0.085, -h - s * 0.06, s * 0.06, s * 0.42);

  ctx.restore();
}

/* ============================================================
 *  子弹
 * ============================================================ */
class Bullet {
  constructor(g, owner, x, y, dir, speed, power) {
    this.g = g;
    this.owner = owner;
    this.side = owner.side;
    this.x = x;
    this.y = y;
    this.dir = dir;
    this.speed = speed;
    this.power = power;
    this.dead = false;
    this.life = 6;
    this.trail = [];
  }

  get cx() { return this.x + BULLET_SIZE / 2; }
  get cy() { return this.y + BULLET_SIZE / 2; }

  update(dt) {
    const d = DIRS[this.dir];

    /* 分段推进，避免高速子弹"穿过"薄墙 */
    const total = this.speed * dt;
    const steps = Math.max(1, Math.ceil(total / 4));
    const stepLen = total / steps;

    for (let i = 0; i < steps; i++) {
      this.trail.push({ x: this.cx, y: this.cy });
      if (this.trail.length > 5) this.trail.shift();

      this.x += d.x * stepLen;
      this.y += d.y * stepLen;

      if (this.checkHit()) return;
    }

    this.life -= dt;
    if (this.life <= 0) this.kill(false);
  }

  kill(explode) {
    if (this.dead) return;
    this.dead = true;
    if (this.owner) this.owner.shots = Math.max(0, this.owner.shots - 1);
    if (explode) this.g.addExplosion(this.cx, this.cy, 14, false);
  }

  checkHit() {
    const g = this.g;

    /* 出界 */
    if (this.x < 0 || this.y < 0 || this.x + BULLET_SIZE > FIELD_W || this.y + BULLET_SIZE > FIELD_H) {
      const d = DIRS[this.dir];
      this.g.addExplosion(this.cx - d.x * 3, this.cy - d.y * 3, 12, false);
      Sfx.hitWall();
      this.kill(false);
      return true;
    }

    /* 撞子弹（敌我子弹互消） */
    for (const b of g.bullets) {
      if (b === this || b.dead) continue;
      if (b.side === this.side) continue;
      if (aabb(this.x, this.y, BULLET_SIZE, BULLET_SIZE, b.x, b.y, BULLET_SIZE, BULLET_SIZE)) {
        b.kill(true);
        this.kill(true);
        return true;
      }
    }

    /* 撞地块 —— 取弹头中心所在格 */
    const c = Math.floor(this.cx / TILE);
    const r = Math.floor(this.cy / TILE);
    const t = g.tile(c, r);

    if (t === T.BRICK) {
      g.damageBrick(c, r, this);
      Sfx.hitWall();
      this.kill(false);
      return true;
    }
    if (t === T.STEEL) {
      if (this.power >= 3) {
        g.setTile(c, r, T.EMPTY);
        Sfx.hitSteel();
        this.kill(true);
      } else {
        Sfx.hitSteel();
        this.kill(false);
      }
      return true;
    }
    if (t === T.BASE) {
      this.kill(false);
      g.baseDestroyed();
      return true;
    }

    /* 撞坦克 */
    for (const tk of g.tanks) {
      if (tk.dead || tk.side === this.side || tk.spawning > 0) continue;
      if (aabb(this.x, this.y, BULLET_SIZE, BULLET_SIZE, tk.x, tk.y, TANK_SIZE, TANK_SIZE)) {
        const killed = tk.damage(this.power);
        this.kill(false);
        if (killed) g.addExplosion(tk.cx, tk.cy, 30, true);
        else g.addExplosion(this.cx, this.cy, 14, false);
        return true;
      }
    }
    return false;
  }

  draw(ctx) {
    /* 拖尾 */
    ctx.save();
    for (let i = 0; i < this.trail.length; i++) {
      const p = this.trail[i];
      const a = (i + 1) / this.trail.length * 0.35;
      ctx.globalAlpha = a;
      ctx.fillStyle = this.side === 'player' ? '#ffe9a3' : '#ff9db0';
      const sz = BULLET_SIZE * (0.4 + 0.5 * (i / this.trail.length));
      ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
    ctx.restore();

    const core = this.side === 'player' ? '#fff6cf' : '#ffd0d8';
    const edge = this.side === 'player' ? '#ffb020' : '#ff4d6d';

    ctx.fillStyle = edge;
    ctx.fillRect(this.x - 1, this.y - 1, BULLET_SIZE + 2, BULLET_SIZE + 2);
    ctx.fillStyle = core;
    ctx.fillRect(this.x + 1, this.y + 1, BULLET_SIZE - 2, BULLET_SIZE - 2);
  }
}

/* ============================================================
 *  爆炸（粒子 + 冲击环）
 * ============================================================ */
class Explosion {
  constructor(x, y, size, big) {
    this.x = x; this.y = y;
    this.size = size;
    this.big = big;
    this.t = 0;
    this.dur = big ? 0.62 : 0.32;
    this.dead = false;
    this.parts = [];
    const n = big ? 26 : 12;
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(size * 1.6, size * 5.5);
      this.parts.push({
        x: 0, y: 0,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        sz: rand(1.6, big ? 5 : 3.4),
        hue: rand(0, 1),
      });
    }
  }

  update(dt) {
    this.t += dt;
    if (this.t >= this.dur) { this.dead = true; return; }
    for (const p of this.parts) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.90;
      p.vy *= 0.90;
    }
  }

  draw(ctx) {
    const k = this.t / this.dur;       // 0 → 1
    const fade = 1 - k;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.globalCompositeOperation = 'lighter';

    /* 冲击环 */
    ctx.globalAlpha = fade * 0.75;
    ctx.strokeStyle = '#ffd27a';
    ctx.lineWidth = 2.5 * fade + 0.5;
    ctx.beginPath();
    ctx.arc(0, 0, this.size * (0.35 + k * 1.25), 0, Math.PI * 2);
    ctx.stroke();

    /* 核心闪光 */
    if (k < 0.42) {
      ctx.globalAlpha = (1 - k / 0.42) * 0.9;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, this.size * 0.85);
      g.addColorStop(0, '#fffdf2');
      g.addColorStop(0.45, '#ffcf5c');
      g.addColorStop(1, 'rgba(255,90,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, this.size * 0.85, 0, Math.PI * 2);
      ctx.fill();
    }

    /* 碎片 */
    for (const p of this.parts) {
      ctx.globalAlpha = fade * 0.95;
      ctx.fillStyle = p.hue < 0.4 ? '#fff3c4' : (p.hue < 0.75 ? '#ffa43c' : '#ff5a3c');
      ctx.fillRect(p.x - p.sz / 2, p.y - p.sz / 2, p.sz, p.sz);
    }

    ctx.restore();
  }
}

/* ============================================================
 *  补给
 * ============================================================ */
const POWERUP_TYPES = ['star', 'grenade', 'helmet', 'shovel', 'tank', 'clock'];
const POWERUP_LABEL = {
  star: '★', grenade: '✹', helmet: '⛨', shovel: '⛏', tank: '⛃', clock: '⏱',
};
const POWERUP_NAME = {
  star: '火力升级', grenade: '全屏爆破', helmet: '无敌护盾',
  shovel: '钢铁基地', tank: '额外生命', clock: '时间冻结',
};

class PowerUp {
  constructor(g, x, y, type) {
    this.g = g;
    this.x = x;
    this.y = y;
    this.type = type;
    this.dead = false;
    this.life = 16;
    this.t = 0;
    this.size = 26;
  }

  update(dt) {
    this.t += dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;

    /* 玩家碰到就吃掉 */
    const p = this.g.player;
    if (p && !p.dead && p.spawning <= 0 &&
        aabb(this.x, this.y, this.size, this.size, p.x, p.y, TANK_SIZE, TANK_SIZE)) {
      this.dead = true;
      this.g.applyPowerUp(this.type);
    }
  }

  draw(ctx) {
    const pulse = 1 + Math.sin(this.t * 7) * 0.08;
    const alpha = this.life < 4 ? (Math.floor(this.life * 6) % 2 ? 0.25 : 1) : 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(this.x + this.size / 2, this.y + this.size / 2);
    ctx.scale(pulse, pulse);

    /* 底板 */
    const w = this.size;
    ctx.fillStyle = 'rgba(8,12,22,0.9)';
    ctx.fillRect(-w / 2, -w / 2, w, w);

    /* 外框光晕 */
    ctx.strokeStyle = '#7ff0ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(-w / 2, -w / 2, w, w);
    ctx.globalAlpha = alpha * 0.35;
    ctx.strokeStyle = '#7ff0ff';
    ctx.lineWidth = 4;
    ctx.strokeRect(-w / 2 - 2, -w / 2 - 2, w + 4, w + 4);
    ctx.globalAlpha = alpha;

    /* 图标 */
    ctx.fillStyle = '#ffe9a3';
    ctx.font = 'bold 16px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(POWERUP_LABEL[this.type], 0, 1);

    ctx.restore();
  }
}

/* ============================================================
 *  基地（老鹰）
 * ============================================================ */
class Base {
  constructor(g, col, row) {
    this.g = g;
    this.col = col;    // 左上角格
    this.row = row;
    this.size = TILE * 2;
    this.x = col * TILE;
    this.y = row * TILE;
    this.destroyed = false;
    this.t = 0;
    this.shieldTime = 0;   // "铁锹"强化期间
  }

  get cx() { return this.x + this.size / 2; }
  get cy() { return this.y + this.size / 2; }

  update(dt) {
    this.t += dt;
    if (this.shieldTime > 0) this.shieldTime -= dt;
  }

  draw(ctx) {
    const s = this.size;
    const cx = this.x + s / 2;

    ctx.save();
    if (this.destroyed) {
      /* 残骸 */
      ctx.translate(cx, this.y + s / 2);
      ctx.fillStyle = '#2b3242';
      ctx.beginPath();
      ctx.moveTo(-s * 0.38, -s * 0.34);
      ctx.lineTo(s * 0.34, -s * 0.42);
      ctx.lineTo(s * 0.4, s * 0.22);
      ctx.lineTo(-s * 0.2, s * 0.4);
      ctx.lineTo(-s * 0.42, s * 0.06);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#151a25';
      ctx.fillRect(-s * 0.28, -s * 0.1, s * 0.2, s * 0.36);
      ctx.fillRect(s * 0.05, -s * 0.24, s * 0.16, s * 0.5);
      /* 余烬 */
      ctx.globalAlpha = 0.4 + 0.3 * Math.sin(this.t * 4);
      ctx.fillStyle = '#ff7a3c';
      ctx.fillRect(-s * 0.1, -s * 0.06, 4, 4);
      ctx.restore();
      return;
    }

    ctx.translate(cx, this.y + s / 2);

    /* 盾形轮廓 */
    const w = s * 0.44, h = s * 0.5;
    const shieldPath = () => {
      ctx.beginPath();
      ctx.moveTo(-w, -h);
      ctx.lineTo(w, -h);
      ctx.lineTo(w, h * 0.15);
      ctx.quadraticCurveTo(w, h * 0.82, 0, h);
      ctx.quadraticCurveTo(-w, h * 0.82, -w, h * 0.15);
      ctx.closePath();
    };

    shieldPath();
    const grad = ctx.createLinearGradient(0, -h, 0, h);
    grad.addColorStop(0, '#ffe9a3');
    grad.addColorStop(0.55, '#ffc233');
    grad.addColorStop(1, '#c98a12');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#5a3d05';
    ctx.stroke();

    /* 盾中央的星 */
    ctx.fillStyle = '#3a2703';
    ctx.beginPath();
    const R = s * 0.2, r = R * 0.45;
    for (let i = 0; i < 10; i++) {
      const rad = (i % 2 === 0) ? R : r;
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const px = Math.cos(a) * rad, py = Math.sin(a) * rad * 0.95;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();

    /* 铁锹强化时的能量罩 */
    if (this.shieldTime > 0) {
      ctx.globalAlpha = 0.35 + 0.3 * Math.sin(this.t * 10);
      ctx.strokeStyle = '#9fe8ff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.56, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = '#9fe8ff';
      ctx.fill();
    }

    ctx.restore();
  }
}
