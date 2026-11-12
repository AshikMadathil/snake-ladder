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
    return this.request('createRoom', { name });
  }
  joinRoom(code: string, name: string) {
    return this.request('joinRoom', { code, name });
  }
  
  private request(event: string, payload: any) {
    return new Promise<any>((resolve) => {
      if (!this.socket) { resolve({ ok: false, error: 'No connection' }); return; }
      this.socket.timeout(15000).emit(event, payload, (err: any, res: any) => {
        if (err) resolve({ ok: false, error: 'Cannot reach server. It may be waking up, try again in a minute.' });
        else resolve(res);
      });
    });
  }
  start() { this.socket!.emit('startGame'); }
  roll() { this.socket!.emit('rollDice'); }
}