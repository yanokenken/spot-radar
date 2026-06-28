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
//
//  S字ポーズ (行6-13):
//    上カーブ (行6-9):  体が左へ。内側=右側 → 5を右に配置
//    下カーブ (行9-11): 体が右へ。内側=左側 → 5を左に配置
//    しっぽ  (行12-13): 下カーブ継続 → 5を左に配置
//
const DRG_F = [
  // ── frame 0 ── (しっぽ先: 左振り)
  '00000000001414100000' +  //  0: horns        ← そのまま
  '00000000000041410000' +  //  1: horn base    ← そのまま
  '00000000000012332000' +  //  2: head top     ← そのまま
  '00000000000012633300' +  //  3: head + eye   ← そのまま
  '00000000001112555510' +  //  4: neck + snout ← そのまま
  '00000002222222555100' +  //  5: neck         ← そのまま
  '00000033333355000000' +  //  6: 上カーブ開始 (5=右, col 6-11)
  '00333333355500000000' +  //  7: 上カーブ中   (5=右, col 2-8)
  '03333355500000000000' +  //  8: 最左端       (5=右, col 0-5)
  '00033333355000000000' +  //  9: 折り返し     (5=右→移行, col 3-10)
  '00000003333555000000' +  // 10: 下カーブ右へ (5=左, col 7-13)
  '00000000333333550000' +  // 11: 最右端       (5=左, col 8-15)
  '00000000003333500000' +  // 12: しっぽ       (5=左, col 8-14)
  '00000033333000000000',   // 13: しっぽ先・左振り (col 5-10)

  // ── frame 1 ── (しっぽ先: 右振り)
  '00000000001414100000' +  //  0: horns        ← そのまま
  '00000000000041410000' +  //  1: horn base    ← そのまま
  '00000000000012332000' +  //  2: head top     ← そのまま
  '00000000000012633300' +  //  3: head + eye   ← そのまま
  '00000000001112555510' +  //  4: neck + snout ← そのまま
  '00000002222222555100' +  //  5: neck         ← そのまま
  '00000033333355000000' +  //  6: 上カーブ開始 (5=右, col 6-11)
  '00333333355500000000' +  //  7: 上カーブ中   (5=右, col 2-8)
  '03333355500000000000' +  //  8: 最左端       (5=右, col 0-5)
  '00033333355000000000' +  //  9: 折り返し     (5=右→移行, col 3-10)
  '00000003333555000000' +  // 10: 下カーブ右へ (5=左, col 7-13)
  '00000000333333550000' +  // 11: 最右端       (5=左, col 8-15)
  '00000000003333500000' +  // 12: しっぽ       (5=左, col 8-14)
  '00000000003333300000',   // 13: しっぽ先・右振り (col 9-14)
];

