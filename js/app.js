'use strict';

// ===================================================================
//  CONFIG
// ===================================================================
const Config = {
  DATA_FILE:            'spots.json',
  NORMAL_THRESHOLD:     30,    // m: この圏内でアラート表示・I'M HEREで発見
  RELAXED_THRESHOLD:    80,    // m: 「着いたよ」ボタンが有効になる半径
  MAX_DISPLAY_DISTANCE: 500,   // m: レーダー最大表示距離
  FAR_GPS_THRESHOLD:    200,   // m: これより遠いと低精度GPSモードに切替
  USE_LOG_SCALE:        true,  // 対数スケールでの距離描画
  COMPASS_ALPHA:        0.12,  // コンパス補間係数 (小さいほど滑らか)
  SCAN_SPEED:           1.5,   // レーダー走査線の速度 (度/フレーム)
  VIBRATE_NEAR:         [40],
  VIBRATE_FOUND:        [80, 60, 200, 60, 400],
};

// URLパラメータ
const _params = new URLSearchParams(location.search);
const DEBUG_MODE = _params.has('debug') || (_params.has('lat') && _params.has('lng'));
const ADMIN_MODE  = _params.get('admin') === 'true';
const DEBUG_LAT   = parseFloat(_params.get('lat'))  || null;
const DEBUG_LNG   = parseFloat(_params.get('lng'))  || null;

// ===================================================================
//  UTILS
// ===================================================================
const Geo = {
  /** Haversine公式: 2点間の距離(m) */
  distance(lat1, lng1, lat2, lng2) {
    const R  = 6371000;
    const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;
    const a  = Math.sin(Δφ/2)**2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },

  /** 2点間のベアリング(度, 北=0, 時計回り) */
  bearing(lat1, lng1, lat2, lng2) {
    const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;
    const y  = Math.sin(Δλ) * Math.cos(φ2);
    const x  = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  },

  /** 角度の線形補間 (360度ラップ対応) */
  lerpAngle(from, to, t) {
    const diff = ((to - from + 540) % 360) - 180;
    return (from + diff * t + 360) % 360;
  },

  formatDistance(m) {
    return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
  }
};

function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch (_) {}
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ===================================================================
//  STORAGE
// ===================================================================
const Store = {
  K_FOUND:   'dr-found',
  K_PENDING: 'dr-pending',
  K_PHOTOS:  'dr-photos',
  K_THEME:   'dr-theme',

  getFoundIds() {
    try { return new Set(JSON.parse(localStorage.getItem(this.K_FOUND) || '[]')); }
    catch { return new Set(); }
  },
  addFound(id) {
    const s = this.getFoundIds(); s.add(id);
    localStorage.setItem(this.K_FOUND, JSON.stringify([...s]));
  },
  clearFound() { localStorage.removeItem(this.K_FOUND); },

  getPending() {
    try { return JSON.parse(localStorage.getItem(this.K_PENDING) || '[]'); }
    catch { return []; }
  },
  savePending(spot) {
    const list = this.getPending();
    const idx  = list.findIndex(s => s.id === spot.id);
    if (idx >= 0) list[idx] = spot; else list.push(spot);
    localStorage.setItem(this.K_PENDING, JSON.stringify(list));
  },
  deletePending(id) {
    localStorage.setItem(this.K_PENDING, JSON.stringify(this.getPending().filter(s => s.id !== id)));
  },

  // 写真は {id, spotId, name, url, ts} の配列で保存 (時刻キー)
  PHOTO_LIMIT: 20,

  getPhotos() {
    let raw;
    try { raw = JSON.parse(localStorage.getItem(this.K_PHOTOS) || '[]'); }
    catch { return []; }
    // 旧形式 { spotId: dataUrl } を配列へ移行
    if (raw && !Array.isArray(raw) && typeof raw === 'object') {
      const keys = Object.keys(raw);
      const arr  = keys.map((spotId, i) => ({
        id: 'mig-' + i, spotId, name: '', url: raw[spotId],
        ts: Date.now() - (keys.length - i) * 1000
      }));
      try { localStorage.setItem(this.K_PHOTOS, JSON.stringify(arr)); } catch (_) {}
      return arr;
    }
    return Array.isArray(raw) ? raw : [];
  },
  photoCount()  { return this.getPhotos().length; },
  isPhotoFull() { return this.getPhotos().length >= this.PHOTO_LIMIT; },

  /** 写真を追加。上限超過は古いもの(ts昇順)から削除。容量不足時も削って再試行 */
  addPhoto(rec) {
    const list = this.getPhotos();
    list.push(rec);
    list.sort((a, b) => a.ts - b.ts);
    while (list.length > this.PHOTO_LIMIT) list.shift();
    try { localStorage.setItem(this.K_PHOTOS, JSON.stringify(list)); return true; }
    catch (_) {
      while (list.length > 1) {
        list.shift();
        try { localStorage.setItem(this.K_PHOTOS, JSON.stringify(list)); return true; }
        catch (__) { /* まだ足りない → さらに削る */ }
      }
      console.warn('写真の保存に失敗 (ストレージ不足)');
      return false;
    }
  },
  deletePhoto(id) {
    localStorage.setItem(this.K_PHOTOS, JSON.stringify(this.getPhotos().filter(p => p.id !== id)));
  },
  /** スポットの最新写真URL (発見演出の表示用) */
  getSpotPhoto(spotId) {
    return this.getPhotos()
      .filter(p => p.spotId === spotId)
      .sort((a, b) => b.ts - a.ts)[0]?.url ?? null;
  },

  getTheme() { return localStorage.getItem(this.K_THEME) || 'green'; },
  setTheme(id) { localStorage.setItem(this.K_THEME, id); },

  K_RANGE: 'dr-range',
  getRange() { return parseInt(localStorage.getItem(this.K_RANGE) ?? '3', 10); },
  setRange(idx) { localStorage.setItem(this.K_RANGE, String(idx)); },
};

// ===================================================================
//  RADAR THEMES
// ===================================================================
const RadarThemes = {
  green: {
    id: 'green',
    bg: '#1f8a3b',
    sweep: '0, 255, 65',
    blipNormal: '0, 255, 65',
    blipFound: '0, 140, 0',
    blipFoundStar: 'rgba(0, 200, 0, 0.55)',
    css: {
      '--green':       '#00ff41',
      '--green-mid':   '#00cc33',
      '--green-dim':   '#004d15',
      '--green-faint': 'rgba(0, 255, 65, 0.08)',
    },
  },
  blue: {
    id: 'blue',
    bg: '#0e2a4a',
    sweep: '20, 140, 255',
    blipNormal: '20, 140, 255',
    blipFound: '0, 80, 180',
    blipFoundStar: 'rgba(0, 100, 220, 0.55)',
    css: {
      '--green':       '#1a8cff',
      '--green-mid':   '#1070dd',
      '--green-dim':   '#082040',
      '--green-faint': 'rgba(20, 140, 255, 0.08)',
    },
  },
  red: {
    id: 'red',
    bg: '#5c1010',
    sweep: '255, 50, 50',
    blipNormal: '255, 50, 50',
    blipFound: '140, 0, 0',
    blipFoundStar: 'rgba(180, 0, 0, 0.55)',
    css: {
      '--green':       '#ff3232',
      '--green-mid':   '#cc2020',
      '--green-dim':   '#4d0808',
      '--green-faint': 'rgba(255, 50, 50, 0.08)',
    },
  },
};

// ===================================================================
//  GPS TRACKER
// ===================================================================
class GPSTracker {
  constructor() {
    this.watchId      = null;
    this.position     = null;  // { lat, lng, accuracy }
    this.highAccuracy = true;
    this.onUpdate     = null;  // (pos) => void
    this.onError      = null;  // (msg) => void
  }

