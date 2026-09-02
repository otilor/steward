const TARGET_RATE = 16000;

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const alignedTotal = total - (total % 2);
  const out = new Uint8Array(alignedTotal);
  let offset = 0;
  for (const chunk of chunks) {
    const toCopy = Math.min(chunk.byteLength, alignedTotal - offset);
    if (toCopy <= 0) break;
    out.set(chunk.subarray(0, toCopy), offset);
    offset += toCopy;
  }
  return out;
}

export function toMono16kPcm(pcm: Uint8Array, sampleRate: number, channels: number): Uint8Array {
  const sampleCount = Math.floor(pcm.byteLength / 2);
  if (sampleCount === 0) return new Uint8Array(0);

  const alignedBuffer = new ArrayBuffer(sampleCount * 2);
  new Uint8Array(alignedBuffer).set(pcm.subarray(0, sampleCount * 2));
  let src = new Int16Array(alignedBuffer);

  if (channels > 1) {
    const frames = Math.floor(src.length / channels);
    const dst = new Int16Array(frames);
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) sum += src[i * channels + c];
      dst[i] = (sum / channels) | 0;
    }
    src = dst;
  }

  if (sampleRate === TARGET_RATE) {
    return new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
  }

  const ratio = sampleRate / TARGET_RATE;
  const dstLen = Math.max(1, Math.floor(src.length / ratio));
  const dst = new Int16Array(dstLen);
  for (let i = 0; i < dstLen; i++) {
    const x = i * ratio;
    const i0 = Math.min(src.length - 1, Math.floor(x));
    const i1 = Math.min(src.length - 1, i0 + 1);
    const t = x - i0;
    dst[i] = (src[i0] * (1 - t) + src[i1] * t) | 0;
  }
  return new Uint8Array(dst.buffer, dst.byteOffset, dst.byteLength);
}

export function encodeWavPcm16(pcm: Uint8Array, sampleRate = TARGET_RATE, channels = 1): Uint8Array {
  const dataSize = pcm.byteLength;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const out = new Uint8Array(buf);
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataSize, true);
  out.set(pcm, 44);
  return out;
}
