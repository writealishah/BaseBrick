import { GAME_CONFIG } from "./config.js";

const CAMPAIGN_STAGE_COUNT = 20;
const comboMilestones = new Set([5, 10, 20, 30]);
const rowColors = ["#ff4d4d", "#ff8a2d", "#ffe34d", "#41d654", "#2f8cff"];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const pixelFont = {
  A: ["111", "101", "111", "101", "101"],
  B: ["111", "101", "110", "101", "111"],
  C: ["111", "100", "100", "100", "111"],
  D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "111", "100", "111"],
  F: ["111", "100", "111", "100", "100"],
  G: ["111", "100", "101", "101", "111"],
  H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
  J: ["001", "001", "001", "101", "111"],
  K: ["101", "101", "110", "101", "101"],
  L: ["100", "100", "100", "100", "111"],
  M: ["101", "111", "101", "101", "101"],
  N: ["101", "111", "111", "111", "101"],
  O: ["111", "101", "101", "101", "111"],
  P: ["111", "101", "111", "100", "100"],
  Q: ["111", "101", "101", "111", "001"],
  R: ["111", "101", "111", "110", "101"],
  S: ["111", "100", "111", "001", "111"],
  T: ["111", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "111"],
  V: ["101", "101", "101", "101", "010"],
  W: ["101", "101", "111", "111", "101"],
  X: ["101", "101", "010", "101", "101"],
  Y: ["101", "101", "010", "010", "010"],
  Z: ["111", "001", "010", "100", "111"]
};

const campaignStages = [
  { name: "BASE", word: "BASE", palette: "baseHero", withLogo: true },
  { name: "ETH", word: "ETH", palette: "eth" },
  { name: "BTC", word: "BTC", palette: "btc" },
  { name: "HODL", word: "HODL", palette: "slang" },
  { name: "LFG", word: "LFG", palette: "slang" },
  { name: "IYKYK", word: "IYKYK", palette: "slang" },
  { name: "GM", word: "GM", palette: "slang" },
  { name: "NGMI", word: "NGMI", palette: "slang" },
  { name: "REKT", word: "REKT", palette: "slang" },
  { name: "BULLISH", word: "BULLISH", palette: "slang" },
  { name: "MOON", word: "MOON", palette: "slang" },
  { name: "DYOR", word: "DYOR", palette: "slang" },
  { name: "FOMO", word: "FOMO", palette: "slang" },
  { name: "DEGEN", word: "DEGEN", palette: "slang" },
  { name: "ALPHA", word: "ALPHA", palette: "slang" },
  { name: "PUMP", word: "PUMP", palette: "slang" },
  { name: "DUMP", word: "DUMP", palette: "slang" },
  { name: "FRENS", word: "FRENS", palette: "slang" },
  { name: "APEIN", word: "APEIN", palette: "slang" },
  { name: "WGMI", word: "WGMI", palette: "final" }
];

function hashSeed(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createRng(seedText) {
  let state = hashSeed(seedText || "mono-seed");
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isCircleRectHit(circle, rect) {
  const x = clamp(circle.x, rect.x, rect.x + rect.w);
  const y = clamp(circle.y, rect.y, rect.y + rect.h);
  const dx = circle.x - x;
  const dy = circle.y - y;
  return dx * dx + dy * dy <= circle.r * circle.r;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function emptyGrid(rows, cols) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => "."));
}

function getGlyph(ch) {
  return pixelFont[ch] || ["111", "111", "111", "111", "111"];
}

function buildWordMatrix(word, charGap = 0) {
  const letters = (word || "").toUpperCase().replace(/[^A-Z]/g, "").split("");
  const rows = Array.from({ length: 5 }, () => []);

  letters.forEach((ch, index) => {
    const glyph = getGlyph(ch);
    for (let r = 0; r < 5; r += 1) {
      rows[r].push(...glyph[r].split(""));
      if (index < letters.length - 1) {
        for (let i = 0; i < charGap; i += 1) rows[r].push("0");
      }
    }
  });

  return rows;
}

