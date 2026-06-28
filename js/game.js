'use strict';
/* ============================================================
 * SPOT RADAR — Dragon Game  js/game.js
 * ============================================================ */

const _GM_KEY = 'spr-dragon-v1';

/* --- Dragon pixel art (20 cols × 14 rows, 神龍スタイル, side-view facing RIGHT) ---
 *  0=bg  1=#0d1a0d(dark outline)  2=#1a5c1a(body dark)  3=#3ea83e(body light)
 *  4=#f5c518(gold horn)           5=#e8d5a0(cream belly) 6=#1a0d00(dark eye)
 * ------------------------------------------------------------------------------ */
const DRG_W = 20, DRG_H = 14;
const DRG_PAL = [null, '#0d1a0d', '#1a5c1a', '#3ea83e', '#f5c518', '#e8d5a0', '#1a0d00'];

//  columns:  01234567890123456789
const DRG_F = [
  // frame 0 — standard pose
  '00000000000000140410' +  //  0: horns (4=gold)
  '00000000000001441100' +  //  1: horn base
  '00000000000012331000' +  //  2: head top
  '00000000000012631000' +  //  3: head + eye (6=dark eye col13)
  '00000000001112551000' +  //  4: neck start + cream snout (5)
  '00000001111122551000' +  //  5: neck
  '00000112333322111000' +  //  6: upper body
  '00011233333321100000' +  //  7: body
  '01122235555321000000' +  //  8: body + belly starts
  '11223355555321000000' +  //  9: belly
  '01235555553210000000' +  // 10: belly
  '01255555321000000000' +  // 11: tail region
  '01255321000000000000' +  // 12: tail
  '00125100000000000000',   // 13: tail tip

  // frame 1 — tail wag (body same, tail shifts)
  '00000000000000140410' +
  '00000000000001441100' +
  '00000000000012331000' +
  '00000000000012631000' +
  '00000000001112551000' +
  '00000001111122551000' +
  '00000112333322111000' +
  '00011233333321100000' +
  '01122235555321000000' +
  '11223355555321000000' +
  '01235555553210000000' +
  '00125555321000000000' +  // 11: tail shifted up-left
  '00012532100000000000' +  // 12: tail
  '00001210000000000000',   // 13: tail tip
];

/* --- Enemy table ---------------------------------------------------- */
const ENEMIES = [
  { name: 'スライム',         maxHp: 12, atk: 2, def: 0, exp: 3,  art: '🟢' },
  { name: 'コウモリ',         maxHp: 10, atk: 3, def: 0, exp: 4,  art: '🦇' },
  { name: 'オオカミ',         maxHp: 18, atk: 4, def: 1, exp: 6,  art: '🐺' },
  { name: 'ゴースト',         maxHp: 14, atk: 3, def: 1, exp: 5,  art: '👻' },
  { name: 'フレイムドラゴン', maxHp: 30, atk: 6, def: 2, exp: 15, art: '🔥', rare: true },
  { name: 'てつゴーレム',     maxHp: 40, atk: 4, def: 5, exp: 18, art: '⚙️', rare: true },
  { name: 'まおう',           maxHp: 60, atk: 8, def: 3, exp: 40, art: '👑', boss: true },
];

const GM_DEF = {
  lv: 1, hp: 5, maxHp: 5, atk: 3, def: 1,
  exp: 0, expNext: 10, hunger: 3, lastTick: 0, wins: 0,
};

/* ================================================================== */
class DragonGame {
  constructor() {
    this._ready   = false;   // attach() called
    this._raf     = null;
    this._mode    = 'menu';
    this._battle  = null;
    this._dino    = null;
    this._drX     = 30;      // dragon walk position (%)
    this._drDir   = 1;
    this._drFrame = 0;
    this._drTick  = 0;
    this._px      = 4;       // dot pixel size
    this.s        = { ...GM_DEF };
  }

