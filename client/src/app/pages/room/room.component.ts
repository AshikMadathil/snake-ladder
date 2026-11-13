import { Component, OnDestroy, effect } from '@angular/core';
import { Router } from '@angular/router';
import { GameService } from '../../services/game.service';
import { SoundService } from '../../services/sound.service';
import { VoiceService } from '../../services/voice.service';
import { BoardComponent, colorOf } from '../../components/board/board.component';
import { ChatComponent } from '../../components/chat/chat.component';
import { DiceComponent } from '../../components/dice/dice.component';
import { LobbyComponent } from '../../components/lobby/lobby.component';
import { WinnerComponent } from '../../components/winner/winner.component';
import { medal, ordinal } from '../../util/rank';

const DICE_MS = 800; // how long the dice tumbles before the number shows (same on every screen)
const PAUSE_MS = 800; // the number stays on the dice this long before the coin starts to move

@Component({
  selector: 'app-room',
  standalone: true,
  imports: [ChatComponent, BoardComponent, DiceComponent, LobbyComponent, WinnerComponent],
  templateUrl: './room.component.html',
  styleUrl: './room.component.scss',
})
export class RoomComponent implements OnDestroy {
  /** The dice is tumbling (nobody can roll, the number is not known yet). */
  rolling = false;
  toast = '';
  showResults = false;
  secondsLeft = 0;
  /** Players as drawn on the board: the roller stays on the old square until the dice has stopped. */
  view: any[] = [];

  private face = 1;
  private turnEnd = 0;
  private readyAt = 0;
  private seenN = -1;
  private clickAt = 0;
  private revealing = false;
  private wasMyTurn = false;
  private clock?: ReturnType<typeof setInterval>;
  private revealTimer?: ReturnType<typeof setTimeout>;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private resultsTimer?: ReturnType<typeof setTimeout>;
  private failTimer?: ReturnType<typeof setTimeout>;

  constructor(public game: GameService, public sound: SoundService, public voice: VoiceService, private router: Router) {
    // every state update from the server
    effect(() => {
      const s = this.game.state();
      if (!s) { this.seenN = -1; this.view = []; return; }

      this.turnEnd = Date.now() + (s.turnLeft ?? 0);
      this.readyAt = Date.now() + (s.readyIn ?? 0);

      const r = s.lastRoll;
      const n = r?.n ?? 0;
      if (this.seenN === -1) {
        this.seenN = n;            // first state after loading / reconnecting: just show it, no replay
        this.view = s.players;
      } else if (n !== this.seenN) {
        this.seenN = n;
        this.startReveal(s, r);    // new roll: dice tumbles, stops, then the token walks
      } else {
        this.view = this.revealing ? this.masked(s.players, r) : s.players;
      }

      // buzz + chime when it becomes your turn (after the move on screen has finished)
      const mine = s.status === 'playing' && !this.me?.finished && s.players[s.turnIndex]?.id === this.game.myId();
      if (mine && !this.wasMyTurn) {
        const wait = Math.max(0, this.readyAt - Date.now()) + 50;
        setTimeout(() => { if (this.canRoll) { this.buzz(180); this.sound.turn(); } }, wait);
      }
      this.wasMyTurn = mine;
    });

    // show the standings a moment after the last move, so the final hop is seen
    effect(() => {
      if (this.game.state()?.status === 'finished') {
        if (!this.resultsTimer && !this.showResults) {
          this.resultsTimer = setTimeout(() => { this.showResults = true; this.resultsTimer = undefined; }, 4200);
        }
      } else {
        clearTimeout(this.resultsTimer);
        this.resultsTimer = undefined;
        this.showResults = false;
      }
    });

    this.clock = setInterval(() => {
      if (this.rolling) this.face = 1 + Math.floor(Math.random() * 6);
      const s = this.state;
      this.secondsLeft = s?.status === 'playing' && !this.busy ? Math.max(0, Math.ceil((this.turnEnd - Date.now()) / 1000)) : 0;
    }, 90);
  }

  /** New roll arrived: tumble the dice, then show the number and let the token walk. */
  private startReveal(s: any, r: any) {
    const mine = r.playerId === this.game.myId() && this.clickAt > 0;
    this.revealing = true;
    this.rolling = true;
    this.view = this.masked(s.players, r);
    let wait = DICE_MS;
    if (mine) wait = Math.max(0, this.clickAt + DICE_MS - Date.now()); // the roller's dice already started on tap
    else this.sound.diceRoll(DICE_MS);

    clearTimeout(this.revealTimer);
    clearTimeout(this.failTimer);
    this.revealTimer = setTimeout(() => {
      this.rolling = false; // dice stopped: the number is visible, the coin waits a moment
      this.clickAt = 0;
      this.revealTimer = setTimeout(() => this.moveCoin(r), PAUSE_MS);
    }, wait);
  }

  private moveCoin(r: any) {
    {
      this.revealing = false;
      const st = this.state;
      this.view = st?.players ?? [];
      if (r.rank && st) {
        const who = r.playerId === this.game.myId() ? 'You' : (st.players.find((p: any) => p.id === r.playerId)?.name ?? 'Player');
        const text = `${medal({ finished: true, rank: r.rank })} ${who} finished ${ordinal(r.rank)}!`;
        const delay = Math.max(600, this.readyAt - Date.now() - 300);
        setTimeout(() => { this.say(text); this.sound.win(r.playerId === this.game.myId()); }, delay);
      }
    }
  }