function scaleMatrix(matrix, scale = 1) {
  if (scale <= 1) return matrix;
  const next = [];
  for (const row of matrix) {
    const expanded = [];
    for (const bit of row) {
      for (let i = 0; i < scale; i += 1) expanded.push(bit);
    }
    for (let y = 0; y < scale; y += 1) next.push([...expanded]);
  }
  return next;
}

function matrixWidth(word, charGap) {
  if (!word) return 0;
  return word.length * 3 + (word.length - 1) * charGap;
}

function splitWordToLines(word, cols) {
  const clean = (word || "").replace(/[^A-Z]/g, "");
  if (clean.length <= 1) return [clean];
  if (matrixWidth(clean, 0) <= cols - 2) return [clean];
  if (matrixWidth(clean, 1) <= cols - 4) return [clean];

  let best = [clean];
  let bestCost = Infinity;
  for (let i = 2; i <= clean.length - 2; i += 1) {
    const left = clean.slice(0, i);
    const right = clean.slice(i);
    const leftW = matrixWidth(left, 0);
    const rightW = matrixWidth(right, 0);
    const tooWide = leftW > cols - 4 || rightW > cols - 4;
    const cost = tooWide ? 1000 + Math.max(leftW, rightW) : Math.abs(leftW - rightW);
    if (cost < bestCost) {
      bestCost = cost;
      best = [left, right];
    }
  }
  return best;
}

function pickLineGap(line, cols, preferredGap = 1) {
  const safePreferred = preferredGap > 0 ? 1 : 0;
  if (matrixWidth(line, safePreferred) <= cols - 2) return safePreferred;
  if (matrixWidth(line, 0) <= cols - 2) return 0;
  return safePreferred;
}

function plotMatrix(grid, matrix, offsetX, offsetY, fillChar = "X") {
  for (let r = 0; r < matrix.length; r += 1) {
    for (let c = 0; c < matrix[r].length; c += 1) {
      if (matrix[r][c] !== "1") continue;
      const y = offsetY + r;
      const x = offsetX + c;
      if (y < 0 || y >= grid.length || x < 0 || x >= grid[0].length) continue;
      grid[y][x] = fillChar;
    }
  }
}

function buildTextStageRows(theme, cols, rowCount, stage) {
  const grid = emptyGrid(rowCount, cols);
  const cleanWord = (theme?.word || "").toUpperCase().replace(/[^A-Z]/g, "");
  let lines = splitWordToLines(cleanWord, cols);
  let forceCompactWordMode = false;
  let compactCharGap = 0;

  if (theme?.withLogo && lines.length === 1) {
    const logoSize = 4;
    const previewWord = buildWordMatrix(lines[0], 1);
    const previewWidth = previewWord[0]?.length || 0;
    const totalWithLogo = logoSize + 2 + previewWidth;
    const fitsLogoLayout = totalWithLogo <= cols - 1;
    if (!fitsLogoLayout) {
      forceCompactWordMode = true;
      const singleLineGap1 = matrixWidth(cleanWord, 1) <= cols - 2;
      const singleLineGap0 = matrixWidth(cleanWord, 0) <= cols - 2;

      if (singleLineGap1) {
        lines = [cleanWord];
        compactCharGap = 1;
      } else if (singleLineGap0) {
        lines = [cleanWord];
        compactCharGap = 0;
      } else if (cleanWord.length >= 4 && cleanWord.length % 2 === 0) {
        const half = cleanWord.length / 2;
        lines = [cleanWord.slice(0, half), cleanWord.slice(half)];
        compactCharGap = 1;
      }
    }
  }

  const lineMatrices = lines.map((line) => {
    const preferredGap = forceCompactWordMode ? compactCharGap : 1;
    const gap = pickLineGap(line, cols, preferredGap);
    const base = buildWordMatrix(line, gap);
    const baseWidth = base[0]?.length || 0;
    const scale = lines.length === 1 && line.length <= 2 && baseWidth * 2 <= cols - 2 ? 2 : 1;
    return scaleMatrix(base, scale);
  });

  const contentHeight =
    lineMatrices.reduce((acc, matrix) => acc + matrix.length, 0) + (lineMatrices.length - 1) * 2;
  const startY = Math.max(1, Math.floor((rowCount - contentHeight) / 2));

  const hasLogo = Boolean(theme?.withLogo) && !forceCompactWordMode && lineMatrices.length === 1;
  if (hasLogo) {
    const matrix = lineMatrices[0];
    const textWidth = matrix[0]?.length || 0;
    const logoSize = 4;
    const totalWidth = logoSize + 2 + textWidth;
    const startX = Math.max(0, Math.floor((cols - totalWidth) / 2));
    const logoY = Math.max(1, Math.floor((rowCount - logoSize) / 2));
    const logoMatrix = Array.from({ length: logoSize }, () => Array.from({ length: logoSize }, () => "1"));
    plotMatrix(grid, logoMatrix, startX, logoY, "B");
    plotMatrix(grid, matrix, startX + logoSize + 2, startY, "X");
  } else {
    let cursorY = startY;
    for (const matrix of lineMatrices) {
      const width = matrix[0]?.length || 0;
      const offsetX = Math.max(0, Math.floor((cols - width) / 2));
      plotMatrix(grid, matrix, offsetX, cursorY, "X");
      cursorY += matrix.length + 2;
    }
  }

  return grid.map((row) => row.join(""));
}

