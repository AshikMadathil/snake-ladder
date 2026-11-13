import { Component, ElementRef, Input, ViewChild, effect } from '@angular/core';
import { GameService } from '../../services/game.service';
import { colorOf } from '../board/board.component';

/** 💬 button for the top bar + the chat sheet that slides up from the bottom. */
@Component({
  selector: 'app-chat',
  standalone: true,
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss',
})
export class ChatComponent {
  /** Colour of the player who is looking at the screen, to tell "my" messages apart. */
  @Input() myColor = '';
  @ViewChild('list') list?: ElementRef<HTMLElement>;

  open = false;
  unread = 0;
  readonly quick = ['👍', '😂', '😮', '🔥', 'GG', '😡'];
  private seen = 0;

  constructor(public game: GameService) {
    effect(() => {
      const all = this.game.messages();
      const fresh = all.length >= this.seen ? all.slice(this.seen) : [];
      this.seen = all.length;
      if (this.open) this.unread = 0;
      else this.unread += fresh.filter((m) => m.color !== this.myColor).length;
      this.toBottom();
    });
  }

  toggle() {
    this.open = !this.open;
    if (this.open) { this.unread = 0; this.toBottom(); }
  }

  send(box: HTMLInputElement) {
    const t = box.value.trim();
    if (!t) return;
    this.game.chat(t);
    box.value = '';
    box.focus();
  }

  say(t: string) { this.game.chat(t); }
  bg(color: string) { return colorOf(color).bg; }

  private toBottom() {
    setTimeout(() => { const l = this.list?.nativeElement; if (l) l.scrollTop = l.scrollHeight; }, 30);
  }
}
