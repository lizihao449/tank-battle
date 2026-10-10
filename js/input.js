/* ============================================================
 * 坦克大战 · 输入  input.js
 * ------------------------------------------------------------
 * 键盘: WASD / 方向键 移动，空格 / J 开火，P 暂停，M 静音，R 重开
 * 触屏: 屏幕下方虚拟方向键 + 开火键（自动在触屏设备上显示）
 * ============================================================ */

const Input = (function () {
  const held = Object.create(null);   // 键盘按住的键
  const touchHeld = Object.create(null); // 虚拟键按住状态

  const KEY_DIR = {
    ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down', ArrowLeft: 'left',
    w: 'up', d: 'right', s: 'down', a: 'left',
    W: 'up', D: 'right', S: 'down', A: 'left',
  };
  const KEY_FIRE = { ' ': 1, Spacebar: 1, j: 1, J: 1, Enter: 1 };

  /* 全局回调，由 game.js 挂上去 */
  const hooks = { onPause: null, onMute: null, onRestart: null, onAnyKey: null };

  /* 方向优先级：后按下的方向优先，手感更跟手 */
  let dirStack = [];

  function pushDir(d) {
    const i = dirStack.indexOf(d);
    if (i !== -1) dirStack.splice(i, 1);
    dirStack.push(d);
  }
  function popDir(d) {
    const i = dirStack.indexOf(d);
    if (i !== -1) dirStack.splice(i, 1);
  }

  window.addEventListener('keydown', (e) => {
    const key = e.key;

    if (KEY_DIR[key]) {
      e.preventDefault();
      if (!held[key]) { held[key] = true; pushDir(KEY_DIR[key]); }
      if (hooks.onAnyKey) hooks.onAnyKey();
      return;
    }
    if (KEY_FIRE[key]) {
      e.preventDefault();
      held.fire = true;
      if (hooks.onAnyKey) hooks.onAnyKey();
      return;
    }
    if (key === 'p' || key === 'P' || key === 'Escape') {
      e.preventDefault();
      if (!e.repeat && hooks.onPause) hooks.onPause();
      return;
    }
    if (key === 'm' || key === 'M') {
      e.preventDefault();
      if (!e.repeat && hooks.onMute) hooks.onMute();
      return;
    }
    if (key === 'r' || key === 'R') {
      e.preventDefault();
      if (!e.repeat && hooks.onRestart) hooks.onRestart();
    }
  });

  window.addEventListener('keyup', (e) => {
    const key = e.key;
    if (KEY_DIR[key]) {
      held[key] = false;
      popDir(KEY_DIR[key]);
    }
    if (KEY_FIRE[key]) held.fire = false;
  });

  /* 失焦时全部松开，防止"卡住一直往前开" */
  window.addEventListener('blur', () => {
    for (const k in held) held[k] = false;
    dirStack.length = 0;
  });

  /* ---------------- 触屏虚拟按键 ---------------- */
  function bindTouch() {
    const root = document.getElementById('touch');
    if (!root) return;

    /* 不要用 'ontouchstart' in window 来判断 —— 带触摸屏的 Windows 笔记本
       上它恒为真，结果键盘玩家也得在屏幕上挂着一大块方向键。
       改成:主指针是"粗"的(手机/平板)才默认显示，
       之后真摸了一次屏幕就显示、按了键盘就收起。 */
    const show = () => root.classList.add('is-visible');
    const hide = () => root.classList.remove('is-visible');

    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) show();

    window.addEventListener('touchstart', show, { passive: true });
    window.addEventListener('keydown', hide);

    root.querySelectorAll('[data-dir]').forEach((btn) => {
      const d = btn.dataset.dir;
      const press = (e) => {
        e.preventDefault();
        if (!touchHeld[d]) { touchHeld[d] = true; pushDir(d); }
        if (hooks.onAnyKey) hooks.onAnyKey();
      };
      const release = (e) => {
        e.preventDefault();
        touchHeld[d] = false;
        popDir(d);
      };
      btn.addEventListener('touchstart', press, { passive: false });
      btn.addEventListener('touchend', release, { passive: false });
      btn.addEventListener('touchcancel', release, { passive: false });
      btn.addEventListener('mousedown', press);
      btn.addEventListener('mouseup', release);
      btn.addEventListener('mouseleave', release);
    });

    root.querySelectorAll('[data-fire]').forEach((btn) => {
      const press = (e) => {
        e.preventDefault();
        touchHeld.fire = true;
        if (hooks.onAnyKey) hooks.onAnyKey();
      };
      const release = (e) => { e.preventDefault(); touchHeld.fire = false; };
      btn.addEventListener('touchstart', press, { passive: false });
      btn.addEventListener('touchend', release, { passive: false });
      btn.addEventListener('touchcancel', release, { passive: false });
      btn.addEventListener('mousedown', press);
      btn.addEventListener('mouseup', release);
      btn.addEventListener('mouseleave', release);
    });
  }

  return {
    hooks,
    bindTouch,

    /* 当前方向（无输入返回 null） */
    dir() {
      return dirStack.length ? dirStack[dirStack.length - 1] : null;
    },
    /* 开火键是否按住 */
    fire() {
      return !!(held.fire || touchHeld.fire);
    },
    /* 界面按钮用：清空方向，避免暂停后还残留移动 */
    clear() {
      dirStack.length = 0;
      for (const k in held) held[k] = false;
      touchHeld.fire = false;
    },
  };
})();
