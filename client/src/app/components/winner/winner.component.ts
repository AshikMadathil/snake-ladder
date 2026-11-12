import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { SoundService } from '../../services/sound.service';

const COLORS = ['#ff4d4f', '#3b82f6', '#22c55e', '#facc15', '#ff9f43', '#e84393'];

@Component({
  selector: 'app-winner',
  standalone: true,
  templateUrl: './winner.component.html',
  styleUrl: './winner.component.scss',
})
export class WinnerComponent implements OnInit {
  @Input() name = '';
  @Input() isMe = false;
  @Output() home = new EventEmitter<void>();

  constructor(private sound: SoundService) {}

  ngOnInit() { this.sound.win(this.isMe); }

  readonly confetti = Array.from({ length: 32 }, (_, i) => ({
    left: (i * 37) % 100,
    delay: ((i * 13) % 10) / 10,
    color: COLORS[i % COLORS.length],
  }));
}
