import { Component } from '@angular/core';
import { Router } from '@angular/router';
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

  constructor(private game: GameService, private router: Router) {}

  async create(name: string) {
    this.error = '';
    name = name.trim();
    if (!name) { this.error = 'Enter your name'; return; }
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
    this.loading = true;
    const res = await this.game.joinRoom(code, name);
    this.loading = false;
    if (res.ok) this.router.navigate(['/room', res.code]);
    else this.error = res.error ?? 'Could not join room';
  }
}