  /* ── Public API ─────────────────────────────────────────────── */
  attach(el, getSpots, getPos) {
    if (this._ready) return;
    this._ready    = true;
    this._el       = el;
    this._getSpots = getSpots;
    this._getPos   = getPos;
    this._load();
    this._buildDOM();
    this._bindEvents();
  }

  start() {
    this._sizeCanvas();
    this._showMenu();
  }

  stop() {
    this._stopLoop();
    if (this._dino) this._dino.alive = false;
  }

  /* ── DOM ────────────────────────────────────────────────────── */
  _buildDOM() {
    this._el.innerHTML = `
<div class="gm-arena"><canvas id="gm-c"></canvas></div>
<div class="gm-hud">
  <span id="gm-hearts" class="gm-hearts"></span>
  <span id="gm-hunger" class="gm-hunger"></span>
</div>
<div id="gm-msg" class="gm-msg"></div>
<div id="gm-mm" class="gm-menu">
  <button class="gm-btn" data-a="feed">ごはん</button>
  <button class="gm-btn" data-a="play">あそぶ</button>
  <button class="gm-btn" data-a="battle">たたかう</button>
  <button class="gm-btn" data-a="status">ステータス</button>
</div>
<div id="gm-bm" class="gm-menu" hidden>
  <button class="gm-btn" data-b="attack">こうげき</button>
  <button class="gm-btn" data-b="magic">まほう</button>
  <button class="gm-btn gm-sm" data-b="run">にげる</button>
  <button class="gm-btn gm-sm" id="gm-bk">もどる</button>
</div>
<div id="gm-sp" class="gm-sp" hidden></div>`;

    this._canvas = document.getElementById('gm-c');
    this._ctx    = this._canvas.getContext('2d');
  }

  _sizeCanvas() {
    const a = this._el.querySelector('.gm-arena');
    const w = a.clientWidth  || 200;
    const h = a.clientHeight || 110;
    this._canvas.width  = w;
    this._canvas.height = h;
    this._px = Math.max(2, Math.floor(Math.min(w, h) / 36));
  }

  _bindEvents() {
    this._el.addEventListener('click', e => {
      const ta = e.target.closest('[data-a]');
      const tb = e.target.closest('[data-b]');
      const id = e.target.id;
      if      (ta)           this._menuAction(ta.dataset.a);
      else if (tb)           this._battleAction(tb.dataset.b);
      else if (id === 'gm-bk')     this._showMenu();
      else if (id === 'gm-dretry') this._startDino();
      else if (id === 'gm-dback')  this._showMenu();
      else if (this._mode === 'play') this._dinoJump();
    });
    this._el.addEventListener('touchstart', e => {
      if (this._mode === 'play') { e.preventDefault(); this._dinoJump(); }
    }, { passive: false });
  }

  /* ── State ──────────────────────────────────────────────────── */
  _load() {
    try { Object.assign(this.s, JSON.parse(localStorage.getItem(_GM_KEY) || '{}')); }
    catch {}
    // hunger decay: −2 per hour
    const hrs = Math.max(0, (Date.now() - (this.s.lastTick || Date.now())) / 3.6e6);
    this.s.hunger = Math.max(0, (this.s.hunger ?? 3) - Math.floor(hrs * 2));
    this.s.lastTick = Date.now();
    this._save();
  }

  _save() {
    this.s.lastTick = Date.now();
    localStorage.setItem(_GM_KEY, JSON.stringify(this.s));
  }

  /* ── HUD ────────────────────────────────────────────────────── */
  _renderHUD() {
    const s = this.s;
    document.getElementById('gm-hearts').textContent =
      '♥'.repeat(s.hp) + '♡'.repeat(Math.max(0, s.maxHp - s.hp));
    document.getElementById('gm-hunger').textContent =
      '食:' + '●'.repeat(s.hunger) + '○'.repeat(Math.max(0, 5 - s.hunger));
  }