  start() {
    if (!navigator.geolocation) { this.onError?.('GPS非対応のブラウザです'); return; }

    // デバッグ座標が指定されている場合は固定位置を使用
    if (DEBUG_LAT && DEBUG_LNG) {
      this.position = { lat: DEBUG_LAT, lng: DEBUG_LNG, accuracy: 5 };
      this.onUpdate?.(this.position);
      return;
    }
    this._watch(true);
  }

  _watch(highAccuracy) {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.highAccuracy = highAccuracy;
    this.watchId = navigator.geolocation.watchPosition(
      pos => {
        this.position = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        this.onUpdate?.(this.position);
      },
      err => {
        const msgs = ['', '位置情報の使用が拒否されました', 'GPS信号を取得できません', 'GPS取得タイムアウト'];
        this.onError?.(msgs[err.code] || 'GPSエラー', err.code === 1);
      },
      { enableHighAccuracy: highAccuracy, maximumAge: highAccuracy ? 2000 : 20000, timeout: 30000 }
    );
  }

  /** 近距離→高精度、遠距離→省電力モードに切替 */
  setHighAccuracy(high) {
    if (high !== this.highAccuracy) this._watch(high);
  }

  stop() {
    if (this.watchId !== null) { navigator.geolocation.clearWatch(this.watchId); this.watchId = null; }
  }
}

// ===================================================================
//  COMPASS TRACKER
// ===================================================================
class CompassTracker {
  constructor() {
    this.heading         = 0;
    this.smoothedHeading = 0;
    this.active          = false;
    this.onUpdate        = null;  // (heading) => void
    this._handler        = this._onOrientation.bind(this);
  }

  get needsPermission() {
    return typeof DeviceOrientationEvent?.requestPermission === 'function';
  }

  /** 許可不要な端末(Android等)では自動起動を試みる */
  tryAutoStart() {
    if (!this.needsPermission && 'DeviceOrientationEvent' in window) {
      window.addEventListener('deviceorientation', this._handler, true);
      this.active = true;
      return true;
    }
    return false;
  }

  /** iOS等、ユーザー操作起点で明示的に許可を求める */
  async requestPermission() {
    if (!('DeviceOrientationEvent' in window)) return false;
    if (this.needsPermission) {
      try {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') return false;
      } catch { return false; }
    }
    window.addEventListener('deviceorientation', this._handler, true);
    this.active = true;
    return true;
  }

  _onOrientation(evt) {
    let heading;
    if (evt.webkitCompassHeading != null) {
      // iOS: webkitCompassHeading は北=0, 時計回り (そのまま使える)
      heading = evt.webkitCompassHeading;
    } else if (evt.alpha != null) {
      // Android: alpha は反時計回りなので変換
      heading = (360 - evt.alpha + 360) % 360;
    } else {
      return;
    }
    // 指数移動平均でスムージング
    this.smoothedHeading = Geo.lerpAngle(this.smoothedHeading, heading, Config.COMPASS_ALPHA);
    this.heading = this.smoothedHeading;
    this.onUpdate?.(this.smoothedHeading);
  }

  stop() { window.removeEventListener('deviceorientation', this._handler, true); }
}

// ===================================================================
//  SPOT MANAGER
// ===================================================================
class SpotManager {
  constructor() {
    this.allSpots     = [];
    this.visibleSpots = [];
    this.foundIds     = new Set();
  }

  async load() {
    let jsonSpots = [];
    try {
      const res = await fetch(Config.DATA_FILE + '?t=' + Date.now());
      if (res.ok) jsonSpots = (await res.json()).spots || [];
    } catch { /* spots.json なくても動く */ }

    const map = new Map(jsonSpots.map(s => [s.id, s]));
    for (const p of Store.getPending()) map.set(p.id, p);
    this.allSpots     = [...map.values()].sort((a, b) => a.order - b.order);
    this.foundIds     = Store.getFoundIds();
    this.visibleSpots = this.allSpots;
  }

  _recalcVisible() {
    this.visibleSpots = this.allSpots;
  }

  /** 未発見スポットのうち最も近いものを返す */
  getClosest(pos) {
    if (!pos) return null;
    let closest = null, minDist = Infinity;
    for (const s of this.visibleSpots) {
      if (this.foundIds.has(s.id)) continue;
      const d = Geo.distance(pos.lat, pos.lng, s.lat, s.lng);
      if (d < minDist) { minDist = d; closest = s; }
    }
    return closest;
  }

  markFound(spot) {
    this.foundIds.add(spot.id);
    Store.addFound(spot.id);
    this.visibleSpots = this.allSpots;
  }

  isFound(id)   { return this.foundIds.has(id); }
  get total()   { return this.allSpots.length; }
  get found()   { return this.foundIds.size; }
  get allDone() { return this.allSpots.length > 0 && this.foundIds.size >= this.allSpots.length; }
}

// ===================================================================
//  RADAR RENDERER  (Canvas 2D)
// ===================================================================
class RadarRenderer {
  constructor(canvas) {
    this.canvas         = canvas;
    this.ctx            = canvas.getContext('2d');
    this.scanAngle      = 0;
    this.W = 0; this.H = 0;
    this.cx = 0; this.cy = 0;
    this.radius = 0; this.sweepR = 0;
    this._animId        = null;
    this._blipFlash     = new Map();  // spotId -> timestamp of last scan pass
    this._blipPositions = new Map();  // spotId -> {x, y} (canvas座標)
    this.theme          = RadarThemes.green;
  }

  /** タップ座標に最も近いブリップのspot IDを返す */
  hitTest(px, py) {
    const HIT_R = 18;
    let bestId = null, bestDist = HIT_R;
    for (const [id, {x, y}] of this._blipPositions) {
      const d = Math.hypot(px - x, py - y);
      if (d < bestDist) { bestDist = d; bestId = id; }
    }
    return bestId;
  }

  resize() {
    // 利用可能領域に収まる正方形スクリーンにする
    // (.radar-frame はキャンバスに合わせて縮むので、外側の #radar-wrapper を基準に測る)
    const frame  = this.canvas.parentElement;            // .radar-frame
    const host   = frame.parentElement || frame;         // #radar-wrapper
    const FRAME_PAD = 22;  // .radar-frame の padding(両側合計) + 余白
    const availW = (host.clientWidth  || window.innerWidth) - FRAME_PAD;
    const availH = (host.clientHeight || 300) - FRAME_PAD;
    const side   = Math.max(Math.min(availW, availH), 160);
    // CSS表示サイズを正方形に固定し、背景バッファは枠線内側(content box)に合わせる
    this.canvas.style.width  = side + 'px';
    this.canvas.style.height = side + 'px';
    const inner = this.canvas.clientWidth || side;
    this.canvas.width  = inner;
    this.canvas.height = inner;
    this.W      = inner;
    this.H      = inner;
    this.cx     = inner / 2;
    this.cy     = inner / 2;
    this.radius = inner / 2 - 10;        // 距離スケールの基準半径
    this.sweepR = Math.hypot(inner, inner) / 2;  // スウィープが四隅まで届く長さ
  }

  start(getState) {
    const loop = () => {
      const s = getState();
      this._draw(s.spots, s.heading, s.position, s.closestId, s.foundIds);
      this._animId = requestAnimationFrame(loop);
    };
    this._animId = requestAnimationFrame(loop);
  }

