// AudioWorklet that forwards mono Float32 audio to the main thread in ~40 ms
// batches (fewer postMessage calls than one per 128-sample render quantum).
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.batch = new Float32Array(2048)
    this.filled = 0
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) {
      let offset = 0
      while (offset < channel.length) {
        const take = Math.min(this.batch.length - this.filled, channel.length - offset)
        this.batch.set(channel.subarray(offset, offset + take), this.filled)
        this.filled += take
        offset += take
        if (this.filled === this.batch.length) {
          this.port.postMessage(this.batch, [this.batch.buffer])
          this.batch = new Float32Array(2048)
          this.filled = 0
        }
      }
    }
    return true
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor)
