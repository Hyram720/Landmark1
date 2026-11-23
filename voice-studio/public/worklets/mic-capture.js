// Runs on the audio thread: collects mono microphone samples in 1024-sample blocks.
class MicCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(1024);
    this.i = 0;
    this.muted = false;
    this.port.onmessage = (e) => { if (e.data === 'mute') this.muted = true; if (e.data === 'unmute') this.muted = false; };
  }
  process(inputs) {
    const ch = inputs[0];
    if (!ch || !ch.length) return true;
    const n = ch[0].length;
    for (let k = 0; k < n; k++) {
      let s = 0;
      for (let c = 0; c < ch.length; c++) s += ch[c][k];
      this.buf[this.i++] = this.muted ? 0 : s / ch.length;
      if (this.i === this.buf.length) {
        this.port.postMessage(this.buf.slice());
        this.i = 0;
      }
    }
    return true;
  }
}
registerProcessor('mic-capture', MicCapture);
