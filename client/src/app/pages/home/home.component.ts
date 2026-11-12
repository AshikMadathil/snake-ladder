import { Component } from '@angular/core';
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
    // invite links look like /?code=ABC123
    this.code = (route.snapshot.queryParamMap.get('code') ?? '').toUpperCase().slice(0, 6);
    try { this.savedName = localStorage.getItem('sl_name') ?? ''; } catch { /* no storage */ }
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
