/* LiveAgent: real-time voice conversation with a Phonic-1 agent.
 * Mic -> 44.1 kHz 16-bit PCM -> Phonic WebSocket -> agent audio -> speakers.
 * Based on the message flow in Phonic's MIT-licensed phonic-web-demo.
 *
 *   const a = new LiveAgent({ onStatus, onTranscript, onLevel, onError });
 *   await a.start(agentId);   // asks the studio server for a session token
 *   a.setMuted(true); a.stop();
 */
(function () {
  const RATE = 44100;

  const CLOSE_REASONS = {
    1000: 'Call ended.',
    4001: 'The call was cancelled.',
    4004: 'Phonic is busy right now. Try again in a minute.',
    4010: 'Too many calls running at once on your Phonic plan.',
    4429: 'Too many requests. Wait a moment and try again.',
    4500: 'Call ended after a long silence.',
    4505: 'Call reached its time limit.',
    4506: 'Connection timed out.',
    4800: 'The call expired.',
  };

  class LiveAgent {
    constructor(handlers = {}) {
      this.h = handlers;
      this.items = [];
      this.state = 'idle';
      this.authHeaders = handlers.headers || (() => ({}));
    }

    emit(name, ...args) { try { this.h[name]?.(...args); } catch (e) { console.error(e); } }

    setState(s, detail) { this.state = s; this.emit('onStatus', s, detail); }

    async start(agentId) {
      if (this.ws) this.stop();
      this.items = [];
      this.emit('onTranscript', this.items);
      this.setState('connecting');
      try {
        const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/session`, {
          method: 'POST', headers: this.authHeaders(),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Could not start the call (${res.status})`);

        await this.startAudio();
        this.open(data.wsUrl, data.sessionToken, data.config);
      } catch (err) {
        this.cleanup();
        this.setState('error', err.message);
        this.emit('onError', err.message);
      }
    }

    async startAudio() {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot use the microphone (open the studio at http://localhost).');
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        });
      } catch {
        throw new Error('Microphone access was blocked. Allow the microphone for this page and try again.');
      }
      // Playback context at the agent's rate; capture context at the device's native rate.
      this.outCtx = new AudioContext({ sampleRate: RATE });
      await this.outCtx.audioWorklet.addModule('/worklets/pcm-player.js');
      this.player = new AudioWorkletNode(this.outCtx, 'pcm-player', { outputChannelCount: [2] });
      this.player.connect(this.outCtx.destination);
      this.player.port.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'level') this.emit('onLevel', 'agent', m.value);
        if (m.type === 'drained') {
          this.emit('onLevel', 'agent', 0);
          if (this.endAfterPlayback) this.stop('The agent ended the call.');
        }
      };

      this.inCtx = new AudioContext();
      await this.inCtx.audioWorklet.addModule('/worklets/mic-capture.js');
      this.source = this.inCtx.createMediaStreamSource(this.stream);
      this.mic = new AudioWorkletNode(this.inCtx, 'mic-capture');
      this.source.connect(this.mic);
      const inRate = this.inCtx.sampleRate;
      this.mic.port.onmessage = (e) => {
        const f32 = e.data;
        let sum = 0;
        for (let i = 0; i < f32.length; i += 4) sum += f32[i] * f32[i];
        this.emit('onLevel', 'you', Math.sqrt(sum / (f32.length / 4)));
        this.sendAudio(resample(f32, inRate, RATE));
      };
      await Promise.all([this.outCtx.resume(), this.inCtx.resume()]);
    }

    open(wsUrl, token, config) {
      const sep = wsUrl.includes('?') ? '&' : '?';
      this.ws = new WebSocket(`${wsUrl}${sep}session_token=${encodeURIComponent(token)}`);
      this.ws.onopen = () => {
        this.ws.send(JSON.stringify(config));
        this.setState('live');
      };
      this.ws.onmessage = (e) => this.onMessage(e.data);
      this.ws.onerror = () => { /* close event carries the useful detail */ };
      this.ws.onclose = (e) => {
        const wasLive = this.state === 'live';
        this.cleanup();
        if (this.state === 'ended') return;
        const msg = CLOSE_REASONS[e.code] || (e.reason ? `Call ended: ${e.reason}` : `Connection closed (code ${e.code}).`);
        const isError = e.code !== 1000 && e.code !== 4500 && e.code !== 4505;
        this.setState(isError ? 'error' : 'ended', wasLive || isError ? msg : undefined);
        if (isError) this.emit('onError', msg);
      };
    }

    onMessage(raw) {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      switch (m.type) {
        case 'audio_chunk': {
          if (m.audio) this.playPcm(m.audio);
          if (m.text) {
            const last = this.items[this.items.length - 1];
            if (this.newAgentTurn || !last || last.role !== 'agent') this.items.push({ role: 'agent', text: m.text });
            else last.text += m.text;
            this.newAgentTurn = false;
            this.emit('onTranscript', this.items);
          }
          break;
        }
        case 'assistant_started_speaking':
          this.newAgentTurn = true;
          this.emit('onStatus', 'live', 'agent-speaking');
          break;
        case 'assistant_finished_speaking':
          this.emit('onStatus', 'live', 'listening');
          break;
        case 'user_started_speaking':
          // Barge-in: stop the agent's audio immediately.
          this.player?.port.postMessage({ type: 'clear' });
          if (this.items[this.items.length - 1]?.role !== 'you') this.items.push({ role: 'you', text: '' });
          this.emit('onTranscript', this.items);
          this.emit('onStatus', 'live', 'you-speaking');
          break;
        case 'user_finished_speaking':
          this.emit('onStatus', 'live', 'thinking');
          break;
        case 'input_text': {
          const last = this.items[this.items.length - 1];
          if (last?.role === 'you') last.text = (last.text ? last.text + ' ' : '') + (m.text || '');
          else this.items.push({ role: 'you', text: m.text || '' });
          this.emit('onTranscript', this.items);
          break;
        }
        case 'input_cancelled': {
          const last = this.items[this.items.length - 1];
          if (last?.role === 'you' && !last.text) { this.items.pop(); this.emit('onTranscript', this.items); }
          break;
        }
        case 'tool_call':
          // No custom tools are configured yet; answer so the agent isn't left waiting.
          this.ws?.send(JSON.stringify({ type: 'tool_call_output', tool_call_id: m.tool_call_id, output: { error: 'not available' } }));
          break;
        case 'assistant_ended_conversation':
          this.endAfterPlayback = true;
          break;
        case 'error':
          this.emit('onError', m.error?.message || m.message || 'Phonic reported an error.');
          break;
      }
    }

    playPcm(b64) {
      if (!this.player) return;
      const bin = atob(b64);
      const n = bin.length >> 1;
      const f32 = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
        if (v >= 0x8000) v -= 0x10000;
        f32[i] = v / 32768;
      }
      this.player.port.postMessage({ type: 'chunk', samples: f32 }, [f32.buffer]);
    }

    sendAudio(f32) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !f32.length) return;
      const bytes = new Uint8Array(f32.length * 2);
      for (let i = 0; i < f32.length; i++) {
        const s = Math.max(-1, Math.min(1, f32[i]));
        const v = s < 0 ? s * 0x8000 : s * 0x7fff;
        bytes[2 * i] = v & 0xff;
        bytes[2 * i + 1] = (v >> 8) & 0xff;
      }
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      this.ws.send(JSON.stringify({ type: 'audio_chunk', audio: btoa(bin) }));
    }

    setMuted(on) {
      this.muted = on;
      this.mic?.port.postMessage(on ? 'mute' : 'unmute'); // keeps sending silence so the call stays open
    }

    stop(message) {
      this.setState('ended', message || 'Call ended.');
      try { this.ws?.close(1000); } catch {}
      this.cleanup();
    }

    cleanup() {
      this.endAfterPlayback = false;
      if (this.ws) { this.ws.onclose = null; this.ws.onmessage = null; }
      this.ws = null;
      try { this.source?.disconnect(); this.mic?.disconnect(); this.player?.disconnect(); } catch {}
      this.stream?.getTracks().forEach((t) => t.stop());
      this.inCtx?.close().catch(() => {});
      this.outCtx?.close().catch(() => {});
      this.stream = this.inCtx = this.outCtx = this.mic = this.player = this.source = null;
      this.emit('onLevel', 'you', 0);
      this.emit('onLevel', 'agent', 0);
    }
  }

  // Linear-interpolation resampler (works up or down).
  function resample(input, from, to) {
    if (from === to) return input;
    const ratio = from / to;
    const len = Math.floor(input.length / ratio);
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const pos = i * ratio;
      const j = Math.floor(pos);
      const frac = pos - j;
      const a = input[j], b = input[j + 1] ?? a;
      out[i] = a + (b - a) * frac;
    }
    return out;
  }

  window.LiveAgent = LiveAgent;
})();
