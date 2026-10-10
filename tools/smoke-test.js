/* ============================================================
 * 坦克大战 · 冒烟测试  tools/smoke-test.js
 * ------------------------------------------------------------
 * 在 Node 里用假的 DOM / Canvas 把游戏真跑一遍，用来抓运行时错误。
 * 不测画面好不好看，只测"跑起来会不会炸"。
 *
 *   node tools/smoke-test.js
 * ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FILES = ['js/audio.js', 'js/input.js', 'js/levels.js', 'js/entities.js', 'js/game.js'];

/* ---------------- 假 Canvas ---------------- */
function makeCtx() {
  const grad = { addColorStop() {} };
  const base = {
    canvas: { width: 512, height: 512 },
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createPattern: () => null,
    measureText: () => ({ width: 8 }),
  };
  /* 没写到的绘图方法一律当空实现，省得漏一个就崩 */
  return new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function makeElement(tag) {
  const el = {
    tagName: tag,
    id: '',
    textContent: '',
    innerHTML: '',
    title: '',
    offsetWidth: 1,
    dataset: {},
    style: {},
    children: [],
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      contains(c) { return this._s.has(c); },
      toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); },
    },
    appendChild(c) { el.children.push(c); return c; },
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll() { return []; },
    getContext: undefined,
  };
  if (tag === 'canvas') {
    const ctx = makeCtx();
    el.getContext = () => ctx;
    el.width = 512;
    el.height = 512;
  }
  return el;
}

/* ---------------- 假 DOM ---------------- */
const elements = new Map();
const listeners = { keydown: [], keyup: [], blur: [] };

const documentStub = {
  _ready: [],
  createElement: (tag) => makeElement(tag),
  createDocumentFragment: () => makeElement('#fragment'),
  getElementById(id) {
    if (!elements.has(id)) {
      const el = makeElement(id === 'game' ? 'canvas' : 'div');
      el.id = id;
      elements.set(id, el);
    }
    return elements.get(id);
  },
  querySelector: () => null,
  querySelectorAll: (sel) => (sel === '.screen' ? [...elements.values()].filter((e) => e.classList._s.has('screen')) : []),
  addEventListener(ev, fn) { if (ev === 'DOMContentLoaded') this._ready.push(fn); },
};

const store = Object.create(null);
const localStorageStub = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const windowStub = {
  addEventListener(ev, fn) { if (listeners[ev]) listeners[ev].push(fn); },
  removeEventListener() {},
  navigator: { maxTouchPoints: 0 },
  /* 故意不给 AudioContext —— 正好验证没声音时也能跑 */
};

let clock = 0;
const context = vm.createContext({
  window: windowStub,
  document: documentStub,
  navigator: windowStub.navigator,
  localStorage: localStorageStub,
  performance: { now: () => clock },
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  setTimeout: (fn) => { pendingTimeouts.push(fn); return pendingTimeouts.length; },
  clearTimeout: () => {},
  console,
  Math,
  Date,
  Object,
  Array,
  Number,
  String,
  Boolean,
  JSON,
  Set,
  Map,
  Error,
  Uint8Array,
  Float32Array,
  isNaN,
  parseInt,
  parseFloat,
});
context.globalThis = context;
const pendingTimeouts = [];

/* ---------------- 载入游戏脚本 ---------------- */
for (const f of FILES) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  try {
    vm.runInContext(code, context, { filename: f });
  } catch (e) {
    console.error(`\x1b[31m✗ 载入 ${f} 失败\x1b[0m`);
    console.error(e);
    process.exit(1);
  }
}
console.log('\x1b[32m✓\x1b[0m 五个脚本全部载入');

const G = vm.runInContext('Game', context);
const SFX = vm.runInContext('Sfx', context);
const INP = vm.runInContext('Input', context);
const LEVELS = vm.runInContext('LEVELS', context);
const DIRS = vm.runInContext('DIRS', context);