  stop() { if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; } }

  _draw(spots, heading, pos, closestId, foundIds) {
    const ctx = this.ctx;
    const cx  = this.cx;
    const cy  = this.cy;
    const r   = this.radius;
    const W   = this.W;
    const H   = this.H;

    ctx.clearRect(0, 0, W, H);

    // 背景
    ctx.fillStyle = this.theme.bg;
    ctx.fillRect(0, 0, W, H);

    // 格子グリッド(黒) — 中心を基準に正方形マスを長方形いっぱいに敷く
    const cell = Math.min(W, H) / 8;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = cx; x >= 0; x -= cell)     { ctx.moveTo(x, 0); ctx.lineTo(x, H); }  // 縦線(左)
    for (let x = cx + cell; x <= W; x += cell) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }  // 縦線(右)
    for (let y = cy; y >= 0; y -= cell)     { ctx.moveTo(0, y); ctx.lineTo(W, y); }  // 横線(上)
    for (let y = cy + cell; y <= H; y += cell) { ctx.moveTo(0, y); ctx.lineTo(W, y); }  // 横線(下)
    ctx.stroke();

    // --- 走査線スウィープ ---
    const scanRad = (this.scanAngle - 90) * Math.PI / 180;
    const sweepR  = this.sweepR;

    // スウィープ残光 (扇形を段階的に描画)
    const trailArc   = Math.PI * 0.55;
    const trailSteps = 24;
    for (let i = 0; i < trailSteps; i++) {
      const frac   = i / trailSteps;
      const alpha  = 0.10 * (1 - frac);
      const startA = scanRad - trailArc * (i + 1) / trailSteps;
      const endA   = scanRad - trailArc * i / trailSteps;
      ctx.fillStyle = `rgba(${this.theme.sweep}, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, sweepR, startA, endA);
      ctx.closePath();
      ctx.fill();
    }

    // 走査線本体
    ctx.strokeStyle = `rgba(${this.theme.sweep}, 0.85)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(scanRad) * sweepR, cy + Math.sin(scanRad) * sweepR);
    ctx.stroke();

    this.scanAngle = (this.scanAngle + Config.SCAN_SPEED) % 360;

    // --- スポット描画 ---
    const now = Date.now();
    this._blipPositions.clear();
    if (pos && spots) {
      for (const spot of spots) {
        const dist = Geo.distance(pos.lat, pos.lng, spot.lat, spot.lng);
        const bear = Geo.bearing(pos.lat, pos.lng, spot.lat, spot.lng);

        // コンパスのheadingを引いて「自機固定、マップ回転」を実現
        const relDeg = (bear - heading + 360) % 360;
        const relRad = (relDeg - 90) * Math.PI / 180;

        // 距離を対数スケールで基準半径にマッピング
        const maxD = Config.MAX_DISPLAY_DISTANCE;
        let dr;
        if (Config.USE_LOG_SCALE) {
          dr = Math.log1p(dist) / Math.log1p(maxD) * r;
        } else {
          dr = Math.min(dist / maxD, 1) * r;
        }
        dr = Math.min(dr, r - 9);

        const x = cx + Math.cos(relRad) * dr;
        const y = cy + Math.sin(relRad) * dr;

        // ヒットテスト用に位置を記録
        this._blipPositions.set(spot.id, { x, y });

        const isFound   = foundIds.has(spot.id);
        const isClosest = spot.id === closestId;

        // 走査線がブリップを通過した瞬間を記録 → 点滅演出
        const spotScreenAngle = relDeg; // 0=上
        const scanScreenAngle = (this.scanAngle + 270) % 360;
        const angleDiff       = Math.abs(((spotScreenAngle - scanScreenAngle + 540) % 360) - 180);
        if (angleDiff < 4) this._blipFlash.set(spot.id, now);
        const flashAge   = now - (this._blipFlash.get(spot.id) || 0);
        const flashAlpha = Math.max(0, 1 - flashAge / 1200);

        // 色・サイズ
        let color, size;
        if (isFound) {
          color = `rgba(${this.theme.blipFound}, ${0.35 + flashAlpha * 0.4})`;
          size  = 6;
        } else if (isClosest) {
          color = `rgba(255, 221, 0, ${0.75 + flashAlpha * 0.25})`;
          size  = 9;
        } else {
          color = `rgba(${this.theme.blipNormal}, ${0.55 + flashAlpha * 0.35})`;
          size  = 7;
        }

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();

        // 最寄りスポットのパルスリング
        if (isClosest) {
          const pulse = 12 + Math.sin(now / 280) * 4;
          ctx.strokeStyle = `rgba(255, 221, 0, 0.35)`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, pulse, 0, Math.PI * 2);
          ctx.stroke();
        }

        // 発見済みは星マーク
        if (isFound) {
          ctx.fillStyle = this.theme.blipFoundStar;
          ctx.font = '9px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('★', x, y);
        }

      }
    }

    // --- 北インジケータ N (白・マップ回転に追従し四角内に収める) ---
    const northDeg = (0 - heading + 360) % 360;
    const northRad = (northDeg - 90) * Math.PI / 180;
    const nr = r - 4;  // 基準半径の内側 → 必ず正方形内
    const nx = cx + Math.cos(northRad) * nr;
    const ny = cy + Math.sin(northRad) * nr;
    ctx.fillStyle    = '#ffffff';
    ctx.shadowColor  = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur   = 3;
    ctx.font         = "bold 13px 'Silkscreen', monospace";
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny);
    ctx.shadowBlur   = 0;

    // --- 自機 (常に中央・上向き) ---
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur  = 8;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // 自機方向矢印 (上向き固定・白)
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur  = 4;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 18);
    ctx.lineTo(cx - 5, cy - 8);
    ctx.moveTo(cx, cy - 18);
    ctx.lineTo(cx + 5, cy - 8);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineCap    = 'butt';

    // --- ガラスの艶 (上部のリフレクション) ---
    const gloss = ctx.createLinearGradient(0, 0, W * 0.5, H * 0.55);
    gloss.addColorStop(0,    'rgba(255, 255, 255, 0.10)');
    gloss.addColorStop(0.25, 'rgba(255, 255, 255, 0.03)');
    gloss.addColorStop(0.5,  'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gloss;
    ctx.fillRect(0, 0, W, H);

    // --- HUD (隅にGPS精度と発見数) ---
    ctx.font         = "14px 'Silkscreen', monospace";
    ctx.textBaseline = 'top';
    ctx.shadowColor  = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur   = 3;
    ctx.fillStyle    = 'rgba(240, 255, 244, 0.9)';
    // GPS精度 (左上)
    ctx.textAlign = 'left';
    ctx.fillText(pos ? `GPS ±${Math.round(pos.accuracy)}M` : 'GPS --', 16, 16);
    // 発見数 (右上)
    ctx.textAlign = 'right';
    const total = spots ? spots.length : 0;
    const found = foundIds ? foundIds.size : 0;
    ctx.fillText(`${found}/${total}`, W - 16, 16);
    ctx.shadowBlur = 0;
  }
}

// ===================================================================
//  CAMERA MANAGER
// ===================================================================
class CameraManager {
  constructor() {
    this.modal    = document.getElementById('camera-modal');
    this.video    = document.getElementById('camera-video');
    this.canvas   = document.getElementById('camera-canvas');
    this.ctx      = this.canvas.getContext('2d');
    this.stream   = null;
    this._animId  = null;
    this.spotName = '';
    this.onSave   = null;  // (dataUrl) => void
  }