  /** The roller is still drawn on the square they started from. */
  private masked(players: any[], r: any): any[] {
    if (!r) return players;
    return players.map((p) => (p.id === r.playerId ? { ...p, pos: r.from, finished: false, rank: null } : p));
  }

  get state() { return this.game.state(); }
  /** Player chips follow the board: the square number changes when the coin moves, not before. */
  get chipPlayers() { return this.view.length ? this.view : (this.state?.players ?? []); }
  get me() { return this.state?.players?.find((p: any) => p.id === this.game.myId()); }
  get activePlayer() { return this.state?.players?.[this.state.turnIndex]; }

  /** Dice and token movement of the last roll are still playing. */
  get busy(): boolean { return this.revealing || Date.now() < this.readyAt; }

  /** Whose turn is highlighted: while a move is on screen it stays on the player who is moving. */
  get shownIndex(): number {
    const s = this.state;
    if (!s) return -1;
    if (this.busy && s.lastRoll) {
      const i = s.players.findIndex((p: any) => p.id === s.lastRoll.playerId);
      if (i >= 0) return i;
    }
    return s.turnIndex;
  }
  get shownPlayer() { return this.state?.players?.[this.shownIndex]; }
  get activeId(): string { return this.state?.status === 'playing' ? (this.shownPlayer?.id ?? '') : ''; }

  get isMyTurn() {
    const s = this.state;
    return s?.status === 'playing' && !this.me?.finished && !this.me?.left && s.players[s.turnIndex]?.id === this.game.myId();
  }
  get canRoll() { return this.isMyTurn && !this.rolling && !this.busy; }

  /** Finished players first by rank, players who left without finishing last. */
  get standings() {
    return [...(this.state?.players ?? [])].sort((a: any, b: any) => (a.rank ?? 99) - (b.rank ?? 99));
  }

  /** Changes with every new roll, so the dice is re-created and plays its pop animation. */
  get rollKey() { return [this.state?.lastRoll?.n ?? 0]; }
  /** Random faces while tumbling, then always the exact number the server rolled. */
  get diceFace(): number { return this.rolling ? this.face : (this.state?.lastRoll?.roll ?? this.face); }

  get banner(): string {
    if (this.state?.status !== 'playing') return 'Game over';
    if (this.busy) return `${this.shownPlayer?.name ?? 'Player'} is playing…`;
    const t = this.secondsLeft > 0 ? ` · ${this.formatTime(this.secondsLeft)}` : '';
    return (this.isMyTurn ? '🎯 Your turn!' : `${this.activePlayer?.name ?? 'Player'}'s turn`) + t;
  }

  get rollLabel(): string {
    if (this.me?.left && this.state?.status === 'playing') return 'You were removed (inactive)';
    if (this.me?.finished && this.state?.status === 'playing') return `${medal(this.me)} You finished ${ordinal(this.me.rank)} · watching`;
    if (this.rolling) return 'Rolling…';
    if (this.canRoll) return 'Roll Dice 🎲';
    if (this.isMyTurn) return 'Wait…';
    return `${(this.busy ? this.shownPlayer : this.activePlayer)?.name ?? 'Player'} is playing…`;
  }

  get lastMessage(): string {
    const s = this.state;
    const r = s?.lastRoll;
    if (!r) return 'Game started. Roll a 1 or a 6 to start moving! 🍀';
    const name = s.players.find((p: any) => p.id === r.playerId)?.name ?? 'Player';
    if (this.rolling) return `${name} is rolling… 🎲`;
    let msg = `${name} rolled a ${r.roll}`;
    if (r.blocked) {
      msg += ' – needs a 1 or a 6 to start';
    } else if (r.rank) {
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
    return msg;
  }

  col(p: any) { return colorOf(p.color); }
  badge(p: any): string { return medal(p) || String(p.pos); }
  private formatTime(sec: number) { return sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : `${sec}s`; }

  roll() {
    if (!this.canRoll) return;
    this.rolling = true;
    this.clickAt = Date.now();
    this.buzz(25);
    this.sound.diceRoll(DICE_MS);
    this.game.roll();
    // if the server never answers, do not leave the dice spinning forever
    clearTimeout(this.failTimer);
    this.failTimer = setTimeout(() => { if (!this.revealing) { this.rolling = false; this.clickAt = 0; } }, 8000);
  }

  private say(text: string) {
    this.toast = text;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = ''), 3400);
  }

  private buzz(ms: number) {
    try { if (typeof navigator !== 'undefined') navigator.vibrate?.(ms); } catch { /* not supported */ }
  }

  /** Leave button, back button and swipe-back all end up here (via the route guard). */
  canLeave(): boolean {
    const s = this.state;
    if (!s) return true;
    const inGame = s.status === 'playing' && this.me && !this.me.finished && !this.me.left;
    if (inGame && !confirm('Leave the game? You will be out of this match.')) return false;
    this.voice.leave();
    this.game.leave();
    return true;
  }

  leaveGame() { this.goHome(); }

  start() {
    void this.game.start().then((r) => { if (!r.ok) this.say(r.error ?? 'Could not start the game'); });
  }

  goHome() { this.router.navigate(['/']); }

  ngOnDestroy() {
    this.voice.leave();
    clearInterval(this.clock);
    for (const t of [this.revealTimer, this.toastTimer, this.resultsTimer, this.failTimer]) clearTimeout(t);
  }
}
