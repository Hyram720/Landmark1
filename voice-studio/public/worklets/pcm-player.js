// Runs on the audio thread: plays queued PCM chunks from the agent, gaplessly.
class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.playing = false;
    this.tick = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'chunk') this.queue.push(m.samples);
      else if (m.type === 'clear') { this.queue = []; this.offset = 0; }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    let w = 0, sum = 0;
    while (w < out.length && this.queue.length) {
      const cur = this.queue[0];
      const take = Math.min(out.length - w, cur.length - this.offset);
      for (let k = 0; k < take; k++) { const v = cur[this.offset + k]; out[w + k] = v; sum += v * v; }
      w += take; this.offset += take;
      if (this.offset >= cur.length) { this.queue.shift(); this.offset = 0; }
    }
    for (; w < out.length; w++) out[w] = 0;
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    const active = this.queue.length > 0;
    if (active !== this.playing) { this.playing = active; this.port.postMessage({ type: active ? 'playing' : 'drained' }); }
    if (active && ++this.tick % 6 === 0) this.port.postMessage({ type: 'level', value: Math.sqrt(sum / out.length) });
    return true;
  }
}
registerProcessor('pcm-player', PcmPlayer);