  async open(spotName) {
    this.spotName = spotName || '';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.modal.hidden = false;
      this._startLoop();
    } catch (err) {
      alert('カメラを起動できませんでした:\n' + (err.message || err));
    }
  }

  _startLoop() {
    const loop = () => {
      this._drawFrame();
      this._animId = requestAnimationFrame(loop);
    };
    this._animId = requestAnimationFrame(loop);
  }

  _drawFrame() {
    if (this.video.readyState < 2) return;
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh) return;

    // 正方形にクロップして描画
    const edge = Math.min(vw, vh);
    const size = Math.min(
      Math.floor(window.innerWidth  * 0.88),
      Math.floor(window.innerHeight * 0.72),
      560
    );
    this.canvas.width  = size;
    this.canvas.height = size;

    const ctx = this.ctx;
    const c   = size / 2;
    const r   = c;

    // 円形クリップ
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, r - 3, 0, Math.PI * 2);
    ctx.clip();

    // カメラ映像 (中央正方形クロップ)
    ctx.drawImage(
      this.video,
      (vw - edge) / 2, (vh - edge) / 2, edge, edge,
      0, 0, size, size
    );
    ctx.restore();

    this._drawOverlay(ctx, c, r, size);
  }

  _drawOverlay(ctx, c, r, size) {
    const WHITE  = 'rgba(255,255,255,0.92)';
    const ORANGE = '#f05a22';

    // 外枠リング (白・クリーン)
    ctx.strokeStyle = WHITE;
    ctx.lineWidth   = 3;
    ctx.beginPath();
    ctx.arc(c, c, r - 3, 0, Math.PI * 2);
    ctx.stroke();

    // 中央レティクル (十字 + 中央オレンジドット)
    ctx.strokeStyle = WHITE;
    ctx.lineWidth   = 1.5;
    const g = 14, len = 32;
    ctx.beginPath();
    ctx.moveTo(c - len, c); ctx.lineTo(c - g, c);
    ctx.moveTo(c + g,  c); ctx.lineTo(c + len, c);
    ctx.moveTo(c, c - len); ctx.lineTo(c, c - g);
    ctx.moveTo(c, c + g);  ctx.lineTo(c, c + len);
    ctx.stroke();
    ctx.fillStyle = ORANGE;
    ctx.beginPath(); ctx.arc(c, c, 3.5, 0, Math.PI * 2); ctx.fill();

    // 四隅ブラケット (円内に収める・白)
    const bLen = 20, bOff = size * 0.2;
    ctx.strokeStyle = WHITE;
    ctx.lineWidth   = 2;
    [
      [bOff,        bOff,         1,  1],
      [size - bOff, bOff,        -1,  1],
      [bOff,        size - bOff,  1, -1],
      [size - bOff, size - bOff, -1, -1],
    ].forEach(([x, y, dx, dy]) => {
      ctx.beginPath();
      ctx.moveTo(x + dx * bLen, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * bLen);
      ctx.stroke();
    });

    // 下部バナー: スポット名(1行) or 座標(2行)
    if (this.spotName) {
      const lines = this.spotName.split('\n');
      const isCoord = lines.length > 1;
      const fontSize = isCoord ? Math.min(14, r / 9) : Math.min(18, r / 7);
      const lineH    = fontSize * 1.6;
      const bH       = Math.max(isCoord ? 50 : 32, isCoord ? lineH * 2 + 12 : size * 0.09);
      const bannerY  = size - bH;

      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, bannerY, size, bH);

      ctx.font         = isCoord
        ? `${fontSize}px 'Silkscreen', monospace`
        : `${fontSize}px 'DotGothic16', sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';

      if (!isCoord) {
        // スポット名: オレンジドット + 白文字
        const cy = size - bH / 2;
        const tw = ctx.measureText(lines[0]).width;
        ctx.fillStyle = ORANGE;
        ctx.beginPath();
        ctx.arc(c - tw / 2 - 12, cy, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(lines[0], c, cy);
      } else {
        // 座標2行: 1行目=オレンジ(LAT), 2行目=薄グレー(LNG)
        const totalH = lineH * lines.length;
        const startY = size - bH / 2 - totalH / 2 + lineH / 2;
        lines.forEach((line, i) => {
          ctx.fillStyle = i === 0 ? ORANGE : 'rgba(255,255,255,0.65)';
          ctx.fillText(line, c, startY + i * lineH);
        });
      }
    }

    // HUD: REC (左上) + SPOT-RADAR (中央) + 時刻 (右上)
    const hy = size * 0.135;
    ctx.textBaseline = 'middle';

    // REC ドット
    ctx.fillStyle = ORANGE;
    ctx.beginPath(); ctx.arc(size * 0.15, hy, 4, 0, Math.PI * 2); ctx.fill();
    ctx.font      = "10px 'Silkscreen', monospace";
    ctx.fillStyle = WHITE;
    ctx.textAlign = 'left';
    ctx.fillText('REC', size * 0.15 + 8, hy);

    // SPOT-RADAR ブランドラベル (中央)
    ctx.font      = "bold 13px 'Silkscreen', monospace";
    ctx.textAlign = 'center';
    ctx.fillStyle = WHITE;
    ctx.globalAlpha = 0.85;
    ctx.fillText('SPOT-RADAR', c, hy);
    ctx.globalAlpha = 1;

    // 時刻 (右上)
    ctx.font      = "10px 'Silkscreen', monospace";
    ctx.textAlign = 'right';
    ctx.fillStyle = WHITE;
    ctx.fillText(new Date().toLocaleTimeString('ja-JP'), size * 0.85, hy);
  }

  capture() {
    const dataUrl = this.canvas.toDataURL('image/jpeg', 0.88);
    this.onSave?.(dataUrl);
    return dataUrl;
  }

  close() {
    if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.modal.hidden = true;
  }
}

// ===================================================================
//  ADMIN PANEL
// ===================================================================
class AdminPanel {
  constructor(spots, gps) {
    this.spots     = spots;
    this.gps       = gps;
    this.panel     = document.getElementById('admin-panel');
    this._editingId = null;   // 編集中スポットのID (新規追加時は null)
    this._bind();
  }

  _bind() {
    document.getElementById('close-admin-btn').onclick   = () => this.close();
    document.getElementById('register-spot-btn').onclick = () => this._save();
    document.getElementById('cancel-edit-btn').onclick   = () => this._resetForm();
    document.getElementById('fill-gps-btn').onclick      = () => this._fillGPS();
    document.getElementById('clear-found-btn').onclick   = () => {
      if (confirm('発見履歴をすべて消去しますか?')) {
        Store.clearFound();
        location.reload();
      }
    };
  }

  open() { this.panel.hidden = false; this._resetForm(); this._renderList(); }
  close() { this.panel.hidden = true; }

  _status(msg, autoClear = true) {
    const el = document.getElementById('register-status');
    el.textContent = msg;
    if (autoClear) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3000);
  }

  /** 現在地GPS値を座標フィールドに自動入力 */
  _fillGPS() {
    const pos = this.gps.position;
    if (!pos) { this._status('⚠ GPS未取得 - しばらく待ってください'); return; }
    document.getElementById('spot-coord-input').value = `${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}`;
    this._status(`現在地を入力しました (±${Math.round(pos.accuracy)}m)`);
  }

  /** "緯度, 経度" 文字列をパース。失敗時は null */
  _parseCoord(raw) {
    // 全角カンマ・空白も許容
    const parts = raw.replace(/，/g, ',').split(',').map(s => s.trim()).filter(s => s !== '');
    if (parts.length !== 2) return null;
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  }

  _save() {
    const name   = document.getElementById('spot-name-input').value.trim();
    const rawCoord = document.getElementById('spot-coord-input').value.trim();
    const radius = parseInt(document.getElementById('spot-radius-input').value) || 30;

    if (!name) { this._status('⚠ 名前を入力してください', false); return; }

    // 座標: 入力があればパース、空ならGPS
    let lat, lng;
    if (rawCoord !== '') {
      const c = this._parseCoord(rawCoord);
      if (!c) { this._status('⚠ 座標は「緯度, 経度」の形式で入力してください', false); return; }
      ({ lat, lng } = c);
    } else {
      const pos = this.gps.position;
      if (!pos) { this._status('⚠ 座標を入力するか、GPS取得をお待ちください', false); return; }
      lat = pos.lat; lng = pos.lng;
    }

    if (this._editingId) {
      // --- 編集 ---
      const spot = this.spots.allSpots.find(s => s.id === this._editingId);
      if (!spot) { this._resetForm(); return; }
      Object.assign(spot, { name, lat, lng, radius, _pending: true });
      Store.savePending({ id: spot.id, name, lat, lng, radius, order: spot.order });
      this._status(`✓ 「${name}」を更新しました`);
    } else {
      // --- 新規追加 ---
      const dupe = this.spots.allSpots.find(s => Geo.distance(lat, lng, s.lat, s.lng) < 10);
      if (dupe && !confirm(`「${dupe.name}」の近くに既存スポットがあります。続けますか?`)) return;

      const order = this.spots.allSpots.reduce((m, s) => Math.max(m, s.order || 0), 0) + 1;
      const spot  = { id: genId(), name, lat, lng, radius, order, _pending: true };
      Store.savePending(spot);
      this.spots.allSpots.push(spot);
      this._status(`✓ 「${name}」を追加しました`);
    }

    this.spots.allSpots.sort((a, b) => a.order - b.order);
    this.spots._recalcVisible();
    this._resetForm();
    this._renderList();
  }

  _resetForm() {
    this._editingId = null;
    document.getElementById('spot-name-input').value   = '';
    document.getElementById('spot-coord-input').value  = '';
    document.getElementById('spot-radius-input').value = '';
    document.getElementById('spot-form-title').textContent = 'スポットを追加';
    document.querySelector('#register-spot-btn .ep-inside').textContent = '追加する';
    document.getElementById('cancel-edit-btn').hidden = true;
  }

  _startEdit(id) {
    const s = this.spots.allSpots.find(sp => sp.id === id);
    if (!s) return;
    this._editingId = id;
    document.getElementById('spot-name-input').value   = s.name;
    document.getElementById('spot-coord-input').value  = `${s.lat.toFixed(6)}, ${s.lng.toFixed(6)}`;
    document.getElementById('spot-radius-input').value = s.radius;
    document.getElementById('spot-form-title').textContent = 'スポットを編集';
    document.querySelector('#register-spot-btn .ep-inside').textContent = '更新する';
    document.getElementById('cancel-edit-btn').hidden = false;
    this.panel.scrollTo({ top: 0, behavior: 'smooth' });
  }

  _delete(id) {
    const s = this.spots.allSpots.find(sp => sp.id === id);
    if (!s) return;
    if (!confirm(`「${s.name}」を削除しますか?`)) return;
    Store.deletePending(id);
    this.spots.allSpots = this.spots.allSpots.filter(sp => sp.id !== id);
    this.spots._recalcVisible();
    if (this._editingId === id) this._resetForm();
    this._renderList();
  }

  _renderList() {
    const el = document.getElementById('admin-spot-list');
    if (!this.spots.allSpots.length) { el.textContent = 'スポットがありません'; return; }
    el.innerHTML = '';
    for (const s of this.spots.allSpots) {
      const div = document.createElement('div');
      div.className = 'admin-spot-item' + (s._pending ? ' pending' : '');
      div.innerHTML = `
        <div class="admin-spot-info">
          <strong>${s.name}</strong>
          <div class="admin-spot-coords">
            ${s.lat.toFixed(5)}, ${s.lng.toFixed(5)} ／ 半径 ${s.radius}m${s._pending ? ' ・未push' : ''}
          </div>
        </div>
        <div class="admin-spot-actions">
          <button class="ep-button admin-spot-edit" type="button" data-id="${s.id}"><span class="ep-inside gray">編集</span></button>
          <button class="ep-button admin-spot-delete" type="button" data-id="${s.id}"><span class="ep-inside dark-gray">削除</span></button>
        </div>
      `;
      el.appendChild(div);
    }
    el.querySelectorAll('.admin-spot-edit').forEach(btn => {
      btn.onclick = () => this._startEdit(btn.dataset.id);
    });
    el.querySelectorAll('.admin-spot-delete').forEach(btn => {
      btn.onclick = () => this._delete(btn.dataset.id);
    });
  }
}

// ===================================================================
//  APP  (メインコーディネーター)
// ===================================================================
class App {
  constructor() {
    this.gps     = new GPSTracker();
    this.compass = new CompassTracker();
    this.spots   = new SpotManager();
    this.radar   = new RadarRenderer(document.getElementById('radar-canvas'));
    this.camera  = new CameraManager();
    this.admin   = null;

    // 圏内エントリー追跡 (バイブ一度だけ)
    this._confirmSpotId   = null;
    this._lastFoundSpot   = null;

    // 手動座標オーバーライド
    this._mockPos = null;

    // ドラクエ風メッセージのタイプライター
    this._typeTimer    = null;
    this._selectedSpotId = null;

    // 写真ギャラリー
    this._galPhotos = [];
    this._galPage   = 0;
    this._galZoomIdx = null;
    this._cameraSpot = null;  // カメラ撮影対象のスポット
  }

  /** 現在位置: 手動入力があればそちらを優先 */
  _getPosition() {
    return this._mockPos ?? this.gps.position;
  }

  _setMockPosition(lat, lng) {
    this._mockPos = { lat, lng, accuracy: 1 };
    const el = document.getElementById('gps-status');
    el.textContent = `GPS: [手動] ${lat.toFixed(4)},${lng.toFixed(4)}`;
    el.className   = 'gps-status ok';
    document.getElementById('clear-mock-pos-btn').hidden = false;
    document.getElementById('set-mock-pos-btn').hidden   = true;
    document.getElementById('mock-pos-status').textContent =
      `✓ 手動座標を使用中 (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
    this._checkProximity();
    this._refreshUI();
    if (DEBUG_MODE) this._updateDebug();
  }

  _clearMockPosition() {
    this._mockPos = null;
    document.getElementById('clear-mock-pos-btn').hidden = true;
    document.getElementById('set-mock-pos-btn').hidden   = false;
    document.getElementById('mock-pos-status').textContent = 'GPS に戻しました';
    setTimeout(() => { document.getElementById('mock-pos-status').textContent = ''; }, 2000);
    // GPS の最新値で即時更新
    if (this.gps.position) this._onGPSUpdate(this.gps.position);
  }

  async init() {
    await this.spots.load();
    this._setupCamera();
    this._setupUI();
    this._startGPS();
    this._setupCompass();
    this.radar.resize();
    this.radar.start(() => ({
      spots:     this.spots.visibleSpots,
      heading:   this.compass.heading,
      position:  this._getPosition(),
      closestId: this.spots.getClosest(this._getPosition())?.id ?? null,
      foundIds:  this.spots.foundIds,
    }));
    this._applyTheme(Store.getTheme());
    this._setupRangeCtrl();
    this._setupModeButtons();
    this._refreshUI();

    if (ADMIN_MODE) this._openAdmin();
    if (DEBUG_MODE) document.getElementById('debug-panel').hidden = false;
  }

  // ----- GPS -----
  _startGPS() {
    this.gps.onUpdate = pos => {
      this._onGPSUpdate(pos);
    };
    this.gps.onError = (_msg, isDenied) => {
      const el = document.getElementById('gps-status');
      el.textContent = 'GPS: エラー';
      el.className   = 'gps-status error';
      if (isDenied) document.getElementById('permission-screen').hidden = false;
    };
    this.gps.start();
  }

  _onGPSUpdate(pos) {
    const el = document.getElementById('gps-status');
    el.textContent = `GPS: ±${Math.round(pos.accuracy)}m`;
    el.className   = 'gps-status ok';

    // 省電力: ターゲットへの距離に応じてGPS精度を切替
    const t = this.spots.currentTarget;
    if (t) {
      const d = Geo.distance(pos.lat, pos.lng, t.lat, t.lng);
      this.gps.setHighAccuracy(d < Config.FAR_GPS_THRESHOLD);
    }

    this._checkProximity();
    this._refreshUI();
    if (this._currentMode === 1) this._renderSpotList();
    if (DEBUG_MODE) this._updateDebug();
  }

  // ----- Compass -----
  _setupCompass() {
    this.compass.onUpdate = () => { /* radar reads compass.heading directly */ };
    const autoStarted = this.compass.tryAutoStart();
    if (autoStarted) {
      document.getElementById('compass-permit-btn').hidden = true;
    }
  }

  // ----- 近接判定 -----
  _checkProximity() {
    const pos     = this._getPosition();
    const closest = this.spots.getClosest(pos);
    if (!closest || !pos) { this._confirmSpotId = null; return; }

    const dist = Geo.distance(pos.lat, pos.lng, closest.lat, closest.lng);

    if (dist <= Config.NORMAL_THRESHOLD) {
      // 圏内に入った瞬間だけバイブ
      if (this._confirmSpotId !== closest.id) {
        this._confirmSpotId = closest.id;
        vibrate(Config.VIBRATE_NEAR);
      }
    } else {
      this._confirmSpotId = null;
    }
  }

  // ----- 発見処理 -----
  _foundSpot(spot) {
    if (this.spots.isFound(spot.id)) return;  // 二重発火防止
    this._confirmSpotId = null;
    this._confirmStart  = null;
    this._lastFoundSpot = spot;

    this.spots.markFound(spot);
    this._selectedSpotId = null;  // 再タップで「発見済み」メッセージを出せるように
    vibrate(Config.VIBRATE_FOUND);

    // 発見オーバーレイ
    document.getElementById('found-stars').textContent = '★'.repeat(spot.order);
    document.getElementById('found-name').textContent  = spot.name;

    // 保存済み写真があれば表示
    const photoUrl = Store.getSpotPhoto(spot.id);
    const fc       = document.getElementById('found-photo-container');
    fc.innerHTML   = photoUrl ? `<img src="${photoUrl}" alt="記念写真">` : '';

    document.getElementById('found-overlay').hidden = false;
    this._refreshUI();
  }

  // ----- 「着いたよ」ボタン -----
  _handleArrived() {
    const pos     = this._getPosition();
    const closest = this.spots.getClosest(pos);
    if (!closest || !pos) return;

    const dist = Geo.distance(pos.lat, pos.lng, closest.lat, closest.lng);

    if (dist <= Config.RELAXED_THRESHOLD) {
      this._foundSpot(closest);
    } else {
      // 遠いときはコンソールにドラクエ風メッセージを出す
      const remaining = Math.round(dist - Config.RELAXED_THRESHOLD);
      this._selectedSpotId = null;
      this._typeMessage(`「${closest.name}」には まだ とどかない…\nあと ${remaining}m ちかづこう！`);
    }
  }

  // ----- UI更新 -----
  _refreshUI() {
    const pos     = this._getPosition();
    const closest = this.spots.getClosest(pos);

    document.getElementById('score-display').textContent =
      `${this.spots.found}/${this.spots.total}`;

    if (!closest) {
      document.getElementById('target-name').textContent     = this.spots.allDone ? '全スポット制覇！' : 'スポットなし';
      document.getElementById('target-distance').textContent = '';
      document.getElementById('arrived-btn').disabled        = true;
      this._setAlert('');
      return;
    }

    document.getElementById('target-name').textContent = `■いちばんちかいばしょ: ${closest.name}`;

    if (!pos) {
      document.getElementById('target-distance').textContent = 'GPS取得中...';
      document.getElementById('arrived-btn').disabled = true;
      this._setAlert('');
      return;
    }

    const dist      = Geo.distance(pos.lat, pos.lng, closest.lat, closest.lng);
    const inNormal  = dist <= Config.NORMAL_THRESHOLD;

    document.getElementById('target-distance').textContent = `└キョリ：${Geo.formatDistance(dist)}`;
    document.getElementById('arrived-btn').disabled        = false;

    if (inNormal) {
      this._setAlert('目的地到着！ 「I\'M HERE!」ボタンを押して記念写真を撮ろう');
    } else {
      this._setAlert('');
    }
  }

  /** 読み取り欄の赤い点滅アラート (圏内カウントダウン用) */
  _setAlert(text) {
    const el = document.getElementById('panel-alert');
    if (!el) return;
    if (text) {
      el.textContent = text;
      el.classList.add('show');
    } else {
      el.textContent = '';
      el.classList.remove('show');
    }
  }

  // ----- 写真ギャラリー (レーダー枠内) -----
  _openGallery() {
    this._galPhotos = this._collectPhotos();
    this._galPage   = 0;
    document.getElementById('gallery-zoom').hidden    = true;
    document.getElementById('gallery-overlay').hidden = false;
    this._renderGallery();
  }

  _closeGallery() {
    document.getElementById('gallery-overlay').hidden = true;
  }

  /** localStorageの写真を新しい順に {id, name, url, ts} で取得 */
  _collectPhotos() {
    return Store.getPhotos()
      .slice()
      .sort((a, b) => b.ts - a.ts)
      .map(p => ({
        id:   p.id,
        url:  p.url,
        ts:   p.ts,
        name: p.name || this.spots.allSpots.find(s => s.id === p.spotId)?.name || '記念写真'
      }));
  }

  _galPageCount() { return Math.max(1, Math.ceil(this._galPhotos.length / 4)); }

  _renderGallery() {
    const grid      = document.getElementById('gallery-grid');
    const pageCount = this._galPageCount();
    this._galPage   = Math.max(0, Math.min(this._galPage, pageCount - 1));
    grid.innerHTML  = '';

    if (this._galPhotos.length === 0) {
      grid.innerHTML = '<div class="gallery-empty">まだ写真がありません</div>';
      document.getElementById('gallery-page').textContent = '0/0';
      return;
    }

    const start = this._galPage * 4;
    this._galPhotos.slice(start, start + 4).forEach((p, i) => {
      const idx  = start + i;
      const cell = document.createElement('div');
      cell.className = 'gallery-thumb';
      const img  = document.createElement('img');
      img.src    = p.url;
      cell.append(img);
      cell.onclick = () => this._zoomPhoto(idx);
      grid.appendChild(cell);
    });
    document.getElementById('gallery-page').textContent = `${this._galPage + 1}/${pageCount}`;
  }

  _galTurn(dir) {
    const next = this._galPage + dir;
    if (next < 0 || next >= this._galPageCount()) return;
    this._galPage = next;
    this._renderGallery();
  }

  _zoomPhoto(idx) {
    const p = this._galPhotos[idx];
    if (!p) return;
    this._galZoomIdx = idx;
    document.getElementById('gallery-zoom-img').src = p.url;
    document.getElementById('gallery-zoom').hidden  = false;
  }

  _unzoom() { document.getElementById('gallery-zoom').hidden = true; }

  _deleteCurrentPhoto() {
    const p = this._galPhotos[this._galZoomIdx];
    if (!p) return;
    if (!confirm(`「${p.name}」の写真を削除しますか?`)) return;
    Store.deletePhoto(p.id);
    this._galPhotos = this._collectPhotos();
    if (this._galPhotos.length === 0) {
      this._unzoom();
      this._renderGallery();
      return;
    }
    this._galZoomIdx = Math.min(this._galZoomIdx, this._galPhotos.length - 1);
    this._galPage = Math.floor(this._galZoomIdx / 4);
    this._zoomPhoto(this._galZoomIdx);
    this._renderGallery();
  }

  /** 拡大中の写真を保存
   *  1. PC Chrome/Edge: showSaveFilePicker (保存ダイアログ)
   *  2. iOS Safari/PWA: Web Share API → 共有シートで「画像を保存」
   *  3. その他 (Android等): <a download> でダウンロードフォルダへ
   */
  async _saveCurrentPhoto() {
    const p = this._galPhotos[this._galZoomIdx];
    if (!p) return;
    const stamp = new Date(p.ts || Date.now()).toISOString().slice(0, 19).replace(/[:T]/g, '');
    const safeName = (p.name || 'photo').replace(/[\\/:*?"<>|\s]/g, '');
    const fname = `spot-radar_${safeName}_${stamp}.jpg`;

    let blob = null;
    try { blob = await (await fetch(p.url)).blob(); } catch (_) {}

    // ① PC: ファイル保存ダイアログ
    if (blob && window.showSaveFilePicker) {
      try {
        const fh = await window.showSaveFilePicker({
          suggestedName: fname,
          types: [{ description: 'JPEG image', accept: { 'image/jpeg': ['.jpg'] } }],
        });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
        return;
      } catch (e) {
        if (e.name !== 'AbortError') { /* キャンセル以外はフォールスルー */ }
        else return;
      }
    }

    // ② iOS等: Web Share API (共有シート → 「画像を保存」)
    if (blob) {
      const file = new File([blob], fname, { type: blob.type || 'image/jpeg' });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: p.name }); return; }
        catch (e) { if (e.name === 'AbortError') return; }
      }
    }

    // ③ フォールバック: <a download> (Android / Desktop)
    const a = document.createElement('a');
    a.href = p.url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  _updateDebug() {
    const pos     = this._getPosition();
    const closest = this.spots.getClosest(pos);
    const dist    = pos && closest ? Math.round(Geo.distance(pos.lat, pos.lng, closest.lat, closest.lng)) : '?';
    const conf    = this._confirmStart
      ? `${((Date.now() - this._confirmStart) / 1000).toFixed(1)}s`
      : 'no';
    document.getElementById('debug-content').textContent =
      `GPS: ${pos ? `${pos.lat.toFixed(5)},${pos.lng.toFixed(5)} ±${Math.round(pos.accuracy)}m` : 'N/A'}` +
      ` | Compass: ${Math.round(this.compass.heading)}°` +
      ` | Closest: ${closest?.name ?? 'none'} (${dist}m)` +
      ` | Confirm: ${conf}` +
      (this._mockPos ? ' | [手動座標]' : '');
  }

  // ----- カメラ -----
  _setupCamera() {
    this.camera.onSave = dataUrl => {
      const spot = this._cameraSpot;
      Store.addPhoto({
        id:     genId(),
        spotId: spot?.id ?? null,
        name:   spot?.name ?? '記念写真',
        url:    dataUrl,
        ts:     Date.now()
      });
      this.camera.close();
      const fc = document.getElementById('found-photo-container');
      fc.innerHTML = `<img src="${dataUrl}" alt="記念写真">`;
    };
    document.getElementById('shutter-btn').onclick     = () => this.camera.capture();
    document.getElementById('close-camera-btn').onclick = () => this.camera.close();
  }

  /** 上限チェック(OK/Cancel)してからカメラを開く
   *  forceName=true → 発見演出など、必ずスポット名を表示
   *  forceName=false → 圏外なら座標を2行で表示 */
  _openCameraFor(spot, forceName = false) {
    if (Store.isPhotoFull()) {
      const ok = confirm(
        `写真が上限（${Store.PHOTO_LIMIT}枚）に達しています。\n` +
        `撮影すると いちばん古い写真が消えます。\n続けますか?`
      );
      if (!ok) return;
    }
    this._cameraSpot = spot;

    let label = spot?.name ?? '';
    if (!forceName) {
      const pos = this._getPosition();
      if (pos) {
        const inRange = spot
          ? Geo.distance(pos.lat, pos.lng, spot.lat, spot.lng) <= Config.NORMAL_THRESHOLD
          : false;
        if (!inRange) {
          label = `${pos.lat.toFixed(3)}\n${pos.lng.toFixed(3)}`;
        }
      }
    }
    this.camera.open(label);
  }

  // ----- 管理者パネル -----
  _setupRadarTap() {
    const canvas = this.radar.canvas;

    const handleTap = (clientX, clientY) => {
      const rect  = canvas.getBoundingClientRect();
      const scale = canvas.width / rect.width;
      const cx    = (clientX - rect.left) * scale;
      const cy    = (clientY - rect.top)  * scale;
      const id    = this.radar.hitTest(cx, cy);
      if (!id) { this._clearMessage(); return; }
      const spot = this.spots.allSpots.find(s => s.id === id);
      if (spot) this._selectSpot(spot);
    };

    // タッチ: 短いタップのみ反応 (スクロール・ピンチを除外)
    let touchStartX = 0, touchStartY = 0;
    canvas.addEventListener('touchstart', e => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });
    canvas.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (Math.hypot(dx, dy) < 10) {
        e.preventDefault();
        handleTap(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
      }
    });

    // マウス (PCデバッグ用)
    canvas.addEventListener('click', e => {
      handleTap(e.clientX, e.clientY);
    });
  }

  // ----- ボール選択 → コンソールにドラクエ風メッセージ -----
  _selectSpot(spot) {
    if (this._selectedSpotId === spot.id) return;  // 同じボールの連打は無視
    this._selectedSpotId = spot.id;

    const pos  = this._getPosition();
    const dist = pos ? Geo.formatDistance(Geo.distance(pos.lat, pos.lng, spot.lat, spot.lng)) : '???';
    const done = this.spots.isFound(spot.id);

    const msg = done
      ? `「${spot.name}」は\nすでに みつけた！`
      : `「${spot.name}」の けはいを かんじる…\nここから ${dist}。`;

    this._typeMessage(msg);
  }

  /** 1文字ずつ表示するタイプライター */
  _typeMessage(text) {
    clearInterval(this._typeTimer);
    const el = document.getElementById('panel-message');
    if (!el) return;
    el.textContent = '';
    const chars = Array.from(text);
    let i = 0;
    this._typeTimer = setInterval(() => {
      el.textContent += chars[i++];
      if (i >= chars.length) { clearInterval(this._typeTimer); this._typeTimer = null; }
    }, 55);
  }

  _clearMessage() {
    clearInterval(this._typeTimer);
    this._typeTimer = null;
    this._selectedSpotId = null;
    const el = document.getElementById('panel-message');
    if (el) el.textContent = '';
  }

  _setupModeButtons() {
    const btns        = document.querySelectorAll('.mode-btn');
    const listScreen   = document.getElementById('list-screen');
    const clockScreen  = document.getElementById('clock-screen');
    const gameScreen   = document.getElementById('game-screen');
    const manualScreen = document.getElementById('manual-overlay');
    this._currentMode  = 0;

    const hideAll = () => {
      listScreen.hidden   = true;
      clockScreen.hidden  = true;
      gameScreen.hidden   = true;
      manualScreen.hidden = true;
      if (this._clockInterval) { clearInterval(this._clockInterval); this._clockInterval = null; }
    };

    const showMode = (idx) => {
      hideAll();
      this._currentMode = idx;
      if (idx === 1) {
        this._renderSpotList();
        listScreen.hidden = false;
      } else if (idx === 2) {
        this._updateClock();
        clockScreen.hidden = false;
        this._clockInterval = setInterval(() => this._updateClock(), 1000);
      } else if (idx === 3) {
        gameScreen.hidden = false;
      } else if (idx === 4) {
        manualScreen.hidden = false;
      }
    };

    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        btns.forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        showMode(parseInt(btn.dataset.mode, 10));
      });
    });

    // manual-overlay の × ボタン → レーダーに戻る
    document.getElementById('manual-close').onclick = () => {
      btns.forEach((b, i) => b.classList.toggle('is-active', i === 0));
      showMode(0);
    };
  }

  _renderSpotList() {
    const container = document.getElementById('list-spots');
    const scoreEl   = document.getElementById('list-score');
    const pos       = this._getPosition();
    container.innerHTML = '';
    if (scoreEl) scoreEl.textContent = `${this.spots.found} / ${this.spots.total}`;

    for (const spot of this.spots.allSpots) {
      const isFound = this.spots.isFound(spot.id);
      const item    = document.createElement('div');
      item.className = 'list-spot-item' + (isFound ? ' is-found' : '');

      const mark = document.createElement('span');
      mark.className   = 'list-spot-mark';
      mark.textContent = isFound ? '★' : '○';

      const name = document.createElement('span');
      name.className   = 'list-spot-name';
      name.textContent = spot.name;

      item.append(mark, name);

      if (pos) {
        const dist   = Geo.distance(pos.lat, pos.lng, spot.lat, spot.lng);
        const distEl = document.createElement('span');
        distEl.className   = 'list-spot-dist';
        distEl.textContent = Geo.formatDistance(dist);
        item.append(distEl);
      }
      container.appendChild(item);
    }
  }

  _updateClock() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const hm  = document.getElementById('clock-hm');
    const sec = document.getElementById('clock-sec');
    const dt  = document.getElementById('clock-date');
    if (hm)  hm.textContent  = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (sec) sec.textContent = pad(now.getSeconds());
    if (dt)  dt.textContent  = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;
  }

  _setupRangeCtrl() {
    const STEPS  = [50000, 3000, 1000, 500, 200, 100];  // index 0=top(遠), 5=bottom(近)
    const MAX_IDX = STEPS.length - 1;
    const groove = document.getElementById('range-groove');
    const thumb  = document.getElementById('range-thumb');
    const labels = document.querySelectorAll('.range-step-label');

    let currentIdx = Math.max(0, Math.min(MAX_IDX, Store.getRange()));

    const applyStep = (idx) => {
      currentIdx = Math.max(0, Math.min(MAX_IDX, idx));
      Config.MAX_DISPLAY_DISTANCE = STEPS[currentIdx];
      Store.setRange(currentIdx);

      const grooveH = groove.clientHeight;
      const thumbH  = thumb.offsetHeight;
      thumb.style.top = (currentIdx / MAX_IDX * (grooveH - thumbH)) + 'px';

      labels.forEach((el, i) => el.classList.toggle('is-active', i === currentIdx));
    };

    const stepFromY = (clientY) => {
      const rect = groove.getBoundingClientRect();
      const frac = (clientY - rect.top) / rect.height;
      return Math.round(Math.max(0, Math.min(1, frac)) * MAX_IDX);
    };

    groove.addEventListener('click', e => applyStep(stepFromY(e.clientY)));

    let dragging = false;
    groove.addEventListener('touchstart', () => { dragging = true; }, { passive: true });
    groove.addEventListener('touchmove', e => {
      if (!dragging) return;
      e.preventDefault();
      applyStep(stepFromY(e.touches[0].clientY));
    }, { passive: false });
    groove.addEventListener('touchend', () => { dragging = false; }, { passive: true });

    labels.forEach((el) => {
      el.addEventListener('click', () => applyStep(parseInt(el.dataset.idx, 10)));
    });

    // リサイズ時の再計算用に保持
    this._rangeApply = () => applyStep(currentIdx);

    // レイアウト確定後に初期位置をセット
    requestAnimationFrame(() => requestAnimationFrame(() => applyStep(currentIdx)));
  }

  _applyTheme(id) {
    const theme = RadarThemes[id] || RadarThemes.green;
    const root = document.documentElement;
    for (const [key, val] of Object.entries(theme.css)) {
      root.style.setProperty(key, val);
    }
    this.radar.theme = theme;
    Store.setTheme(id);
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.theme === id);
    });
  }

  _openAdmin() {
    if (!this.admin) this.admin = new AdminPanel(this.spots, this.gps);
    this.admin.open();
  }

  // ----- UI イベントの紐付け -----
  _setupUI() {
    // GPS再試行
    document.getElementById('retry-gps-btn').onclick = () => {
      document.getElementById('permission-screen').hidden = true;
      this._startGPS();
    };

    // 着いたよボタン
    document.getElementById('arrived-btn').onclick = () => this._handleArrived();

    // コンパス許可ボタン (iOS用)
    document.getElementById('compass-permit-btn').onclick = async () => {
      const ok = await this.compass.requestPermission();
      if (ok) {
        document.getElementById('compass-permit-btn').hidden = true;
      } else {
        alert('コンパスの使用が許可されませんでした。方位情報なしで動作します。');
      }
    };

    // カメラ起動ボタン (常時)
    document.getElementById('camera-open-btn').onclick = () => {
      this._openCameraFor(this.spots.getClosest(this._getPosition()));
    };

    // 写真ギャラリー
    document.getElementById('gallery-btn').onclick   = () => this._openGallery();
    document.getElementById('gallery-close').onclick = () => this._closeGallery();
    document.getElementById('gallery-back').onclick   = () => this._unzoom();
    document.getElementById('gallery-save').onclick   = () => this._saveCurrentPhoto();
    document.getElementById('gallery-delete').onclick = () => this._deleteCurrentPhoto();
    document.querySelector('.pg-prev').onclick       = () => this._galTurn(-1);
    document.querySelector('.pg-next').onclick       = () => this._galTurn(1);
    // グリッドのスワイプで前後ページ
    const grid = document.getElementById('gallery-grid');
    let gsx = 0;
    grid.addEventListener('touchstart', e => { gsx = e.touches[0].clientX; }, { passive: true });
    grid.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - gsx;
      if (dx < -40) this._galTurn(1);
      else if (dx > 40) this._galTurn(-1);
    });

    // 発見オーバーレイ: 撮影 (発見直後 → スポット名を強制表示)
    document.getElementById('found-camera-btn').onclick = () => {
      if (this._lastFoundSpot) this._openCameraFor(this._lastFoundSpot, true);
    };

    // 発見オーバーレイ: 次へ
    document.getElementById('found-ok-btn').onclick = () => {
      document.getElementById('found-overlay').hidden = true;
      this._refreshUI();
      if (this.spots.allDone) {
        document.getElementById('complete-overlay').hidden = false;
      }
    };

    // 全制覇: リセット
    document.getElementById('reset-btn').onclick = () => {
      if (confirm('発見履歴をすべてリセットして最初からやりますか?')) {
        Store.clearFound();
        location.reload();
      }
    };

    // レーダーCanvas タップ → コンソールにボール情報を表示
    this._setupRadarTap();

    // 座標直接入力
    document.getElementById('set-mock-pos-btn').onclick = () => {
      const lat = parseFloat(document.getElementById('mock-lat-input').value);
      const lng = parseFloat(document.getElementById('mock-lng-input').value);
      const status = document.getElementById('mock-pos-status');
      if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        status.textContent = '⚠ 有効な緯度・経度を入力してください';
        return;
      }
      this._setMockPosition(lat, lng);
    };
    document.getElementById('clear-mock-pos-btn').onclick = () => this._clearMockPosition();

    // テーマ切替
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.onclick = () => this._applyTheme(btn.dataset.theme);
    });

    // 右上の歯車ボタンで設定(SETTINGS)を開く
    document.getElementById('settings-btn').onclick = () => this._openAdmin();

    // リサイズ
    window.addEventListener('resize', () => {
      this.radar.resize();
      this._refreshUI();
      // フェーダーのサム位置を再計算
      if (this._rangeApply) this._rangeApply();
    });
  }
}

// ===================================================================
//  ENTRY POINT
// ===================================================================
const app = new App();
app.init().catch(err => {
  console.error('App init failed:', err);
  document.body.innerHTML = `<div style="color:#ff3333;padding:20px;font-family:monospace">
    初期化エラー: ${err.message}
  </div>`;
});
