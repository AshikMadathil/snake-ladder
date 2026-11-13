import { Component, effect } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { GameService } from '../../services/game.service';

@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent {
  error = '';
  loading = false;
  code = '';
  savedName = '';

  constructor(private game: GameService, private router: Router, route: ActivatedRoute) {
    // reloaded the page or came back while a game is running: go straight back into it
    effect(() => {
      const s = this.game.state();
      if (s && this.game.session()) void this.router.navigate(['/room', s.code]);
    });
    // invite links look like /?code=ABC123
    this.code = (route.snapshot.queryParamMap.get('code') ?? '').toUpperCase().slice(0, 6);
    // keep the address bar clean so the back button always lands on the plain home page
    if (this.code) void this.router.navigate([], { relativeTo: route, queryParams: {}, replaceUrl: true });
    try { this.savedName = localStorage.getItem('sl_name') ?? ''; } catch { /* no storage */ }
  }

  /** Back button of the join section: forget the invite and show the normal home page. */
  backToHome() {
    this.code = '';
    this.error = '';
  }

  private remember(name: string) {
    try { localStorage.setItem('sl_name', name); } catch { /* no storage */ }
  }

  async create(name: string) {
    this.error = '';
    name = name.trim();
    if (!name) { this.error = 'Enter your name'; return; }
    this.remember(name);
    this.loading = true;
    const res = await this.game.createRoom(name);
    this.loading = false;
    if (res.ok) this.router.navigate(['/room', res.code]);
    else this.error = res.error ?? 'Could not create room';
  }

  async join(name: string, code: string) {
    this.error = '';
    name = name.trim();
    code = code.trim().toUpperCase();
    if (!name || !code) { this.error = 'Enter name and room code'; return; }
    this.remember(name);
    this.loading = true;
    const res = await this.game.joinRoom(code, name);
    this.loading = false;
    if (res.ok) this.router.navigate(['/room', res.code]);
    else this.error = res.error ?? 'Could not join room';
  }
}
