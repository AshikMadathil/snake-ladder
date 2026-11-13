import { Component, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { SoundService } from '../../services/sound.service';

type Pt = { x: number; y: number };
type Jump = { from: number; to: number };

const COLOR_MAP: Record<string, { bg: string; fg: string }> = {
  red: { bg: '#ff4d4f', fg: '#ffffff' },
  blue: { bg: '#3b82f6', fg: '#ffffff' },
  green: { bg: '#22c55e', fg: '#ffffff' },
  yellow: { bg: '#facc15', fg: '#3b2f00' },
};

export function colorOf(color: string) {
  return COLOR_MAP[color] ?? { bg: color || '#888', fg: '#ffffff' };
}

// Must match JUMPS in server/index.js
const LADDERS: Record<number, number> = { 4: 14, 9: 31, 20: 38, 28: 84, 40: 59, 51: 67, 63: 81, 71: 91 };
const SNAKES: Record<number, number> = { 17: 7, 54: 34, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 99: 78 };
const SNAKE_COLORS = ['#2ea44f', '#8e44ad', '#e67e22', '#16a085', '#d63031', '#2980b9', '#e84393', '#6c8e23'];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The board is taller than wide (squares are 10 wide x 10*R tall) so it fills a portrait phone screen. */
const R = 1.2;

/** Centre of square n (1..100) in board units: 100 wide, 100 * R tall. */
function center(n: number): Pt {
  const i = n - 1;
  const row = Math.floor(i / 10);
  const col = row % 2 === 0 ? i % 10 : 9 - (i % 10);
  return { x: col * 10 + 5, y: ((9 - row) * 10 + 5) * R };
}

const CELLS = Array.from({ length: 100 }, (_, i) => {
  const visualRow = Math.floor(i / 10);
  const c = i % 10;
  const rowFromBottom = 9 - visualRow;
  const n = rowFromBottom * 10 + (rowFromBottom % 2 === 0 ? c + 1 : 10 - c);
  return { n, alt: (visualRow + c) % 2 === 1, up: n in LADDERS, down: n in SNAKES };
});

function ladderGeom(from: number, to: number) {
  const a = center(from);
  const b = center(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * 1.5;
  const ny = (dx / len) * 1.5;
  const count = Math.max(2, Math.floor(len / 4));
  const rungs = [];
  for (let k = 1; k < count; k++) {
    const f = k / count;
    const px = a.x + dx * f;
    const py = a.y + dy * f;
    rungs.push({ x1: px + nx, y1: py + ny, x2: px - nx, y2: py - ny });
  }
  return {
    r1: { x1: a.x + nx, y1: a.y + ny, x2: b.x + nx, y2: b.y + ny },
    r2: { x1: a.x - nx, y1: a.y - ny, x2: b.x - nx, y2: b.y - ny },
    rungs,
  };
}

function snakeGeom(from: number, to: number, idx: number) {
  const h = center(from);
  const t = center(to);
  const dx = t.x - h.x;
  const dy = t.y - h.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const amp = Math.min(len * 0.3, 9) * (idx % 2 ? -1 : 1);
  const c1 = { x: h.x + dx * 0.33 + nx * amp, y: h.y + dy * 0.33 + ny * amp };
  const c2 = { x: h.x + dx * 0.66 - nx * amp, y: h.y + dy * 0.66 - ny * amp };

  // head faces away from the body
  const tl = Math.hypot(c1.x - h.x, c1.y - h.y) || 1;
  const fx = -(c1.x - h.x) / tl;
  const fy = -(c1.y - h.y) / tl;
  const px = -fy;
  const py = fx;

  return {
    d: `M ${h.x} ${h.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${t.x} ${t.y}`,
    head: h,
    color: SNAKE_COLORS[idx % SNAKE_COLORS.length],
    tongue: { x1: h.x + fx * 2.2, y1: h.y + fy * 2.2, x2: h.x + fx * 3.8, y2: h.y + fy * 3.8 },
    eyes: [
      { x: h.x + fx * 0.9 + px, y: h.y + fy * 0.9 + py },
      { x: h.x + fx * 0.9 - px, y: h.y + fy * 0.9 - py },
    ],
  };
}

const LADDER_SHAPES = Object.entries(LADDERS).map(([f, t]) => ladderGeom(+f, +t));
const SNAKE_SHAPES = Object.entries(SNAKES).map(([f, t], i) => snakeGeom(+f, +t, i));

@Component({
  selector: 'app-board',
  standalone: true,
  templateUrl: './board.component.html',
  styleUrl: './board.component.scss',
})
export class BoardComponent implements OnChanges, OnDestroy {
  @Input() players: any[] = [];
  @Input() activeId = '';
  @Input() lastRoll: any = null;
  readonly cells = CELLS;
  readonly ladders = LADDER_SHAPES;
  readonly snakes = SNAKE_SHAPES;

  /** Square each token is currently drawn on (walks towards the real position). */
  private shown = new Map<string, number>();
  private sliding = new Set<string>();
  private version = new Map<string, number>();
  private destroyed = false;

  constructor(private sound: SoundService) {}

  ngOnChanges(ch: SimpleChanges) {
    if (!ch['players']) return;
    const ids = new Set(this.players.map((p) => p.id));
    for (const id of [...this.shown.keys()]) if (!ids.has(id)) this.shown.delete(id);

    for (const p of this.players) {
      const cur = this.shown.get(p.id);
      if (cur === undefined) { this.shown.set(p.id, p.pos); continue; }
      if (cur !== p.pos) {
        const jump: Jump | null = this.lastRoll?.playerId === p.id ? this.lastRoll.jump : null;
        void this.walk(p.id, cur, p.pos, jump);
      }
    }
  }

  ngOnDestroy() { this.destroyed = true; }

  /** Hop square by square, then slide along the snake or ladder. */
  private async walk(id: string, from: number, to: number, jump: Jump | null) {
    const v = (this.version.get(id) ?? 0) + 1;
    this.version.set(id, v);
    const alive = () => !this.destroyed && this.version.get(id) === v;

    const end = jump ? jump.from : to;
    if (end > from && end - from <= 6) {
      for (let s = from + 1; s <= end; s++) {
        this.shown.set(id, s);
        this.sound.step(s - from - 1); // pitch rises with every counted square
        await sleep(210);
        if (!alive()) return;
      }
    } else if (!jump) {
      this.shown.set(id, to);
      return;
    }

    if (jump && to !== end) {
      await sleep(150);
      if (!alive()) return;
      this.sliding.add(id);
      if (jump.from > jump.to) this.sound.snake(); else this.sound.ladder();
      this.shown.set(id, to);
      setTimeout(() => this.sliding.delete(id), 900);
    }
  }

  get tokens() {
    const pos = this.players.map((p) => this.shown.get(p.id) ?? p.pos);
    return this.players.map((p, i) => {
      const cur = pos[i];
      const same = pos.map((v, j) => (v === cur ? j : -1)).filter((j) => j >= 0);
      const k = same.indexOf(i);
      let x: number;
      let y: number;
      if (cur > 0) {
        const c = center(cur);
        const a = (k / same.length) * Math.PI * 2;
        const r = same.length > 1 ? 2.8 : 0;
        x = c.x + Math.cos(a) * r;
        y = (c.y + Math.sin(a) * r) / R; // tokens are placed in % of the board height
      } else {
        // waiting area: the START lane under the board
        x = 9 + i * 11;
        y = 104.5;
      }
      const col = colorOf(p.color);
      return {
        id: p.id,
        x,
        y,
        bg: col.bg,
        fg: col.fg,
        initial: (p.name || '?').charAt(0).toUpperCase(),
        active: p.id === this.activeId,
        slide: this.sliding.has(p.id),
        done: !!p.finished,
        left: !!p.left && !p.finished,
      };
    });
  }
}