function styleBrick(theme, rowIndex, colIndex, cellType, rng) {
  if (theme.palette === "baseHero") {
    if (cellType === "B") {
      return { type: "blue", color: rowIndex % 2 ? "#2f8cff" : "#5eabff" };
    }
    const hero = ["#2f8cff", "#49d65b", "#ffe34d", "#ff8a2d"];
    const color = hero[(rowIndex + colIndex) % hero.length];
    return { type: color === "#2f8cff" ? "blue" : "normal", color };
  }
  if (theme.palette === "base") {
    return { type: "blue", color: rowIndex % 2 ? "#2f8cff" : "#4b99ff" };
  }
  if (theme.palette === "eth") {
    return { type: rng() > 0.92 ? "blue" : "normal", color: rowIndex % 2 ? "#8e95a8" : "#c7ccda" };
  }
  if (theme.palette === "btc") {
    return { type: rng() > 0.94 ? "blue" : "normal", color: rowIndex % 2 ? "#f7931a" : "#fbc064" };
  }
  if (theme.palette === "final") {
    return { type: rng() > 0.12 ? "blue" : "rare", color: rng() > 0.4 ? "#2f8cff" : "#f6fbff" };
  }
  const blue = rng() < 0.2;
  return { type: blue ? "blue" : "normal", color: blue ? "#2f8cff" : rowColors[rowIndex % rowColors.length] };
}

export class MonoBrickGame {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.config = GAME_CONFIG;

    this.callbacks = {
      onHud: callbacks.onHud || (() => {}),
      onFeedback: callbacks.onFeedback || (() => {}),
      onStageClear: callbacks.onStageClear || (() => {}),
      onCampaignComplete: callbacks.onCampaignComplete || (() => {}),
      onGameOver: callbacks.onGameOver || (() => {}),
      onRunEvent: callbacks.onRunEvent || (() => {}),
      onSfx: callbacks.onSfx || (() => {})
    };

    this.input = { left: false, right: false, pointerX: null };
    this.running = false;
    this.frameId = null;
    this.lastTs = 0;

    this.run = null;
    this.initialBestScore = 0;
    this.rng = createRng("mono-init");
    this.bricks = [];
    this.activeBricks = 0;
    this.drops = [];
    this.stageMisses = 0;
    this.currentTheme = campaignStages[0];

    this.paddle = {
      x: this.config.width / 2 - this.config.paddle.width / 2,
      y: this.config.height - this.config.paddle.yOffset,
      w: this.config.paddle.width,
      h: this.config.paddle.height
    };

