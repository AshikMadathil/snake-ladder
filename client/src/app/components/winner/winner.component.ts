import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { SoundService } from '../../services/sound.service';
import { medal, ordinal } from '../../util/rank';

const COLORS = ['#ff4d4f', '#3b82f6', '#22c55e', '#facc15', '#ff9f43', '#e84393'];

@Component({
  selector: 'app-winner',
  standalone: true,
  templateUrl: './winner.component.html',
  styleUrl: './winner.component.scss',
})
export class WinnerComponent implements OnInit {
  /** Players sorted by rank (1st first, the loser last, players who left at the end). */
  @Input() standings: any[] = [];
  @Input() myId = '';
  @Output() home = new EventEmitter<void>();

  readonly medal = medal;

  readonly confetti = Array.from({ length: 32 }, (_, i) => ({
    left: (i * 37) % 100,
    delay: ((i * 13) % 10) / 10,
    color: COLORS[i % COLORS.length],
  }));

  constructor(private sound: SoundService) {}

  get me() { return this.standings.find((p) => p.id === this.myId); }
  /** Confetti and fanfare for 1st place and every other player who finished but was not last. */
  get good() { const m = this.me; return !!m?.rank && !m.loser; }

  get title(): string {
    const m = this.me;
    if (m?.rank === 1) return 'You win! 🎉';
    if (m?.loser) return 'Better luck next time!';
    if (m?.rank) return `You finished ${ordinal(m.rank)}!`;
    return 'Game over';
  }

  ngOnInit() { this.sound.win(this.good); }
}
