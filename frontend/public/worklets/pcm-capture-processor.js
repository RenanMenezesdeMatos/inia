// Downsamples the mic's native input (whatever the AudioContext runs at,
// typically 48kHz) to 16-bit PCM at the target rate Gemini Live expects
// (16kHz mono). Nearest-neighbor decimation, not a filtered resample — good
// enough for speech, not for hi-fi audio, and simple enough to avoid pulling
// in a resampling library for a worklet that has to stay dependency-free.
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const targetSampleRate = options.processorOptions?.targetSampleRate ?? 16000
    this.ratio = sampleRate / targetSampleRate
    this.chunkSize = options.processorOptions?.chunkSize ?? 1600 // ~100ms at 16kHz
    this.pending = []
    this.sampleCursor = 0
    this.levelBlockCount = 0
  }

  process(inputs) {
    const channel = inputs[0]?.[0]
    if (!channel || channel.length === 0) return true

    let sumSquares = 0
    for (let i = 0; i < channel.length; i++) {
      sumSquares += channel[i] * channel[i]
      this.sampleCursor += 1
      if (this.sampleCursor >= this.ratio) {
        this.sampleCursor -= this.ratio
        this.pending.push(channel[i])
      }
    }

    // ~19 blocks (128 samples each) is ~19Hz at a 48kHz native rate — every
    // 4 blocks (the previous value) was actually ~93Hz, way more often than
    // any UI needs and fast enough to make React re-renders driven by it
    // visibly janky rather than smooth.
    this.levelBlockCount += 1
    if (this.levelBlockCount >= 19) {
      this.levelBlockCount = 0
      const rms = Math.sqrt(sumSquares / channel.length)
      this.port.postMessage({ type: "level", value: rms })
    }

    while (this.pending.length >= this.chunkSize) {
      const chunk = this.pending.splice(0, this.chunkSize)
      const pcm16 = new Int16Array(chunk.length)
      for (let j = 0; j < chunk.length; j++) {
        const sample = Math.max(-1, Math.min(1, chunk[j]))
        pcm16[j] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
      }
      this.port.postMessage(pcm16.buffer, [pcm16.buffer])
    }

    return true
  }
}

registerProcessor("pcm-capture-processor", PcmCaptureProcessor)
