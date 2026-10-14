// Mono samples are transferred to the session for PCM16 encoding and resampling.
class AlterMicrophone extends AudioWorkletProcessor {
  constructor() { super(); this.pending = []; this.length = 0; }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) {
      this.pending.push(new Float32Array(channel)); this.length += channel.length;
      if (this.length >= 2048) {
        const data = new Float32Array(this.length); let offset = 0;
        for (const block of this.pending) { data.set(block, offset); offset += block.length; }
        this.port.postMessage(data, [data.buffer]); this.pending = []; this.length = 0;
      }
    }
    return true;
  }
}
registerProcessor('alter-microphone', AlterMicrophone);