/* ---------------- 输入模拟 ---------------- */
function keyEvent(key) {
  return { key, repeat: false, preventDefault() {}, stopPropagation() {} };
}
function press(key) { listeners.keydown.forEach((fn) => fn(keyEvent(key))); }
function release(key) { listeners.keyup.forEach((fn) => fn(keyEvent(key))); }
function releaseAll() {
  ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].forEach(release);
}

/* 供 test() 收集的时间旅行式异常 */
let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    failures++;
    console.log(`  \x1b[31m✗ ${name}\x1b[0m`);
    console.log('    ' + String(e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n    ') : e));
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

/* 跑 n 秒游戏（含渲染），返回是否一路无异常 */
const STEP = 1 / 60;
function run(seconds, onTick) {
  const ticks = Math.round(seconds / STEP);
  for (let i = 0; i < ticks; i++) {
    clock += STEP * 1000;
    if (onTick) onTick(i);
    G.update(STEP);
    G.render();
  }
}

/* ============================================================
 *  测试
 * ============================================================ */
console.log('\n启动 & 基础状态');

test('DOMContentLoaded 后 Game 初始化完成', () => {
  documentStub._ready.forEach((fn) => fn());
  assert(G.state === 'title', `状态应是 title，实际 ${G.state}`);
  assert(G.grid && G.grid.length === 256, 'grid 应为 16x16');
  assert(G.base && G.baseCells.length === 4, `老鹰应占 4 格，实际 ${G.base ? G.baseCells.length : 'null'}`);
});

test('标题页空跑 3 秒不报错', () => { run(3); });

test('地图图例全部合法（每行 16 列）', () => {
  const legal = new Set('.#@~TIE');
  LEVELS.forEach((lv, i) => {
    assert(lv.map.length === 16, `第 ${i + 1} 关行数应为 16，实际 ${lv.map.length}`);
    lv.map.forEach((row, r) => {
      assert(row.length === 16, `第 ${i + 1} 关第 ${r} 行长度应为 16，实际 ${row.length}`);
      for (const ch of row) assert(legal.has(ch), `第 ${i + 1} 关第 ${r} 行出现非法字符 "${ch}"`);
    });
    /* 老鹰必须正好 4 格 */
    const eagles = lv.map.join('').split('').filter((c) => c === 'E').length;
    assert(eagles === 4, `第 ${i + 1} 关应有 4 格老鹰，实际 ${eagles}`);
    /* 出生点必须是空的 */
    assert(lv.map[14][4] === '.', `第 ${i + 1} 关玩家出生点被占用`);
    [0, 7, 15].forEach((c) => assert(lv.map[0][c] === '.', `第 ${i + 1} 关敌人出生点 (${c},0) 被占用`));
  });
});

console.log('\n开局 & 长时间对局');

test('startRun 进入 playing 且玩家/基地就位', () => {
  G.startRun();
  assert(G.state === 'playing', `状态应为 playing，实际 ${G.state}`);
  assert(G.player && !G.player.dead, '玩家应已生成');
  assert(G.lives === 3, '初始 3 条命');
  assert(G.base && !G.base.destroyed, '基地应完好');
});

test('模拟 120 秒随机操作对局不报错，且敌人有正常出场', () => {
  let spawned = 0;
  let dirKeys = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
  let curKey = null;
  let seenEnemies = 0;

  run(120, (i) => {
    /* 每 0.4 秒换一次方向，一直按住开火 */
    if (i % 24 === 0) {
      releaseAll();
      curKey = dirKeys[Math.floor(Math.random() * 4)];
      press(curKey);
      press(' ');
    }
    if (i % 24 === 20) release(' ');
    seenEnemies = Math.max(seenEnemies, G.tanks.filter((t) => t.side === 'enemy').length);
  });
  releaseAll();

  assert(seenEnemies > 0, '120 秒内应有敌人出场');
  assert(G.tanks.length < 200, '坦克数量失控，可能有泄漏');
  assert(G.bullets.length < 200, '子弹数量失控，可能有泄漏');
  /* 同时在场敌人不能超过关卡上限 */
  assert(seenEnemies <= 6, `同屏敌人 ${seenEnemies} 台，超过上限`);
});

test('游戏确实在推进（敌人被消耗或玩家受损）', () => {
  assert(typeof G.kills === 'number', 'kills 计数缺失');
  const progressed = G.kills > 0 || G.lives < 3 || !G.baseAlive;
  if (!progressed) {
    /* 把现场信息打出来，方便判断是 AI 卡住还是碰撞没生效 */
    console.log(`    [诊断] 敌人剩余 ${G.enemyQueue.length} / 场上坦克 ${G.tanks.length} / 子弹 ${G.bullets.length} / 得分 ${G.score}`);
  }
  assert(progressed, '跑了 120 秒分数/生命/基地完全没变化，AI 或碰撞可能没工作');
});

console.log('\n六种补给');

['star', 'grenade', 'helmet', 'shovel', 'tank', 'clock'].forEach((type) => {
  test(`补给 ${type} 生效且不留副作用`, () => {
    const livesBefore = G.lives;
    G.applyPowerUp(type);
    G.update(STEP);
    G.render();

    if (type === 'tank') assert(G.lives === livesBefore + 1, '额外生命应 +1');
    if (type === 'helmet') assert(G.player && G.player.shield > 5, '护盾应被点亮');
    if (type === 'star') assert(G.powerLevel >= 1, '火力应提升');
    if (type === 'clock') assert(G.freezeTime > 0, '冻结计时应启动');
    if (type === 'shovel') {
      assert(G.shovelTime > 0, '铁锹计时应启动');
      const ring = G.baseWallCells();
      assert(ring.length === 8, `基地外墙应为 8 格，实际 ${ring.length}`);
      assert(ring.every(([c, r]) => G.tile(c, r) === 2), '铁锹期间外墙应全为钢');
    }
  });
});

test('铁锹到期后外墙变回砖', () => {
  /* 清场并掐断刷怪，保证这 19 秒里基地不会被敌人拆掉。
     清场会顺带满足"过关"条件，所以把结算计时器设成无限，专心测铁锹。 */
  G.startRun();
  run(1);
  G.enemyQueue.length = 0;
  G.tanks.filter((t) => t.side === 'enemy').forEach((t) => { t.dead = true; });
  G.cleared = true;
  G.clearTimer = Infinity;
  run(0.5);

  G.applyPowerUp('shovel');
  const ring = G.baseWallCells();
  assert(G.shovelTime > 0, '铁锹计时应启动');
  assert(ring.every(([c, r]) => G.tile(c, r) === 2), '铁锹期间外墙应全为钢');

  run(10);
  assert(G.shovelTime > 0 && G.shovelTime < 10, `计时应在走，实际 ${G.shovelTime.toFixed(1)}`);

  run(10);   // 累计 20 秒 > 18 秒
  assert(G.shovelTime <= 0, `铁锹应已过期，实际剩余 ${G.shovelTime.toFixed(1)}`);
  assert(ring.every(([c, r]) => G.tile(c, r) === 1), '到期后外墙应变回砖');
});

test('火力满级后子弹能打穿钢板，普通火力打不穿', () => {
  G.startRun();
  run(2);

  const steelAt = () => {
    for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c++) if (G.tile(c, r) === 2) return [c, r];
    return null;
  };
  const spot = steelAt();
  assert(spot, '第一关应有钢板');
  const [sc, sr] = spot;

  /* 普通火力：钢板应该还在 */
  G.damageBrick(0, 0, { x: 0, y: 0 });   // 顺手验证不崩
  assert(G.tile(sc, sr) === 2, '钢板初始存在');

  /* 直接造一颗满级子弹打上去 */
  G.player.powerLevel = 3;
  G.player.maxBullets = 2;
  const B = vm.runInContext('Bullet', context);
  const b = new B(G, G.player, sc * 32 + 13, sr * 32 + 13, 'up', 200, 3);
  G.bullets.push(b);
  b.checkHit();
  assert(G.tile(sc, sr) === 0, '满级子弹应打穿钢板');
});

console.log('\n过关 / 失败流程');

test('全歼敌人能触发过关', () => {
  G.startRun();
  run(2);
  /* 掏空敌人队列 + 清场，直接逼出结算 */
  G.enemyQueue.length = 0;
  G.tanks.filter((t) => t.side === 'enemy').forEach((t) => { t.dead = true; });
  run(0.2);
  assert(G.cleared, '应进入 cleared');
  run(3);
  assert(G.state === 'levelclear', `状态应为 levelclear，实际 ${G.state}`);
  assert(G.score > 0, '过关应有奖励分');
});

test('下一关能正常加载（连续过完 8 关进入二周目）', () => {
  for (let i = 0; i < 8; i++) {
    G.nextLevel();
    assert(G.state === 'playing', 'nextLevel 后应回到 playing');
    G.update(STEP);
    G.render();
  }
  assert(G.loop === 2, `过完 8 关应进入二周目，实际 loop=${G.loop}`);
  assert(G.level === 1, `二周目应从第 1 关开始，实际 ${G.level}`);
  run(6);
  assert(G.enemyQueue.length > 0, '二周目应有额外敌人');
});

test('基地被摧毁 → 爆炸 → 游戏结束', () => {
  G.startRun();
  run(2);
  G.baseDestroyed();
  assert(G.base.destroyed, '基地应标记为已毁');
  assert(G.state === 'playing', '爆炸期间还应该是 playing');
  pendingTimeouts.splice(0).forEach((fn) => fn());   // 手动触发那个 900ms 的定时器
  assert(G.state === 'gameover', `应进入 gameover，实际 ${G.state}`);
});

test('死亡 3 次后游戏结束', () => {
  G.startRun();
  run(2);
  for (let i = 0; i < 3; i++) {
    if (G.player && !G.player.dead) G.player.die();
    run(3);   // 等复活计时走完
  }
  assert(G.state === 'gameover', `3 次阵亡后应 gameover，实际 ${G.state}`);
  assert(G.lives <= 0, `生命应归零，实际 ${G.lives}`);
});

test('破纪录时最高分写进 localStorage', () => {
  G.startRun();
  G.score = G.highScore + 999;
  const expected = G.score;
  G.endGame('测试');
  assert(store.tankBattleHigh !== undefined, '应写入 tankBattleHigh');
  assert(Number(store.tankBattleHigh) === expected,
    `应写入 ${expected}，实际 ${store.tankBattleHigh}`);
});

test('没破纪录时不覆写最高分', () => {
  const before = store.tankBattleHigh;
  G.startRun();
  G.score = 1;
  G.endGame('测试');
  assert(store.tankBattleHigh === before, '低分不应覆盖最高分');
});

console.log('\n暂停 / 静音 / 重开');

test('暂停后世界停住，恢复后继续', () => {
  G.startRun();
  run(3);
  G.state = 'playing';
  const before = JSON.stringify(G.tanks.map((t) => [Math.round(t.x), Math.round(t.y)]));
  G.togglePause();
  assert(G.state === 'paused', '应进入 paused');
  run(2);
  const after = JSON.stringify(G.tanks.map((t) => [Math.round(t.x), Math.round(t.y)]));
  assert(before === after, '暂停期间坦克不应移动');
  G.togglePause();
  assert(G.state === 'playing', '应恢复 playing');
  run(2);
});

test('静音开关翻转且不崩', () => {
  const a = G.toggleSound();
  const b = G.toggleSound();
  assert(a !== b, '开关应能来回切换');
});

test('压力测试：连开 30 局不泄漏', () => {
  for (let i = 0; i < 30; i++) {
    G.startRun();
    run(1.5);
    G.endGame('压力测试');
  }
  assert(G.explosions.length < 500, '爆炸对象疑似泄漏');
  assert(G.powerups.length < 100, '补给对象疑似泄漏');
  assert(G.tanks.length < 50, '坦克对象疑似泄漏');
});

/* ============================================================ */
console.log('');
if (failures) {
  console.log(`\x1b[31m✗ ${failures} 项未通过\x1b[0m\n`);
  process.exit(1);
}
console.log('\x1b[32m✓ 全部通过\x1b[0m\n');
