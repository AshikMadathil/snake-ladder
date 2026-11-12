import { Inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class GameService {
  private socket?: Socket;
  state = signal<any>(null);
  myId = signal<string>('');

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    if (isPlatformBrowser(platformId)) {
      this.socket = io(environment.serverUrl);
      this.socket.on('connect', () => this.myId.set(this.socket!.id!));
      this.socket.on('state', (s) => this.state.set(s));
    }
  }

  createRoom(name: string) {
    return new Promise<any>((res) => this.socket!.emit('createRoom', { name }, res));
  }
  joinRoom(code: string, name: string) {
    return new Promise<any>((res) => this.socket!.emit('joinRoom', { code, name }, res));
  }
  start() { this.socket!.emit('startGame'); }
  roll() { this.socket!.emit('rollDice'); }
}