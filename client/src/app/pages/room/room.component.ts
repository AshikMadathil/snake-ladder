import { Component, effect } from '@angular/core';
import { Router } from '@angular/router';
import { GameService } from '../../services/game.service';
import { SoundService } from '../../services/sound.service';
import { BoardComponent, colorOf } from '../../components/board/board.component';
import { DiceComponent } from '../../components/dice/dice.component';
import { LobbyComponent } from '../../components/lobby/lobby.component';
import { WinnerComponent } from '../../components/winner/winner.component';

@Component({
  selector: 'app-room',
  standalone: true,
  imports: [BoardComponent, DiceComponent, LobbyComponent, WinnerComponent],
  templateUrl: './room.component.html',
  styleUrl: './room.component.scss',
})
export class RoomComponent {
  rolling = false;
  private face = 1;
  private wasMyTurn = false;
  private seenRoll = '';

  constructor(public game: GameService, public sound: SoundService, private router: Router) {
    // buzz the phone and chime when it becomes your turn
    effect(() => {
      const mine = this.isMyTurn;
      if (mine && !this.wasMyTurn) {
        this.buzz(180);
        setTimeout(() => { if (this.isMyTurn) this.sound.turn(); }, 1300); // after the tokens finish moving
      }
      this.wasMyTurn = mine;
    });

    // someone else rolled: play the dice landing
    effect(() => {
      const r = this.game.state()?.lastRoll;
      if (!r) { this.seenRoll = ''; return; }
      const key = `${r.playerId}-${r.roll}-${r.from}-${r.to}`;
      if (key === this.seenRoll) return;
      this.seenRoll = key;
      if (r.playerId !== this.game.myId()) this.sound.diceLand();
    });
  }

  get state() { return this.game.state(); }
  get activePlayer() { return this.state?.players?.[this.state.turnIndex]; }
  get activeId(): string { return this.state?.status === 'playing' ? (this.activePlayer?.id ?? '') : ''; }
  get isMyTurn() {
    const s = this.state;
    return s?.status === 'playing' && s.players[s.turnIndex]?.id === this.game.myId();
  }
  get winnerName(): string {
    return this.state?.players?.find((p: any) => p.id === this.state.winnerId)?.name ?? 'Someone';
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
    if (this.isMyTurn) return 'Roll Dice 🎲';
    return `${this.activePlayer?.name ?? 'Player'} is playing…`;
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

  col(p: any) { return colorOf(p.color); }

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

  private buzz(ms: number) {
    try { if (typeof navigator !== 'undefined') navigator.vibrate?.(ms); } catch { /* not supported */ }
  }

  leaveGame() {
    if (this.state?.status === 'playing' && !confirm('Leave this game?')) return;
    this.goHome();
  }

  goHome() { this.router.navigate(['/']); }
}
