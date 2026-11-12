import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { GameService } from '../../services/game.service';
import { BoardComponent, COLOR_MAP } from '../../components/board/board.component';

const CONFETTI_COLORS = ['#ff4d4f', '#3b82f6', '#22c55e', '#facc15', '#ff9f43', '#e84393'];
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

@Component({
  selector: 'app-room',
  standalone: true,
  imports: [BoardComponent],
  templateUrl: './room.component.html',
  styleUrl: './room.component.scss',
})
export class RoomComponent {
  rolling = false;
  copied = false;
  private face = 1;

  readonly confetti = Array.from({ length: 28 }, (_, i) => ({
    left: (i * 37) % 100,
    delay: ((i * 13) % 10) / 10,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  }));

  constructor(public game: GameService, private router: Router) {}

  get state() { return this.game.state(); }
  get isHost() { return this.state?.hostId === this.game.myId(); }
  get activePlayer() { return this.state?.players?.[this.state.turnIndex]; }
  get activeId(): string { return this.state?.status === 'playing' ? (this.activePlayer?.id ?? '') : ''; }
  get isMyTurn() {
    const s = this.state;
    return s?.status === 'playing' && s.players[s.turnIndex]?.id === this.game.myId();
  }
  get winnerName(): string {
    return this.state?.players?.find((p: any) => p.id === this.state.winnerId)?.name ?? 'Someone';
  }

  /** Changes whenever a new roll arrives, so the dice element is re-created and plays its pop animation. */
  get rollKey() { return [this.state?.lastRoll ?? 0]; }

  get diceFace(): number {
    return this.rolling ? this.face : (this.state?.lastRoll?.roll ?? this.face);
  }
  get pips(): boolean[] {
    const on = PIPS[this.diceFace] ?? [];
    return Array.from({ length: 9 }, (_, i) => on.includes(i));
  }

  get lastMessage(): string {
    const s = this.state;
    const r = s?.lastRoll;
    if (!r) return 'Game started. Good luck! 🍀';
    const name = s.players.find((p: any) => p.id === r.playerId)?.name ?? 'Player';
    let msg = `${name} rolled a ${r.roll}`;
    if (r.jump) {
      msg += r.jump.from > r.jump.to
        ? ` 🐍 bitten! Slid down to ${r.jump.to}`
        : ` 🪜 climbed up to ${r.jump.to}`;
    } else if (r.from === r.to) {
      msg += ' and stays put (exact roll needed for 100)';
    } else {
      msg += ` and moved to ${r.to}`;
    }
    if (r.roll === 6 && s.status === 'playing') msg += ' • rolls again!';
    return msg;
  }

  colorOf(p: any): string { return COLOR_MAP[p?.color]?.bg ?? p?.color ?? '#999'; }

  roll() {
    if (!this.isMyTurn || this.rolling) return;
    this.rolling = true;
    const timer = setInterval(() => (this.face = 1 + Math.floor(Math.random() * 6)), 90);
    setTimeout(() => {
      clearInterval(timer);
      this.rolling = false;
      this.game.roll();
    }, 800);
  }

  async copyCode() {
    try {
      await navigator.clipboard.writeText(this.state.code);
      this.copied = true;
      setTimeout(() => (this.copied = false), 1500);
    } catch {
      /* clipboard may be blocked; ignore */
    }
  }

  goHome() { this.router.navigate(['/']); }
}
