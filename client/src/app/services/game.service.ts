import { Inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';

interface Session { code: string; token: string }
const KEY = 'sl_session';

@Injectable({ providedIn: 'root' })
export class GameService {
  socket?: Socket;
  state = signal<any>(null);
  myId = signal<string>('');
  /** True while the socket is connected. */
  online = signal(true);
  /** True while we are getting back into a room after a reload or a dropped connection. */
  rejoining = signal(false);
  /** The room we belong to (kept in the browser so a reload or "back" returns to it). */
  session = signal<Session | null>(null);

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    if (isPlatformBrowser(platformId)) {
      this.session.set(this.load());
      this.rejoining.set(!!this.session());
      this.socket = io(environment.serverUrl);
      this.socket.on('connect', () => {
        this.myId.set(this.socket!.id!);
        this.online.set(true);
        void this.rejoin();
      });
      this.socket.on('disconnect', () => this.online.set(false));
      this.socket.on('state', (s) => this.state.set(s));
    }
  }

  createRoom(name: string) {
    return this.request('createRoom', { name }, true);
  }
  joinRoom(code: string, name: string) {
    return this.request('joinRoom', { code, name }, true);
  }

  /** Get back into the saved room (after a page reload, "back", or a network drop). */
  private async rejoin() {
    const s = this.session();
    if (!s) { this.rejoining.set(false); return; }
    this.rejoining.set(true);
    const res = await this.request('rejoinRoom', s, false);
    if (!res.ok && !res.timeout) { this.save(null); this.state.set(null); }
    this.rejoining.set(false);
  }

  private request(event: string, payload: any, remember: boolean) {
    return new Promise<any>((resolve) => {
      if (!this.socket) { resolve({ ok: false, error: 'No connection' }); return; }
      this.socket.timeout(45000).emit(event, payload, (err: any, res: any) => {
        if (err) { resolve({ ok: false, timeout: true, error: 'Cannot reach server. It may be waking up, try again in a minute.' }); return; }
        if (remember && res?.ok) this.save({ code: res.code, token: res.token });
        resolve(res);
      });
    });
  }

  start() {
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      if (!this.socket) { resolve({ ok: false, error: 'No connection' }); return; }
      this.socket.timeout(10000).emit('startGame', {}, (err: any, res: any) =>
        resolve(err ? { ok: false, error: 'No answer from the server. Check your internet.' } : res));
    });
  }

  roll() { this.socket?.emit('rollDice'); }

  leave() {
    this.socket?.emit('leaveRoom');
    this.save(null);
    this.state.set(null);
  }

  private load(): Session | null {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch { return null; }
  }

  private save(s: Session | null) {
    this.session.set(s);
    try {
      if (s) localStorage.setItem(KEY, JSON.stringify(s));
      else localStorage.removeItem(KEY);
    } catch { /* no storage */ }
  }
}
