export function pcm16(input: Float32Array, sampleRate: number): Int16Array {
  const ratio = sampleRate / 16_000
  const output = new Int16Array(Math.floor(input.length / ratio))
  for (let i = 0; i < output.length; i++) {
    const from = Math.floor(i * ratio), to = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = from; j < to; j++) sum += input[j]
    const value = Math.max(-1, Math.min(1, sum / Math.max(1, to - from)))
    output[i] = Math.round(value * (value < 0 ? 32768 : 32767))
  }
  return output
}
export function pcmBase64(data: Int16Array) {
  const bytes = new Uint8Array(data.length * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < data.length; i++) view.setInt16(i * 2, data[i], true)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
export function decodeAudio(data: string, context: AudioContext, rate = 24_000) {
  const binary = atob(data)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  const view = new DataView(bytes.buffer)
  const buffer = context.createBuffer(1, Math.floor(bytes.length / 2), rate)
  const values = buffer.getChannelData(0)
  for (let i = 0; i < values.length; i++) values[i] = view.getInt16(i * 2, true) / 32768
  return buffer
}