/* --- Enemy table ---------------------------------------------------- */
const ENEMIES = [
  { name: 'イカモンスター', maxHp: 12, atk: 2, def: 0, exp: 3,  img: 'images/character_monster_ika_green.svg' },
  { name: 'フランケン',     maxHp: 10, atk: 3, def: 0, exp: 4,  img: 'images/character_monster_frankenstein_01_blue.svg' },
  { name: 'オオカミ男',     maxHp: 18, atk: 4, def: 1, exp: 6,  img: 'images/character_monster_okamiotoko_02_gray.svg' },
  { name: 'メドゥーサ',     maxHp: 14, atk: 3, def: 1, exp: 5,  img: 'images/character_monster_medusa_green.svg' },
  { name: 'レッドドラゴン', maxHp: 30, atk: 6, def: 2, exp: 15, img: 'images/character_monster_dragon_02_red.svg', rare: true },
  { name: 'てつゴーレム',   maxHp: 40, atk: 4, def: 5, exp: 18, img: 'images/character_monster_golem_gray.svg', rare: true },
  { name: 'まおう',         maxHp: 60, atk: 8, def: 3, exp: 40, img: 'images/character_monster_mao_03.svg', boss: true },
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
    // SVG敵画像を事前ロード
    this._imgs = {};
    for (const e of ENEMIES) {
      const img = new Image();
      img.src = e.img;
      this._imgs[e.img] = img;
    }
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
    this._msg(`${this._battle.enemy.name}が\nあらわれた！`);
  }

  _drawBattle() {
    const ctx = this._ctx;
    const cw  = this._canvas.width, ch = this._canvas.height;
    const e   = this._battle.enemy;
    const s   = this.s;
    const px  = Math.max(2, this._px - 1);

    ctx.fillStyle = '#001400';
    ctx.fillRect(0, 0, cw, ch);

    // Enemy SVG画像
    const eImg   = this._imgs?.[e.img];
    const iSize  = Math.round(Math.min(cw * 0.56, ch * 0.62));
    const iX     = Math.round(cw * 0.40);
    const iY     = Math.round(ch * 0.04);
    if (eImg?.complete && eImg.naturalWidth > 0) {
      ctx.drawImage(eImg, iX, iY, iSize, iSize);
    } else {
      // ロード前フォールバック（名前表示）
      ctx.fillStyle = '#3ea83e';
      ctx.font      = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(e.name, cw * 0.68, ch * 0.40);
    }

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

    // Player dragon (small) — キャンバス下端に配置
    this._drawDragon(ctx, 6, ch - DRG_H * px - 2, this._drFrame, false, px);
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

  /* ── タイミングスラッシュゲーム ─────────────────────────────── */
  _startDino() {
    this._mode = 'play';
    this._stopLoop();
    this._el.querySelector('.gm-dino-btns')?.remove();
    document.getElementById('gm-mm').hidden = true;
    document.getElementById('gm-bm').hidden = true;
    document.getElementById('gm-sp').hidden = true;

    const cw = this._canvas.width, ch = this._canvas.height;
    const px  = Math.max(2, Math.floor(this._px * 0.65));
    const gY  = ch - 16;
    const hitX = 10 + DRG_W * px + 12;

    this._dino = {
      alive: true, lives: 3, score: 0,
      speed: 2.2,
      obs: [],    // { x, hitTime, h, type:'normal'|'danger', state, topX, botX, topY, slashT }
      hitX,
      nextObs: 30,
      slashFx: [],   // { x, h, t, bad }
      lunging: false, lungeT: 0,
      grade: null, gradeT: 0, gradeCol: '#00ff41',
      frame: 0, ft: 0,
      px, gY, cw, ch,
    };
    this._msg('緑→スラッシュ！ オレンジ→よける！');

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
    if (!d?.alive || d.lunging) return;

    const now = Date.now();
    const obs = d.obs.find(o => o.state === 'incoming');
    if (!obs) return;

    const diff = now - obs.hitTime;
    const abs  = Math.abs(diff);

    if (abs <= 500) {
      if (obs.type === 'danger') {
        // ── オレンジボールを斬ってしまった → ダメージ ──
        obs.state = 'punished'; obs.slashT = 0;
        d.slashFx.push({ x: obs.x + 8, h: 16, t: 0, bad: true });
        d.lives = Math.max(0, d.lives - 1);
        d.grade = 'ダメージ！'; d.gradeCol = '#e05c2a'; d.gradeT = 0;
        if (d.lives === 0) { d.alive = false; this._dinoOver(d.score); return; }
      } else {
        // ── 緑障害物スラッシュ成功 ──
        obs.state  = 'slashed'; obs.slashT = 0;
        obs.topX = obs.x; obs.botX = obs.x; obs.topY = 0;
        d.slashFx.push({ x: obs.x + 5, h: obs.h, t: 0, bad: false });
        d.score++;
        d.speed = Math.min(8.0, d.speed + 0.3);
        d.lunging = true; d.lungeT = 0;
        if      (abs < 150) { d.grade = 'PERFECT!'; d.gradeCol = '#f5c518'; }
        else if (abs < 320) { d.grade = 'GOOD';     d.gradeCol = '#3ea83e'; }
        else                { d.grade = 'OK';        d.gradeCol = '#90ee90'; }
        d.gradeT = 0;
      }
    } else if (diff < -500) {
      d.grade = 'はやい！'; d.gradeCol = '#888'; d.gradeT = 0;
    }
  }

  _dinoTick() {
    const d   = this._dino;
    const ctx = this._ctx;
    const { cw, ch, gY, px, hitX } = d;
    const missThresh = d.speed * 15;

    // ── 障害物を移動 ──
    for (const o of d.obs) {
      if (o.state === 'incoming' || o.state === 'miss') {
        o.x -= d.speed;
      } else if (o.state === 'slashed') {
        o.slashT++;
        o.topX -= 1.2; o.botX += 0.8; o.topY -= 1.0;
      } else if (o.state === 'punished') {
        o.slashT++;
      }
    }

    // ── 通過判定 ──
    for (const o of d.obs) {
      if (o.state !== 'incoming') continue;
      if (o.x < hitX - missThresh) {
        if (o.type === 'danger') {
          // オレンジは避け成功 → ノーダメージ
          o.state = 'passed';
          d.grade = 'DODGE!'; d.gradeCol = '#3ea83e'; d.gradeT = 0;
        } else {
          // 緑を避けてしまった → ダメージ
          o.state = 'miss';
          d.lives = Math.max(0, d.lives - 1);
          d.grade = 'おそい！'; d.gradeCol = '#e05c2a'; d.gradeT = 0;
          if (d.lives === 0) { d.alive = false; this._dinoOver(d.score); return; }
        }
      }
    }
    // アニメ終了・画面外を除去
    d.obs = d.obs.filter(o => {
      if (o.state === 'slashed' || o.state === 'punished') return o.slashT < 22;
      return o.x > -24;
    });

    // ── スポーン（2~3個同時に画面上に出るペース） ──
    if (--d.nextObs <= 0) {
      const isDanger = Math.random() < 0.35;
      const timeMs   = ((cw - hitX) / d.speed) * 33;
      d.obs.push({
        x: cw, state: 'incoming',
        type: isDanger ? 'danger' : 'normal',
        hitTime: Date.now() + timeMs,
        h: isDanger ? 16 : 12 + Math.floor(Math.random() * 10),
      });
      d.nextObs = 38 + Math.floor(Math.random() * 22);
    }

    // ── スラッシュFXタイマー ──
    d.slashFx.forEach(fx => fx.t++);
    d.slashFx = d.slashFx.filter(fx => fx.t < 14);

    // ── ランジアニメ ──
    let offX = 0;
    if (d.lunging) {
      d.lungeT++;
      offX = Math.sin((d.lungeT / 14) * Math.PI) * 10;
      if (d.lungeT >= 14) { d.lunging = false; d.lungeT = 0; }
    }

    // ── グレードタイマー ──
    if (d.grade && ++d.gradeT > 28) d.grade = null;

    // ── ドラゴンアニメ ──
    if (++d.ft % 8 === 0) d.frame ^= 1;

    // ════ 描画 ════════════════════════════════════════
    ctx.fillStyle = '#001400';
    ctx.fillRect(0, 0, cw, ch);

    // 地面
    ctx.strokeStyle = '#1a5c1a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, gY); ctx.lineTo(cw, gY); ctx.stroke();

    // 次に来る障害物の種類を判定
    const next     = d.obs.find(o => o.state === 'incoming');
    const inZone   = next && Math.abs(next.x - hitX) < missThresh;
    const isDanger = inZone && next.type === 'danger';

    // 判定ライン
    ctx.strokeStyle = inZone ? (isDanger ? '#e05c2a' : '#f5c518') : '#1f4a1f';
    ctx.lineWidth   = inZone ? 2 : 1;
    ctx.setLineDash(inZone ? [] : [2, 3]);
    ctx.beginPath(); ctx.moveTo(hitX, gY - 32); ctx.lineTo(hitX, gY); ctx.stroke();
    ctx.setLineDash([]);
    if (inZone) {
      ctx.fillStyle = isDanger ? 'rgba(224,92,42,0.1)' : 'rgba(245,197,24,0.07)';
      ctx.fillRect(hitX - missThresh, gY - 32, missThresh * 2, 32);
    }

    // タイミングバー
    if (next && next.x > hitX) {
      const ratio = 1 - Math.min(1, (next.x - hitX) / (cw - hitX));
      const bw = cw * 0.55, bx = (cw - bw) / 2;
      ctx.fillStyle = '#0d2b0d';
      ctx.fillRect(bx, gY + 5, bw, 5);
      ctx.fillStyle = next.type === 'danger'
        ? (ratio > 0.7 ? '#ff4444' : '#e05c2a')
        : (ratio > 0.85 ? '#e05c2a' : ratio > 0.65 ? '#f9a825' : '#2ea82e');
      ctx.fillRect(bx, gY + 5, bw * ratio, 5);
    }

    // SLASH! / DODGE! 表示
    if (inZone) {
      ctx.fillStyle = isDanger ? '#ff4444' : '#f5c518';
      ctx.font      = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(isDanger ? '▶ DODGE! ◀' : '▶ SLASH! ◀', cw / 2, gY - 12);
    }

    // ── 障害物の描画 ──
    for (const o of d.obs) {
      if (o.state === 'incoming') {
        if (o.type === 'danger') {
          // オレンジボール（円形）
          const cx = o.x + 8, cy = gY - 8;
          ctx.fillStyle = '#e05c2a';
          ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#ffaa44'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.stroke();
          // 光の輝き（パルス代わりに点でハイライト）
          ctx.fillStyle = 'rgba(255,200,80,0.6)';
          ctx.beginPath(); ctx.arc(cx - 2, cy - 3, 2, 0, Math.PI * 2); ctx.fill();
        } else {
          // 緑障害物（棒＋腕）
          ctx.fillStyle = '#2e7d32';
          ctx.fillRect(o.x, gY - o.h, 10, o.h);
          const armY = gY - Math.round(o.h * 0.55);
          ctx.fillRect(o.x - 4, armY, 4, 5);
          ctx.fillRect(o.x + 10, armY, 4, 5);
        }

      } else if (o.state === 'slashed') {
        // 緑障害物：白↔金フラッシュで2分割
        const alpha = Math.max(0, 1 - o.slashT / 22);
        const flash = Math.floor(o.slashT / 3) % 2 === 0;
        ctx.globalAlpha = alpha;
        ctx.fillStyle   = flash ? '#ffffff' : '#f5c518';
        const half = Math.ceil(o.h / 2);
        ctx.fillRect(o.topX, gY - o.h + o.topY, 10, half);
        ctx.fillRect(o.botX, gY - half, 10, half);
        ctx.globalAlpha = 1;

      } else if (o.state === 'punished') {
        // オレンジボール：赤く膨らんで爆発
        const alpha = Math.max(0, 1 - o.slashT / 22);
        const flash = Math.floor(o.slashT / 3) % 2 === 0;
        const rad   = 7 + o.slashT * 0.8;
        ctx.globalAlpha = alpha;
        ctx.fillStyle   = flash ? '#ff4444' : '#ff8c00';
        ctx.beginPath(); ctx.arc(o.x + 8, gY - 8, rad, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;

      } else if (o.state === 'miss') {
        ctx.fillStyle = '#e05c2a';
        ctx.fillRect(o.x, gY - o.h, 10, o.h);
      }
      // passed は描画しない（通り抜け済み）
    }

    // ── スラッシュ線エフェクト（X字）──
    for (const fx of d.slashFx) {
      const alpha  = 1 - fx.t / 14;
      const spread = 10 + fx.t * 1.2;
      ctx.save();
      ctx.globalAlpha = alpha;
      if (fx.bad) {
        // 赤スラッシュ（ダメージ）
        ctx.strokeStyle = '#ff4444'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(fx.x - spread * 0.6, gY - 2);
        ctx.lineTo(fx.x + spread * 0.6, gY - fx.h - 6);
        ctx.stroke();
        ctx.strokeStyle = '#ff8c00'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(fx.x + spread * 0.5, gY - 2);
        ctx.lineTo(fx.x - spread * 0.5, gY - fx.h - 6);
        ctx.stroke();
      } else {
        // 白/金スラッシュ（成功）
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(fx.x - spread * 0.6, gY - 2);
        ctx.lineTo(fx.x + spread * 0.6, gY - fx.h - 6);
        ctx.stroke();
        ctx.strokeStyle = '#f5c518'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(fx.x + spread * 0.5, gY - 2);
        ctx.lineTo(fx.x - spread * 0.5, gY - fx.h - 6);
        ctx.stroke();
      }
      ctx.restore();
    }

    // ── ドラゴン ──
    this._drawDragon(ctx, 10 + offX, gY - DRG_H * px, d.frame, false, px);

    // ── HUD ──
    ctx.fillStyle = '#00ff41'; ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('♥'.repeat(d.lives) + '♡'.repeat(3 - d.lives), 4, 13);
    ctx.textAlign = 'right';
    ctx.fillText(`${d.score}pt`, cw - 4, 13);

    // ── グレード ──
    if (d.grade) {
      ctx.fillStyle  = d.gradeCol;
      ctx.font       = 'bold 10px monospace';
      ctx.textAlign  = 'center';
      ctx.fillText(d.grade, hitX, gY - 37);
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

      const dw = DRG_W * px, dh = DRG_H * px;
      const dx = Math.round(cw * this._drX / 100) - dw / 2;
      const dy = ch - dh - 2;
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
