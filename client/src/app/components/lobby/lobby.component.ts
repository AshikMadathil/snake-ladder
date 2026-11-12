import { Component, EventEmitter, Input, Output } from '@angular/core';
import { colorOf } from '../board/board.component';

@Component({
  selector: 'app-lobby',
  standalone: true,
  templateUrl: './lobby.component.html',
  styleUrl: './lobby.component.scss',
})
export class LobbyComponent {
  @Input() state: any;
  @Input() myId = '';
  @Output() start = new EventEmitter<void>();
  @Output() leave = new EventEmitter<void>();

  copied = false;

  get letters(): string[] { return (this.state?.code ?? '').split(''); }
  get isHost() { return this.state?.hostId === this.myId; }
  get link() { return `${location.origin}/?code=${this.state.code}`; }
  col(p: any) { return colorOf(p.color); }

  async share() {
    const text = `Join my Snake & Ladder game! Room code: ${this.state.code}`;
    const nav: any = navigator;
    if (nav.share) {
      try { await nav.share({ title: 'Snake & Ladder', text, url: this.link }); } catch { /* cancelled */ }
      return;
    }
    await this.copy();
  }

  async copy() {
    try {
      await navigator.clipboard.writeText(`Join my Snake & Ladder game! Room code: ${this.state.code}\n${this.link}`);
      this.copied = true;
      setTimeout(() => (this.copied = false), 1600);
    } catch { /* clipboard may be blocked */ }
  }
}