    this.ball = {
      x: this.config.width / 2,
      y: this.paddle.y - 8,
      vx: 0.45,
      vy: -0.88,
      speed: this.config.ball.baseSpeed,
      r: this.config.ball.radius,
      stuck: true,
      prevX: this.config.width / 2,
      prevY: this.paddle.y - 8
    };
  }

  newRun({ bestScore = 0, dailySeed = "daily", startStage = 1 } = {}) {
    const initialStage = clamp(Math.floor(startStage || 1), 1, CAMPAIGN_STAGE_COUNT);
    this.initialBestScore = Math.max(0, Math.floor(bestScore));
    this.run = {
      score: 0,
      lives: this.config.startingLives,
      stage: initialStage,
      bestScore: this.initialBestScore,
      combo: 1,
      maxCombo: 1,
      multiplier: 1,
      multiplierTimer: 0,
      startStage: initialStage,
      lastBrickHitAt: 0,
      blueChain: 0,
      lastBlueHitAt: 0,
      campaignComplete: false,
      startedAt: new Date().toISOString(),
      dailySeed
    };
    this.stageMisses = 0;
    this.rng = createRng(`${dailySeed}:stage:${initialStage}`);
    this.setupStage(initialStage);
    this.resetBallOnPaddle();
    this.emitHud();
    this.render();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTs = 0;
    this.frameId = requestAnimationFrame((ts) => this.loop(ts));
  }

  stop() {
    this.running = false;
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.lastTs = 0;
  }

  restart({ bestScore, dailySeed, startStage = 1 }) {
    this.newRun({ bestScore, dailySeed, startStage });
    this.start();
  }

  setControlState(nextState = {}) {
    this.input.left = Boolean(nextState.left);
    this.input.right = Boolean(nextState.right);
  }

  setPointerTarget(x) {
    this.input.pointerX = x;
  }

  clearPointerTarget() {
    this.input.pointerX = null;
  }

  launchBall() {
    if (!this.run || !this.ball.stuck) return;
    const skew = (this.rng() * 0.5 - 0.25) + (this.input.left ? -0.16 : 0) + (this.input.right ? 0.16 : 0);
    this.ball.vx = clamp(skew, -0.7, 0.7);
    this.ball.vy = -Math.sqrt(Math.max(0.15, 1 - this.ball.vx * this.ball.vx));
    this.ball.stuck = false;
    this.callbacks.onSfx("launch");
  }

  loop(timestamp) {
    if (!this.running) return;
    const dt = this.lastTs ? Math.min(0.033, (timestamp - this.lastTs) / 1000) : 1 / 60;
    this.lastTs = timestamp;
    this.update(dt);
    this.render();
    this.frameId = requestAnimationFrame((ts) => this.loop(ts));
  }

  update(dt) {
    if (!this.run) return;

    if (this.run.multiplierTimer > 0) {
      this.run.multiplierTimer = Math.max(0, this.run.multiplierTimer - dt);
      if (this.run.multiplierTimer <= 0 && this.run.multiplier > 1) {
        this.run.multiplier = 1;
        this.sendFeedback("Multiplier cooled down", "normal");
      }
    }

    this.updatePaddle(dt);
    this.updateDrops(dt);

    if (this.ball.stuck) {
      this.ball.x = this.paddle.x + this.paddle.w / 2;
      this.ball.y = this.paddle.y - this.ball.r - 1;
      this.emitHud();
      return;
    }

    const travel = this.ball.speed * dt;
    const steps = Math.max(1, Math.ceil(travel / 9));
    const stepDt = dt / steps;
    for (let i = 0; i < steps; i += 1) {
      const status = this.stepBall(stepDt);
      if (status !== "ok") break;
    }

    this.emitHud();
  }

  updatePaddle(dt) {
    const speed = this.config.paddle.speed;
    if (typeof this.input.pointerX === "number") {
      const target = this.input.pointerX - this.paddle.w / 2;
      const eased = this.paddle.x + (target - this.paddle.x) * Math.min(1, dt * 18);
      this.paddle.x = clamp(eased, 0, this.config.width - this.paddle.w);
      return;
    }

    let move = 0;
    if (this.input.left) move -= 1;
    if (this.input.right) move += 1;
    this.paddle.x = clamp(this.paddle.x + move * speed * dt, 0, this.config.width - this.paddle.w);
  }

  updateDrops(dt) {
    if (!this.drops.length) return;
    for (const drop of this.drops) {
      drop.y += drop.vy * dt;
    }

    const paddleRect = { x: this.paddle.x, y: this.paddle.y, w: this.paddle.w, h: this.paddle.h };
    this.drops = this.drops.filter((drop) => {
      if (drop.y > this.config.height + 16) return false;
      if (!isCircleRectHit({ x: drop.x, y: drop.y, r: drop.r }, paddleRect)) return true;
      this.collectDrop(drop);
      return false;
    });
  }

  collectDrop(drop) {
    if (!this.run) return;
    if (drop.type === "life") {
      const before = this.run.lives;
      this.run.lives = Math.min(this.config.maxLives, this.run.lives + 1);
      if (this.run.lives > before) {
        this.sendFeedback("+1 life", "blue");
      } else {
        this.run.score += 75;
        this.sendFeedback("Life cap bonus +75", "normal");
      }
      this.callbacks.onSfx("drop");
      return;
    }

    if (drop.type === "multi") {
      this.run.multiplier = Math.min(4, this.run.multiplier + 1);
      this.run.multiplierTimer = Math.max(this.run.multiplierTimer, 11);
      this.sendFeedback(`x${this.run.multiplier} multiplier`, "blue");
      this.callbacks.onSfx("drop");
      return;
    }

    this.run.score += 160 + this.run.stage * 20;
    this.sendFeedback("Burst bonus", "blue");
    this.callbacks.onSfx("drop");
  }

  stepBall(stepDt) {
    this.ball.prevX = this.ball.x;
    this.ball.prevY = this.ball.y;

    this.ball.x += this.ball.vx * this.ball.speed * stepDt;
    this.ball.y += this.ball.vy * this.ball.speed * stepDt;

    if (this.ball.x - this.ball.r <= 0) {
      this.ball.x = this.ball.r;
      this.ball.vx = Math.abs(this.ball.vx);
      this.callbacks.onSfx("wall");
    } else if (this.ball.x + this.ball.r >= this.config.width) {
      this.ball.x = this.config.width - this.ball.r;
      this.ball.vx = -Math.abs(this.ball.vx);
      this.callbacks.onSfx("wall");
    }

    if (this.ball.y - this.ball.r <= 26) {
      this.ball.y = 26 + this.ball.r;
      this.ball.vy = Math.abs(this.ball.vy);
      this.callbacks.onSfx("wall");
    }

    if (this.handlePaddleBounce()) return "ok";
    if (this.handleBrickBounce()) return "stage-clear";

    if (this.ball.y - this.ball.r > this.config.height) {
      this.handleLifeLost();
      return "life-lost";
    }

    return "ok";
  }

  handlePaddleBounce() {
    if (this.ball.vy <= 0) return false;
    const paddleRect = { x: this.paddle.x, y: this.paddle.y, w: this.paddle.w, h: this.paddle.h };
    if (!isCircleRectHit(this.ball, paddleRect)) return false;

    const relative = (this.ball.x - (this.paddle.x + this.paddle.w / 2)) / (this.paddle.w / 2);
    const clamped = clamp(relative, -1, 1);
    const angle = clamped * (Math.PI / 2.9);
    let vx = Math.sin(angle);
    let vy = -Math.cos(angle);

    if (this.input.left) vx -= 0.09;
    if (this.input.right) vx += 0.09;

    const magnitude = Math.hypot(vx, vy) || 1;
    this.ball.vx = vx / magnitude;
    this.ball.vy = vy / magnitude;
    this.ball.speed = clamp(this.ball.speed + 1.5, this.config.ball.baseSpeed, this.config.ball.maxSpeed);
    this.ball.y = this.paddle.y - this.ball.r - 0.1;
    this.callbacks.onSfx("paddle");
    return true;
  }

  handleBrickBounce() {
    for (const brick of this.bricks) {
      if (!brick.active) continue;
      if (!isCircleRectHit(this.ball, brick)) continue;

      brick.active = false;
      this.activeBricks -= 1;

      this.resolveBrickBounce(brick);
      this.handleBrickScore(brick);

      if (this.activeBricks <= 0) {
        this.handleStageClear();
        return true;
      }
      return false;
    }
    return false;
  }

  resolveBrickBounce(brick) {
    const fromTop = this.ball.prevY + this.ball.r <= brick.y;
    const fromBottom = this.ball.prevY - this.ball.r >= brick.y + brick.h;
    const fromLeft = this.ball.prevX + this.ball.r <= brick.x;
    const fromRight = this.ball.prevX - this.ball.r >= brick.x + brick.w;

    if (fromTop) {
      this.ball.vy = -Math.abs(this.ball.vy);
      this.ball.y = brick.y - this.ball.r - 0.1;
      return;
    }
    if (fromBottom) {
      this.ball.vy = Math.abs(this.ball.vy);
      this.ball.y = brick.y + brick.h + this.ball.r + 0.1;
      return;
    }
    if (fromLeft) {
      this.ball.vx = -Math.abs(this.ball.vx);
      this.ball.x = brick.x - this.ball.r - 0.1;
      return;
    }
    if (fromRight) {
      this.ball.vx = Math.abs(this.ball.vx);
      this.ball.x = brick.x + brick.w + this.ball.r + 0.1;
      return;
    }

    this.ball.vy *= -1;
  }

  handleBrickScore(brick) {
    const now = performance.now();
    if (now - this.run.lastBrickHitAt <= 900) {
      this.run.combo += 1;
    } else {
      this.run.combo = 1;
    }
    this.run.lastBrickHitAt = now;
    this.run.maxCombo = Math.max(this.run.maxCombo, this.run.combo);

    let bonus = brick.points;
    if (this.run.combo > 1) bonus += this.run.combo * 6;
    if (comboMilestones.has(this.run.combo)) this.sendFeedback(`Combo x${this.run.combo}`, "normal");

    if (brick.type === "blue") {
      if (now - this.run.lastBlueHitAt <= 1350) {
        this.run.blueChain += 1;
      } else {
        this.run.blueChain = 1;
      }
      this.run.lastBlueHitAt = now;
      bonus += 46 * this.run.blueChain;
      if (this.run.blueChain >= 2) this.sendFeedback(`Base chain x${this.run.blueChain}`, "blue");
      this.maybeSpawnDrop(brick, 0.42);
      this.callbacks.onSfx("blueBrick");
    } else if (brick.type === "rare") {
      bonus += 280;
      this.run.multiplier = Math.min(4, this.run.multiplier + 1);
      this.run.multiplierTimer = Math.max(this.run.multiplierTimer, 12);
      this.sendFeedback("Rare multiplier block!", "blue");
      this.maybeSpawnDrop(brick, 1);
      this.callbacks.onSfx("rareBrick");
    } else {
      this.callbacks.onSfx("brick");
    }

    const totalGain = Math.floor(bonus * this.run.multiplier);
    this.run.score += totalGain;
    if (this.run.score > this.run.bestScore) this.run.bestScore = this.run.score;

    if (this.run.score > this.initialBestScore) {
      this.callbacks.onRunEvent({ type: "new-best-live", score: this.run.score });
    }
  }

  maybeSpawnDrop(brick, chance) {
    if (this.rng() > chance) return;
    const dropTypeRoll = this.rng();
    let type = "multi";
    if (dropTypeRoll < 0.28 && this.run.lives < this.config.maxLives) type = "life";
    else if (dropTypeRoll > 0.82) type = "burst";

    this.drops.push({
      type,
      x: brick.x + brick.w / 2,
      y: brick.y + brick.h / 2,
      r: 6,
      vy: this.config.drops.speed + this.run.stage * 4
    });
  }

  handleLifeLost() {
    this.run.lives -= 1;
    this.run.combo = 1;
    this.run.blueChain = 0;
    this.stageMisses += 1;

    if (this.run.lives <= 0) {
      this.callbacks.onSfx("gameOver");
      this.finishRun({ campaignComplete: false });
      return;
    }

    this.sendFeedback("Life lost. Run it back.", "normal");
    this.callbacks.onSfx("lifeLost");
    this.resetBallOnPaddle();
  }

  handleStageClear() {
    const cleanClear = this.stageMisses === 0;
    const stageBonus = 180 + this.run.stage * 55 + (cleanClear ? 120 : 0);
    this.run.score += stageBonus;
    if (this.run.score > this.run.bestScore) this.run.bestScore = this.run.score;

    this.callbacks.onStageClear({ stage: this.run.stage, cleanClear, bonus: stageBonus });
    this.sendFeedback(`${this.currentTheme.name} clear +${stageBonus}`, "blue");
    this.callbacks.onSfx("clear");

    if (this.run.stage >= CAMPAIGN_STAGE_COUNT) {
      this.run.campaignComplete = true;
      this.callbacks.onCampaignComplete({
        score: this.run.score,
        stage: this.run.stage,
        totalStages: CAMPAIGN_STAGE_COUNT,
        stageName: this.currentTheme.name
      });
      this.sendFeedback("WGMI cleared. Omega milestone unlocked", "blue");
      this.finishRun({ campaignComplete: true });
      return;
    }

    this.run.stage += 1;
    this.stageMisses = 0;
    this.setupStage(this.run.stage);
    this.resetBallOnPaddle();
    this.emitHud();
  }

  finishRun(extra = {}) {
    const result = {
      score: this.run.score,
      stage: this.run.stage,
      maxCombo: this.run.maxCombo,
      bestScore: this.run.bestScore,
      newBest: this.run.bestScore > this.initialBestScore,
      campaignComplete: Boolean(extra.campaignComplete),
      totalStages: CAMPAIGN_STAGE_COUNT,
      stageName: this.currentTheme?.name || "",
      startStage: this.run.startStage || 1,
      startedAt: this.run.startedAt,
      endedAt: new Date().toISOString()
    };
    this.stop();
    this.callbacks.onGameOver(result);
  }

  setupStage(stage) {
    this.bricks = [];
    this.drops = [];
    this.rng = createRng(`${this.run.dailySeed}:stage:${stage}`);

    const cols = this.config.bricks.cols;
    const side = this.config.bricks.sidePadding;
    const top = this.config.bricks.topOffset;
    const rowGap = this.config.bricks.rowGap;
    const colGap = this.config.bricks.colGap;
    const width = (this.config.width - side * 2 - (cols - 1) * colGap) / cols;
    const height = Number(this.config.bricks.brickHeight) > 0 ? this.config.bricks.brickHeight : 17;

    this.activeBricks = 0;
    this.currentTheme = campaignStages[clamp(stage - 1, 0, CAMPAIGN_STAGE_COUNT - 1)];

    const rows = buildTextStageRows(this.currentTheme, cols, 12, stage);

    for (let row = 0; row < rows.length; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const cell = rows[row][col];
        if (cell === ".") continue;

        const x = side + col * (width + colGap);
        const y = top + row * (height + rowGap);
        const style = styleBrick(this.currentTheme, row, col, cell, this.rng);
        const points = style.type === "rare" ? 200 : style.type === "blue" ? 95 : 42 + row * 5;

        this.bricks.push({
          x,
          y,
          w: width,
          h: height,
          active: true,
          row,
          col,
          type: style.type,
          points,
          color: style.color
        });
        this.activeBricks += 1;
      }
    }

    this.sendFeedback(`${this.currentTheme.name} stage`, "blue");
  }

  resetBallOnPaddle() {
    this.ball.speed = clamp(
      this.config.ball.baseSpeed + (this.run.stage - 1) * this.config.ball.stageSpeedStep,
      this.config.ball.baseSpeed,
      this.config.ball.maxSpeed
    );
    this.ball.vx = 0.42;
    this.ball.vy = -0.9;
    this.ball.stuck = true;
    this.ball.x = this.paddle.x + this.paddle.w / 2;
    this.ball.y = this.paddle.y - this.ball.r - 1;
  }

  emitHud() {
    if (!this.run) return;
    this.callbacks.onHud({
      score: this.run.score,
      bestScore: this.run.bestScore,
      lives: this.run.lives,
      stage: this.run.stage,
      stageTotal: CAMPAIGN_STAGE_COUNT,
      stageName: this.currentTheme?.name || "",
      combo: this.run.combo,
      speedMultiplier: this.ball.speed / this.config.ball.baseSpeed,
      multiplier: this.run.multiplier,
      multiplierTimer: this.run.multiplierTimer
    });
  }

  sendFeedback(text, tone) {
    this.callbacks.onFeedback({ text, tone });
  }

  render() {
    const ctx = this.ctx;
    const { width, height } = this.config;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#030303";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "#e8edf1";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, width - 2, height - 2);

    if (this.run) {
      ctx.fillStyle = "#f6f6f6";
      ctx.font = "14px VT323";
      ctx.textAlign = "left";
      ctx.fillText(`Score: ${this.run.score}`, 10, 20);
      ctx.textAlign = "right";
      ctx.fillText(`Lives: ${this.run.lives}`, width - 10, 20);
      ctx.textAlign = "center";
      ctx.fillStyle = "#9ec9ff";
      ctx.fillText(`${this.currentTheme?.name || ""} ${this.run.stage}/${CAMPAIGN_STAGE_COUNT}`, width / 2, 20);
      ctx.textAlign = "left";
    }

    for (const brick of this.bricks) {
      if (!brick.active) continue;
      let fill = brick.color;
      let stroke = "rgba(250,250,250,0.16)";
      if (brick.type === "blue") {
        fill = brick.color || "#2f8cff";
        stroke = "rgba(171,214,255,0.8)";
      } else if (brick.type === "rare") {
        fill = Math.sin(performance.now() / 140) > 0 ? "#86bcff" : "#4a98ff";
        stroke = "rgba(240,249,255,0.95)";
      }
      drawRoundedRect(ctx, brick.x, brick.y, brick.w, brick.h, 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    for (const drop of this.drops) {
      const color =
        drop.type === "life" ? "#fff59d" : drop.type === "multi" ? "#61a7ff" : "#96d4ff";
      drawRoundedRect(ctx, drop.x - 6, drop.y - 6, 12, 12, 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "rgba(240,248,255,0.55)";
      ctx.stroke();
    }

    drawRoundedRect(ctx, this.paddle.x, this.paddle.y, this.paddle.w, this.paddle.h, 2);
    ctx.fillStyle = "#22d3ee";
    ctx.fill();
    ctx.strokeStyle = "rgba(219, 246, 252, 0.85)";
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(this.ball.x, this.ball.y, this.ball.r, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.65)";
    ctx.stroke();

    if (this.ball.stuck && this.run?.lives > 0) {
      if (Math.sin(performance.now() / 260) > -0.2) {
        ctx.fillStyle = "rgba(0,0,0,0.86)";
        ctx.fillRect(width / 2 - 100, height - 54, 200, 26);
        ctx.fillStyle = "#f1f1f1";
        ctx.font = "13px VT323";
        ctx.textAlign = "center";
        ctx.fillText("TAP LAUNCH", width / 2, height - 36);
        ctx.textAlign = "left";
      }
    }
  }
}
