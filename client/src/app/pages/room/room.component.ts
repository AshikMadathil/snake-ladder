import { Component, effect } from '@angular/core';
import { Router } from '@angular/router';
import { GameService } from '../../services/game.service';
import { SoundService } from '../../services/sound.service';
import { BoardComponent, colorOf } from '../../components/board/board.component';
import { DiceComponent } from '../../components/dice/dice.component';
import { LobbyComponent } from '../../components/lobby/lobby.component';
import { WinnerComponent } from '../../components/winner/winner.component';
import { medal, ordinal } from '../../util/rank';

@Component({
  selector: 'app-room',
  standalone: true,
  imports: [BoardComponent, DiceComponent, LobbyComponent, WinnerComponent],
  templateUrl: './room.component.html',
  styleUrl: './room.component.scss',
})
export class RoomComponent {
  rolling = false;
  zoom = false;
  toast = '';
  showResults = false;

  private face = 1;
  private wasMyTurn = false;
  private seenRoll = '';
  private focusOverride = '';
  private focusTimer?: ReturnType<typeof setTimeout>;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private resultsTimer?: ReturnType<typeof setTimeout>;

  constructor(public game: GameService, public sound: SoundService, private router: Router) {
    try { this.zoom = localStorage.getItem('sl_zoom') === '1'; } catch { /* no storage */ }

    // buzz the phone and chime when it becomes your turn
    effect(() => {
      const mine = this.isMyTurn;
      if (mine && !this.wasMyTurn) {
        this.buzz(180);
        setTimeout(() => { if (this.isMyTurn) this.sound.turn(); }, 1300); // after the tokens finish moving
      }
      this.wasMyTurn = mine;
    });

    // every new roll: dice sound for others, camera follows the mover, announce finishers
    effect(() => {
      const s = this.game.state();
      const r = s?.lastRoll;
      if (!r) { this.seenRoll = ''; return; }
      const key = `${r.playerId}-${r.roll}-${r.from}-${r.to}`;
      if (key === this.seenRoll) return;
      this.seenRoll = key;

      const mine = r.playerId === this.game.myId();
      if (!mine) this.sound.diceLand();

      this.focusOverride = r.playerId;
      clearTimeout(this.focusTimer);
      this.focusTimer = setTimeout(() => (this.focusOverride = ''), 2000);

      if (r.rank && s.status !== 'finished') {
        const name = mine ? 'You' : (s.players.find((p: any) => p.id === r.playerId)?.name ?? 'Player');
        const text = `${medal({ finished: true, rank: r.rank })} ${name} finished ${ordinal(r.rank)}!`;
        setTimeout(() => { this.say(text); this.sound.win(mine); }, 1500); // after the last hop
      }
    });

    // show the standings a moment after the last move, so the final hop is seen
    effect(() => {
      if (this.game.state()?.status === 'finished') {
        if (!this.resultsTimer && !this.showResults) {
          this.resultsTimer = setTimeout(() => { this.showResults = true; this.resultsTimer = undefined; }, 2300);
        }
      } else {
        clearTimeout(this.resultsTimer);
        this.resultsTimer = undefined;
        this.showResults = false;
      }
    });
  }

  get state() { return this.game.state(); }
  get me() { return this.state?.players?.find((p: any) => p.id === this.game.myId()); }
  get activePlayer() { return this.state?.players?.[this.state.turnIndex]; }
  get activeId(): string { return this.state?.status === 'playing' ? (this.activePlayer?.id ?? '') : ''; }
  get focusId(): string { return this.focusOverride || this.activeId || this.game.myId(); }

  get isMyTurn() {
    const s = this.state;
    return s?.status === 'playing' && !this.me?.finished && s.players[s.turnIndex]?.id === this.game.myId();
  }

  get winnerName(): string {
    return this.state?.players?.find((p: any) => p.id === this.state.winnerId)?.name ?? 'Someone';
  }

  /** Finished players first by rank, players who left without finishing last. */
  get standings() {
    return [...(this.state?.players ?? [])].sort((a: any, b: any) => (a.rank ?? 99) - (b.rank ?? 99));
  }

  /** Changes with every new roll, so the dice is re-created and plays its pop animation for everybody. */
  get rollKey() { return [this.state?.lastRoll ?? 0]; }
  get diceFace(): number { return this.rolling ? this.face : (this.state?.lastRoll?.roll ?? this.face); }

  get banner(): string {
    if (this.state?.status !== 'playing') return 'Game over';
    return this.isMyTurn ? '🎯 Your turn!' : `${this.activePlayer?.name ?? 'Player'}'s turn`;
  }

  get rollLabel(): string {
    if (this.rolling) return 'Rolling…';
    if (this.me?.finished && this.state?.status === 'playing') return `${medal(this.me)} You finished ${ordinal(this.me.rank)} · watching`;
    if (this.isMyTurn) return 'Roll Dice 🎲';
    return `${this.activePlayer?.name ?? 'Player'} is playing…`;
  }

  get lastMessage(): string {
    const s = this.state;
    const r = s?.lastRoll;
    if (!r) return 'Game started. Good luck! 🍀';
    const name = s.players.find((p: any) => p.id === r.playerId)?.name ?? 'Player';
    let msg = `${name} rolled a ${r.roll}`;
    if (r.rank) {
      msg += ` and reached 100! 🏆 ${ordinal(r.rank)} place`;
    } else if (r.jump) {
      msg += r.jump.from > r.jump.to
        ? ` 🐍 bitten! Slid down to ${r.jump.to}`
        : ` 🪜 climbed up to ${r.jump.to}`;
    } else if (r.from === r.to) {
      msg += ' and stays put (exact roll needed for 100)';
    } else {
      msg += ` and moved to ${r.to}`;
    }
    if (r.roll === 6 && !r.rank && s.status === 'playing') msg += ' • rolls again!';
    return msg;
  }

  col(p: any) { return colorOf(p.color); }
  badge(p: any): string { return medal(p) || String(p.pos); }

  roll() {
    if (!this.isMyTurn || this.rolling) return;
    this.rolling = true;
    this.buzz(25);
    this.sound.diceRoll(800);
    const timer = setInterval(() => (this.face = 1 + Math.floor(Math.random() * 6)), 90);
    setTimeout(() => {
      clearInterval(timer);
      this.rolling = false;
      this.game.roll();
    }, 800);
  }

  toggleZoom() {
    this.zoom = !this.zoom;
    try { localStorage.setItem('sl_zoom', this.zoom ? '1' : '0'); } catch { /* no storage */ }
  }

  private say(text: string) {
    this.toast = text;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = ''), 3400);
  }

  private buzz(ms: number) {
    try { if (typeof navigator !== 'undefined') navigator.vibrate?.(ms); } catch { /* not supported */ }
  }

  leaveGame() {
    const playing = this.state?.status === 'playing' && !this.me?.finished;
    if (playing && !confirm('Leave this game?')) return;
    this.goHome();
  }

  goHome() { this.router.navigate(['/']); }
}