  _msg(t) {
    const el = document.getElementById('gm-msg');
    if (el) el.textContent = t;
  }

  /* ── Screens ────────────────────────────────────────────────── */
  _showMenu() {
    this._mode = 'menu';
    this._el.querySelector('.gm-dino-btns')?.remove();
    document.getElementById('gm-mm').hidden = false;
    document.getElementById('gm-bm').hidden = true;
    document.getElementById('gm-sp').hidden = true;
    this._msg('');
    this._renderHUD();
    this._startWalk();
  }

  _menuAction(a) {
    if (a === 'feed')   this._doFeed();
    if (a === 'play')   this._startDino();
    if (a === 'battle') this._startBattle();
    if (a === 'status') this._showStatus();
  }

  /* ── Feed ───────────────────────────────────────────────────── */
  _doFeed() {
    const s = this.s;
    if (s.hunger >= 5) { this._msg('おなかいっぱいだよ！'); return; }
    s.hunger = Math.min(5, s.hunger + 1);
    const healed = s.hp < s.maxHp;
    if (healed) s.hp = Math.min(s.maxHp, s.hp + 1);
    this._msg(healed ? 'もりもり食べた！\nHPも回復！' : 'もりもり食べた！');
    this._save();
    this._renderHUD();
  }

  /* ── Status ─────────────────────────────────────────────────── */
  _showStatus() {
    this._mode = 'status';
    this._stopLoop();
    document.getElementById('gm-mm').hidden = true;
    const s  = this.s;
    const sp = document.getElementById('gm-sp');
    sp.hidden   = false;
    sp.innerHTML = `
<table class="gm-tbl">
  <tr><td>Lv</td><td>${s.lv}</td></tr>
  <tr><td>たいりょく</td><td>${s.hp} / ${s.maxHp}</td></tr>
  <tr><td>こうげき</td><td>${s.atk}</td></tr>
  <tr><td>まもり</td><td>${s.def}</td></tr>
  <tr><td>けいけんち</td><td>${s.exp} / ${s.expNext}</td></tr>
  <tr><td>しょうりすう</td><td>${s.wins}回</td></tr>
</table>
<button class="gm-btn" id="gm-sp-back" style="margin-top:6px;width:100%">もどる</button>`;
    document.getElementById('gm-sp-back')
      .addEventListener('click', () => this._showMenu(), { once: true });

    // Draw dragon portrait on canvas
    const ctx = this._ctx, cw = this._canvas.width, ch = this._canvas.height;
    ctx.fillStyle = '#001400';
    ctx.fillRect(0, 0, cw, ch);
    const px = this._px;
    this._drawDragon(ctx, cw / 2 - DRG_W * px / 2, ch / 2 - DRG_H * px / 2, 0, false, px);
  }

  /* ── Battle ─────────────────────────────────────────────────── */
  _hash(str) {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h  = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  }

  _selectEnemy() {
    const spots = this._getSpots?.() || [];
    const pos   = this._getPos?.();
    let seed;

    if (spots.length && pos) {
      let minD = Infinity, nearest = null;
      for (const sp of spots) {
        const d = Math.hypot(
          (sp.lat - pos.lat) * 111000,
          (sp.lng - pos.lng) * 111000 * Math.cos(sp.lat * Math.PI / 180)
        );
        if (d < minD) { minD = d; nearest = sp; }
      }
      seed = minD < 500
        ? this._hash(nearest.name + nearest.lat.toFixed(4) + nearest.lng.toFixed(4))
        : this._hash(String(Math.round(pos.lat * 10)) + ',' + String(Math.round(pos.lng * 10)));
    } else if (pos) {
      seed = this._hash(String(Math.round(pos.lat * 10)) + ',' + String(Math.round(pos.lng * 10)));
    } else {
      seed = Math.floor(Math.random() * 0xFFFFFF);
    }

    const rng = () => {
      seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b) >>> 0;
      return seed / 0xFFFFFFFF;
    };

