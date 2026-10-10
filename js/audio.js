/* ============================================================
 * 坦克大战 · 音效引擎  audio.js
 * ------------------------------------------------------------
 * 全部声音都用 Web Audio 现场合成 —— 不依赖任何外部音频文件，
 * 所以整个项目可以离线双击 index.html 直接玩。
 * ============================================================ */

const Sfx = (function () {
  let ctx = null;
  let master = null;
  let muted = false;
  let ready = false;

  /* 浏览器要求音频必须在用户手势之后才能启动 */
  function init() {
    if (ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.28;
      master.connect(ctx.destination);
      ready = true;
    } catch (e) {
      ready = false;
    }
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  /* 一个基础的发声单元：振荡器 + 包络 */
  function tone(opt) {
    if (!ready || muted) return;
    const t0 = ctx.currentTime + (opt.delay || 0);
    const dur = opt.dur || 0.1;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = opt.type || 'square';
    osc.frequency.setValueAtTime(opt.from, t0);

    if (opt.to && opt.to !== opt.from) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, opt.to), t0 + dur);
    }

    const vol = (opt.vol == null ? 0.5 : opt.vol);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /* 白噪声 —— 用来做爆炸和引擎的"沙沙"质感 */
  function noise(opt) {
    if (!ready || muted) return;
    const t0 = ctx.currentTime + (opt.delay || 0);
    const dur = opt.dur || 0.2;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = opt.filter || 'lowpass';
    filter.frequency.setValueAtTime(opt.cutFrom || 1800, t0);
    if (opt.cutTo) filter.frequency.exponentialRampToValueAtTime(Math.max(20, opt.cutTo), t0 + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(opt.vol == null ? 0.5 : opt.vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /* ---------------- 对外音效 ---------------- */

  const api = {
    init() { init(); resume(); },
    resume,
    isMuted() { return muted; },
    setMuted(v) { muted = !!v; if (!muted) resume(); },
    toggle() { muted = !muted; if (!muted) { init(); resume(); } return muted; },

    /* 玩家开火 */
    shoot() {
      tone({ type: 'square', from: 620, to: 180, dur: 0.09, vol: 0.32 });
      noise({ dur: 0.06, vol: 0.14, cutFrom: 2600, cutTo: 600 });
    },

    /* 敌人开火，音调低一点，避免糊成一片 */
    enemyShoot() {
      tone({ type: 'square', from: 340, to: 120, dur: 0.08, vol: 0.16 });
    },

    /* 子弹打墙 */
    hitWall() {
      noise({ dur: 0.07, vol: 0.3, cutFrom: 3200, cutTo: 400 });
      tone({ type: 'triangle', from: 260, to: 90, dur: 0.06, vol: 0.16 });
    },

    /* 子弹打在钢板上 —— 叮 */
    hitSteel() {
      tone({ type: 'square', from: 1400, to: 900, dur: 0.05, vol: 0.2 });
      tone({ type: 'square', from: 2100, to: 1500, dur: 0.04, vol: 0.12, delay: 0.01 });
    },

    /* 小爆炸 */
    hitTank() {
      noise({ dur: 0.18, vol: 0.4, cutFrom: 1400, cutTo: 120 });
      tone({ type: 'triangle', from: 200, to: 60, dur: 0.16, vol: 0.22 });
    },

    /* 大爆炸（击杀 / 基地被毁） */
    explode() {
      noise({ dur: 0.55, vol: 0.65, cutFrom: 2600, cutTo: 60 });
      tone({ type: 'sawtooth', from: 150, to: 34, dur: 0.5, vol: 0.3 });
      tone({ type: 'square', from: 88, to: 28, dur: 0.42, vol: 0.22, delay: 0.03 });
    },

    /* 基地被摧毁 */
    baseDown() {
      noise({ dur: 1.1, vol: 0.8, cutFrom: 3200, cutTo: 40 });
      tone({ type: 'sawtooth', from: 220, to: 26, dur: 1.0, vol: 0.4 });
      tone({ type: 'square', from: 110, to: 22, dur: 0.9, vol: 0.3, delay: 0.08 });
    },

    /* 吃到补给 */
    pickup() {
      [660, 880, 1180].forEach((f, i) => tone({ type: 'square', from: f, to: f * 1.5, dur: 0.1, vol: 0.3, delay: i * 0.06 }));
    },

    /* 掉落补给出现 */
    powerupDrop() {
      tone({ type: 'sine', from: 900, to: 1400, dur: 0.16, vol: 0.22 });
    },

    /* 过关 */
    levelClear() {
      [523, 659, 784, 1046].forEach((f, i) => tone({ type: 'square', from: f, to: f, dur: 0.16, vol: 0.3, delay: i * 0.13 }));
    },

    /* 游戏开始 */
    start() {
      [392, 523, 659, 784].forEach((f, i) => tone({ type: 'square', from: f, to: f, dur: 0.14, vol: 0.3, delay: i * 0.1 }));
    },

    /* 游戏结束 */
    gameOver() {
      [440, 392, 330, 262, 196].forEach((f, i) => tone({ type: 'sawtooth', from: f, to: f * 0.92, dur: 0.3, vol: 0.3, delay: i * 0.18 }));
    },

    /* 暂停 / 菜单切换 */
    blip() {
      tone({ type: 'square', from: 880, to: 1320, dur: 0.05, vol: 0.22 });
    },
  };

  return api;
})();
