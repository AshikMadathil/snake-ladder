import { Injectable, signal } from '@angular/core';
import { GameService } from './game.service';

// Free public STUN servers. If players on some mobile networks cannot hear each other,
// add a TURN server here (e.g. a free Metered / Open Relay account).
const ICE: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
};

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  queue: RTCIceCandidateInit[];
}

/** Group voice chat: WebRTC audio straight between players, Socket.IO only carries the signalling. */
@Injectable({ providedIn: 'root' })
export class VoiceService {
  joined = signal(false);
  connecting = signal(false);
  muted = signal(false);
  error = signal('');
  /** Socket ids of everybody who is talking right now (for the green ring). */
  speaking = signal<ReadonlySet<string>>(new Set());

  private local?: MediaStream;
  private peers = new Map<string, Peer>();
  private meters = new Map<string, AnalyserNode>();
  private ctx?: AudioContext;
  private poll?: ReturnType<typeof setInterval>;
  private bound?: { sig: (m: any) => void; left: (id: string) => void };

  constructor(private game: GameService) {}

  async join() {
    const socket = this.game.socket;
    if (!socket || this.joined() || this.connecting()) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      return this.fail('Voice chat is not supported on this browser');
    }
    this.connecting.set(true);
    try {
      this.local = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      return this.fail('Allow the microphone to use voice chat');
    }
    this.local.getAudioTracks().forEach((t) => (t.enabled = !this.muted()));

    this.bound = { sig: (m) => void this.onSignal(m), left: (id) => this.drop(id) };
    socket.on('voiceSignal', this.bound.sig);
    socket.on('voiceLeft', this.bound.left);

    const res: any = await new Promise((resolve) =>
      socket.timeout(8000).emit('voiceJoin', {}, (err: any, r: any) => resolve(err ? null : r)));
    if (!res?.ok) { this.cleanup(); return this.fail('Could not join voice chat'); }

    try {
      this.ctx = this.ctx ?? new AudioContext();
      void this.ctx.resume();
      this.meter(this.game.myId(), this.local);
    } catch { /* speaking rings are optional */ }

    this.joined.set(true);
    this.connecting.set(false);
    this.poll = setInterval(() => this.checkSpeaking(), 200);
    for (const id of res.peers as string[]) await this.call(id); // we are the newcomer: we call everyone
  }

  leave() {
    if (this.joined() || this.connecting()) this.game.socket?.emit('voiceLeave');
    this.cleanup();
  }

  toggleMute() {
    const m = !this.muted();
    this.muted.set(m);
    this.local?.getAudioTracks().forEach((t) => (t.enabled = !m));
    if (m) this.setSpeaking(this.game.myId(), false);
  }

  // ---------- WebRTC ----------

  private makePeer(id: string): Peer {
    const pc = new RTCPeerConnection(ICE);
    const audio = new Audio();
    audio.autoplay = true;
    const peer: Peer = { pc, audio, queue: [] };
    this.local?.getTracks().forEach((t) => pc.addTrack(t, this.local!));
    pc.onicecandidate = (e) => { if (e.candidate) this.send(id, { ice: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0];
      void audio.play().catch(() => undefined);
      this.meter(id, e.streams[0]);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.drop(id);
    };
    this.peers.set(id, peer);
    return peer;
  }

  private async call(id: string) {
    const { pc } = this.makePeer(id);
    await pc.setLocalDescription(await pc.createOffer());
    this.send(id, { sdp: pc.localDescription });
  }

  private async onSignal({ from, data }: { from: string; data: any }) {
    if (!this.joined() && !this.connecting()) return;
    let peer = this.peers.get(from);
    try {
      if (data.sdp) {
        if (!peer) {
          if (data.sdp.type !== 'offer') return;
          peer = this.makePeer(from);
        }
        await peer.pc.setRemoteDescription(data.sdp);
        for (const c of peer.queue.splice(0)) await peer.pc.addIceCandidate(c);
        if (data.sdp.type === 'offer') {
          await peer.pc.setLocalDescription(await peer.pc.createAnswer());
          this.send(from, { sdp: peer.pc.localDescription });
        }
      } else if (data.ice && peer) {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.ice);
        else peer.queue.push(data.ice);
      }
    } catch { /* a bad signal only affects that one connection */ }
  }

  private send(to: string, data: any) { this.game.socket?.emit('voiceSignal', { to, data }); }

  private drop(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    p.pc.onconnectionstatechange = null;
    p.pc.close();
    p.audio.srcObject = null;
    this.peers.delete(id);
    this.meters.delete(id);
    this.setSpeaking(id, false);
  }

  private cleanup() {
    const socket = this.game.socket;
    if (this.bound) { socket?.off('voiceSignal', this.bound.sig); socket?.off('voiceLeft', this.bound.left); }
    this.bound = undefined;
    [...this.peers.keys()].forEach((id) => this.drop(id));
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = undefined;
    this.meters.clear();
    clearInterval(this.poll);
    this.speaking.set(new Set());
    this.joined.set(false);
    this.connecting.set(false);
  }

  // ---------- speaking indicator ----------

  private meter(id: string, stream: MediaStream) {
    if (!this.ctx) return;
    const a = this.ctx.createAnalyser();
    a.fftSize = 256;
    this.ctx.createMediaStreamSource(stream).connect(a);
    this.meters.set(id, a);
  }

  private checkSpeaking() {
    const buf = new Uint8Array(128);
    const next = new Set<string>();
    for (const [id, a] of this.meters) {
      if (id === this.game.myId() && this.muted()) continue;
      a.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      if (peak > 12) next.add(id);
    }
    const cur = this.speaking();
    if (next.size !== cur.size || [...next].some((x) => !cur.has(x))) this.speaking.set(next);
  }

  private setSpeaking(id: string, on: boolean) {
    const next = new Set(this.speaking());
    on ? next.add(id) : next.delete(id);
    this.speaking.set(next);
  }

  private fail(msg: string) {
    this.cleanup();
    this.error.set(msg);
    setTimeout(() => this.error.set(''), 4000);
  }
}
