import { Component, effect } from '@angular/core';
import { Router } from '@angular/router';
import { GameService } from '../../services/game.service';

@Component({
  selector: 'app-room',
  standalone: true,
  templateUrl: './room.component.html',
  styleUrl: './room.component.scss',
})
export class RoomComponent {
  constructor(public game: GameService, private router: Router) {}

  get state() { return this.game.state(); }
  get isHost() { return this.state?.hostId === this.game.myId(); }
  get isMyTurn() {
    const s = this.state;
    return s?.status === 'playing' && s.players[s.turnIndex]?.id === this.game.myId();
  }
  goHome() { this.router.navigate(['/']); }
}