    const roll = rng();
    let pool;
    if      (roll < 0.05) pool = ENEMIES.filter(e => e.boss);
    else if (roll < 0.20) pool = ENEMIES.filter(e => e.rare && !e.boss);
    else                  pool = ENEMIES.filter(e => !e.rare && !e.boss);

    const tmpl = pool[Math.floor(rng() * pool.length)];
    const m    = 1 + (this.s.lv - 1) * 0.15;
    return {
      ...tmpl,
      hp:    Math.round(tmpl.maxHp * m),
      maxHp: Math.round(tmpl.maxHp * m),
      atk:   Math.round(tmpl.atk   * m),
    };
  }

  _startBattle() {
    this._stopLoop();
    this._mode   = 'battle';
    this._battle = { enemy: this._selectEnemy(), turn: 'player' };
    document.getElementById('gm-mm').hidden = true;
    document.getElementById('gm-bm').hidden = false;
    this._drawBattle();
    this._msg(`${this._battle.enemy.art} ${this._battle.enemy.name}が\nあらわれた！`);
  }

  _drawBattle() {
    const ctx = this._ctx;
    const cw  = this._canvas.width, ch = this._canvas.height;
    const e   = this._battle.enemy;
    const s   = this.s;
    const px  = Math.max(2, this._px - 1);

    ctx.fillStyle = '#001400';
    ctx.fillRect(0, 0, cw, ch);

    // Enemy emoji
    ctx.font      = `${Math.round(ch * 0.42)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(e.art, cw * 0.72, ch * 0.60);

    // Enemy HP bar
    ctx.fillStyle = '#0d3b0d';
    ctx.fillRect(cw * 0.34, 6, cw * 0.60, 7);
    const ef = e.hp / e.maxHp;
    ctx.fillStyle = ef > 0.5 ? '#2ea82e' : ef > 0.25 ? '#f9a825' : '#e05c2a';
    ctx.fillRect(cw * 0.34, 6, cw * 0.60 * ef, 7);
    ctx.fillStyle  = '#00ff41';
    ctx.font       = '8px monospace';
    ctx.textAlign  = 'left';
    ctx.fillText(e.name, cw * 0.34, 5);

    // Player dragon (small)
    this._drawDragon(ctx, 6, ch * 0.22, this._drFrame, false, px);

    // Player HP bar
    const pf = s.hp / s.maxHp;
    ctx.fillStyle = '#0d3b0d';
    ctx.fillRect(6, ch - 10, cw * 0.28, 5);
    ctx.fillStyle = pf > 0.5 ? '#2ea82e' : '#e05c2a';
    ctx.fillRect(6, ch - 10, cw * 0.28 * pf, 5);
  }

  _battleAction(action) {
    if (this._mode !== 'battle' || !this._battle || this._battle.turn !== 'player') return;
    const b = this._battle, s = this.s;

    if (action === 'run') {
      b.turn = null;
      if (Math.random() < 0.5) { this._msg('うまくにげられた！'); setTimeout(() => this._showMenu(), 1200); }
      else                     { this._msg('にげられなかった！'); setTimeout(() => this._enemyTurn(), 1000); }
      return;
    }

    let dmg;
    if (action === 'attack') {
      dmg = Math.max(1, s.atk - b.enemy.def + Math.floor(Math.random() * 3));
      this._msg(`こうげき！\n${b.enemy.name}に ${dmg}ダメージ！`);
    } else {
      if (s.hunger <= 0) { this._msg('おなかがすいて\nまほうが使えない！'); return; }
      s.hunger--;
      dmg = Math.max(1, Math.round(s.atk * 1.6) - Math.floor(b.enemy.def * 0.5) + Math.floor(Math.random() * 3));
      this._msg(`まほう！\n${b.enemy.name}に ${dmg}ダメージ！`);
      this._renderHUD();
      this._save();
    }

    b.enemy.hp -= dmg;
    b.turn = null;
    this._drawBattle();

    if (b.enemy.hp <= 0) {
      setTimeout(() => this._onWin(), 1200);
    } else {
      setTimeout(() => this._enemyTurn(), 1200);
    }
  }

  _enemyTurn() {
    if (!this._battle) return;
    const b = this._battle, s = this.s;
    const dmg = Math.max(1, b.enemy.atk - s.def + Math.floor(Math.random() * 2));
    s.hp = Math.max(1, s.hp - dmg);   // HP1 minimum — no permadeath
    this._drawBattle();
    this._renderHUD();
    this._msg(`${b.enemy.name}のこうげき！\n${dmg}ダメージをうけた！`);
    this._save();
    b.turn = 'player';
  }

  _onWin() {
    const s = this.s, e = this._battle.enemy;
    s.wins++;
    s.exp += e.exp;
    const lv = this._tryLevelUp();
    this._battle = null;
    document.getElementById('gm-bm').hidden = true;
    this._msg(`かった！ EXP+${e.exp}${lv ? `\nLv.${s.lv}にレベルアップ！` : ''}`);
    this._renderHUD();
    this._save();
    setTimeout(() => this._showMenu(), 2000);
  }

  _tryLevelUp() {
    const s = this.s;
    let lv = false;
    while (s.exp >= s.expNext) {
      s.exp -= s.expNext;
      s.lv++;
      s.expNext = Math.round(s.expNext * 1.5);
      s.maxHp++;
      s.hp = s.maxHp;
      s.atk++;
      if (s.lv % 2 === 0) s.def++;
      lv = true;
    }
    return lv;
  }

  /* ── タイミングジャンプゲーム ───────────────────────────────── */
  _startDino() {
    this._mode = 'play';
    this._stopLoop();
    this._el.querySelector('.gm-dino-btns')?.remove();
    document.getElementById('gm-mm').hidden = true;
    document.getElementById('gm-bm').hidden = true;
    document.getElementById('gm-sp').hidden = true;

    const cw = this._canvas.width, ch = this._canvas.height;
    const px = Math.max(2, Math.floor(this._px * 0.65));
    const gY = ch - 16;
    // 判定ライン: ドラゴンの右端から少し前
    const hitX = 10 + DRG_W * px + 12;

    this._dino = {
      alive: true,
      lives: 3, score: 0,
      speed: 2.2,
      obs: [],          // { x, hitTime, h, state:'incoming'|'hit'|'miss' }
      hitX,
      nextObs: 90,
      jumping: false, jumpT: 0, jumpH: DRG_H * px * 1.1,
      grade: null, gradeT: 0, gradeCol: '#00ff41',
      frame: 0, ft: 0,
      px, gY, cw, ch,
    };
    this._msg('障害物が来たらタップ！');

    let last = 0;
    const loop = t => {
      if (!this._dino?.alive) return;
      if (t - last < 33) { requestAnimationFrame(loop); return; }
      last = t;
      this._dinoTick();
      if (this._dino?.alive) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  _dinoJump() {
    const d = this._dino;
    if (!d?.alive || d.jumping) return;

    const now = Date.now();
    const obs = d.obs.find(o => o.state === 'incoming');
    if (!obs) return;

    const diff = now - obs.hitTime;   // 負=早い、正=遅い
    const abs  = Math.abs(diff);

    if (abs <= 500) {
      // 成功
      obs.state   = 'hit';
      d.jumping   = true;
      d.jumpT     = 0;
      d.score++;
      if (d.score % 5 === 0) d.speed = Math.min(4.5, d.speed + 0.25);
      if      (abs < 150) { d.grade = 'PERFECT!'; d.gradeCol = '#f5c518'; }
      else if (abs < 320) { d.grade = 'GOOD';     d.gradeCol = '#3ea83e'; }
      else                { d.grade = 'OK';        d.gradeCol = '#90ee90'; }
    } else if (diff < -500) {
      // 早すぎ（ペナルティなし）
      d.grade = 'はやい！'; d.gradeCol = '#888';
    }
    // 遅すぎは _dinoTick で自動判定
    d.gradeT = 0;
  }

  _dinoTick() {
    const d   = this._dino;
    const ctx = this._ctx;
    const { cw, ch, gY, px, hitX } = d;

    // 障害物を移動
    d.obs.forEach(o => { o.x -= d.speed; });

    // 自動ミス判定：hitX を 0.5秒分通り過ぎたら miss
    const missThresh = d.speed * 15;   // ≈0.5s at 30fps
    for (const o of d.obs) {
      if (o.state === 'incoming' && o.x < hitX - missThresh) {
        o.state  = 'miss';
        d.lives  = Math.max(0, d.lives - 1);
        d.grade  = 'おそい！'; d.gradeCol = '#e05c2a'; d.gradeT = 0;
        if (d.lives === 0) { d.alive = false; this._dinoOver(d.score); return; }
      }
    }
    d.obs = d.obs.filter(o => o.x > -20);

    // 新しい障害物をスポーン
    if (--d.nextObs <= 0) {
      const timeMs = ((cw - hitX) / d.speed) * 33;
      d.obs.push({
        x: cw, state: 'incoming',
        hitTime: Date.now() + timeMs,
        h: 12 + Math.floor(Math.random() * 10),
      });
      d.nextObs = 75 + Math.floor(Math.random() * 55);
    }

    // ジャンプアニメ
    let offY = 0;
    if (d.jumping) {
      d.jumpT++;
      offY = -Math.sin((d.jumpT / 18) * Math.PI) * d.jumpH;
      if (d.jumpT >= 18) { d.jumping = false; d.jumpT = 0; }
    }

    // グレード表示タイマー
    if (d.grade) { if (++d.gradeT > 28) d.grade = null; }

    // ドラゴンアニメ
    if (++d.ft % 8 === 0) d.frame ^= 1;

    // ── 描画 ──────────────────────────────────────────
    ctx.fillStyle = '#001400';
    ctx.fillRect(0, 0, cw, ch);

    // 地面
    ctx.strokeStyle = '#1a5c1a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, gY); ctx.lineTo(cw, gY); ctx.stroke();

    // 判定ゾーン（次の障害物がどれくらい近いか）
    const next = d.obs.find(o => o.state === 'incoming');
    const inZone = next && Math.abs(next.x - hitX) < missThresh;
    ctx.strokeStyle = inZone ? '#f5c518' : '#1f4a1f';
    ctx.lineWidth   = inZone ? 2 : 1;
    ctx.setLineDash(inZone ? [] : [2, 3]);
    ctx.beginPath(); ctx.moveTo(hitX, gY - 30); ctx.lineTo(hitX, gY); ctx.stroke();
    ctx.setLineDash([]);
    if (inZone) {
      ctx.fillStyle = 'rgba(245,197,24,0.08)';
      ctx.fillRect(hitX - missThresh, gY - 30, missThresh * 2, 30);
    }

    // タイミングバー（障害物の接近度を可視化）
    if (next && next.x > hitX) {
      const ratio = 1 - Math.min(1, (next.x - hitX) / (cw - hitX));
      const bw = cw * 0.55, bx = (cw - bw) / 2;
      ctx.fillStyle = '#0d2b0d';
      ctx.fillRect(bx, gY + 5, bw, 5);
      ctx.fillStyle = ratio > 0.85 ? '#e05c2a' : ratio > 0.65 ? '#f9a825' : '#2ea82e';
      ctx.fillRect(bx, gY + 5, bw * ratio, 5);
    }

    // JUMP! 表示
    if (inZone) {
      ctx.fillStyle = '#f5c518';
      ctx.font      = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('▶ JUMP! ◀', cw / 2, gY - 10);
    }

    // 障害物
    for (const o of d.obs) {
      ctx.fillStyle = o.state === 'hit' ? '#3ea83e'
                    : o.state === 'miss' ? '#e05c2a' : '#2e7d32';
      ctx.fillRect(o.x, gY - o.h, 10, o.h);
      const armY = gY - Math.round(o.h * 0.55);
      ctx.fillRect(o.x - 4, armY, 4, 5);
      ctx.fillRect(o.x + 10, armY, 4, 5);
    }

    // ドラゴン
    this._drawDragon(ctx, 10, gY - DRG_H * px + offY, d.frame, false, px);

    // HUD: ライフ + スコア
    ctx.fillStyle = '#00ff41'; ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('♥'.repeat(d.lives) + '♡'.repeat(3 - d.lives), 4, 13);
    ctx.textAlign = 'right';
    ctx.fillText(`${d.score}pt`, cw - 4, 13);

    // グレードテキスト
    if (d.grade) {
      ctx.fillStyle  = d.gradeCol;
      ctx.font       = 'bold 10px monospace';
      ctx.textAlign  = 'center';
      ctx.fillText(d.grade, hitX, gY - 35);
    }
  }

  _dinoOver(score) {
    const expGain = score * 2;   // 成功1回=EXP2
    this.s.exp += expGain;
    const lv = this._tryLevelUp();
    this._save();
    this._renderHUD();
    this._msg(`スコア: ${score}  EXP+${expGain}${lv ? `\nLv.${this.s.lv}にレベルアップ！` : ''}`);

    const btns = document.createElement('div');
    btns.className = 'gm-dino-btns';
    btns.innerHTML =
      '<button class="gm-btn" id="gm-dretry">もういちど</button>' +
      '<button class="gm-btn" id="gm-dback">もどる</button>';
    document.getElementById('gm-msg').after(btns);
    this._mode = 'idle';
  }

  /* ── Dragon walk animation ──────────────────────────────────── */
  _startWalk() {
    this._stopLoop();
    let last = 0;
    const loop = t => {
      if (this._mode !== 'menu' && this._mode !== 'feed') return;
      this._raf = requestAnimationFrame(loop);
      if (t - last < 110) return;
      last = t;

      this._drX    += this._drDir * 1.5;
      if (this._drX > 74) this._drDir = -1;
      if (this._drX < 14) this._drDir =  1;
      this._drTick  = (this._drTick + 1) % 4;
      this._drFrame = this._drTick < 2 ? 0 : 1;

      const ctx = this._ctx;
      const cw  = this._canvas.width, ch = this._canvas.height;
      const px  = this._px;

      ctx.fillStyle = '#001400';
      ctx.fillRect(0, 0, cw, ch);

      ctx.strokeStyle = '#0d3b0d';
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(0, ch - 10); ctx.lineTo(cw, ch - 10); ctx.stroke();

      const dw = DRG_W * px, dh = DRG_H * px;
      const dx = Math.round(cw * this._drX / 100) - dw / 2;
      const dy = ch - 10 - dh;
      this._drawDragon(ctx, dx, dy, this._drFrame, this._drDir < 0, px);
    };
    this._raf = requestAnimationFrame(loop);
  }

  _stopLoop() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  /* ── Dragon renderer ────────────────────────────────────────── */
  _drawDragon(ctx, x, y, frame, flipH, px) {
    const data = DRG_F[frame];
    ctx.save();
    if (flipH) { ctx.translate(x + DRG_W * px, y); ctx.scale(-1, 1); }
    else        { ctx.translate(x, y); }
    for (let r = 0; r < DRG_H; r++) {
      for (let c = 0; c < DRG_W; c++) {
        const col = DRG_PAL[+data[r * DRG_W + c]];
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(c * px, r * px, px, px);
      }
    }
    ctx.restore();
  }
}

window._dragonGame = new DragonGame();
