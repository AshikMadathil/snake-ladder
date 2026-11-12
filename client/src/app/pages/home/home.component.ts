import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { GameService } from '../../services/game.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent {
  name = '';
  code = '';
  error = '';

  constructor(private game: GameService, private router: Router) {}

  async create() {
    this.error = '';
    if (!this.name.trim()) { this.error = 'Enter your name'; return; }
    try {
      const res = await this.game.createRoom(this.name.trim());
      if (res.ok) this.router.navigate(['/room', res.code]);
      else this.error = res.error ?? 'Could not create room';
    } catch {
      this.error = 'Cannot reach server. Wait a minute and try again.';
    }
  }
  
  async join() {
    this.error = '';
    if (!this.name.trim() || !this.code.trim()) { this.error = 'Enter name and room code'; return; }
    try {
      const res = await this.game.joinRoom(this.code.trim(), this.name.trim());
      if (res.ok) this.router.navigate(['/room', res.code]);
      else this.error = res.error;
    } catch {
      this.error = 'Cannot reach server. Wait a minute and try again.';
    }
  }
}