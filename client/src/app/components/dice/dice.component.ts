import { Component, Input } from '@angular/core';

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

@Component({
  selector: 'app-dice',
  standalone: true,
  templateUrl: './dice.component.html',
  styleUrl: './dice.component.scss',
})
export class DiceComponent {
  @Input() face = 1;
  @Input() rolling = false;

  get pips(): boolean[] {
    const on = PIPS[this.face] ?? [];
    return Array.from({ length: 9 }, (_, i) => on.includes(i));
  }
}
