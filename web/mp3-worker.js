// Practice desk — MP3 encoding, in a worker so a long take doesn't freeze the page.
//
// The encoder is LAME, through lamejs (https://github.com/zhuker/lamejs), loaded
// unmodified from vendor/lame.min.js under the LGPL-3.0: see vendor/LAME-LICENSE.txt,
// vendor/LGPL-3.0.txt and https://lame.sourceforge.io. Browsers record Opus and AAC
// but cannot write MP3 themselves.
//
// In:  {start: {channels, sampleRate, kbps}}
//      {pcm: Int16Array}   interleaved 16-bit samples, as many times as needed
//      {end: true}
// Out: {progress: frames} after each pcm message, then {done: Blob} or {error}
importScripts("vendor/lame.min.js");

const FRAME = 1152;   // samples per MP3 frame
let enc = null, channels = 1, frames = 0;
const parts = [];

function encode(pcm) {
  const n = Math.floor(pcm.length / channels);
  let left = pcm, right = null;
  if (channels === 2) {
    left = new Int16Array(n); right = new Int16Array(n);
    for (let i = 0; i < n; i++) { left[i] = pcm[2 * i]; right[i] = pcm[2 * i + 1]; }
  }
  for (let i = 0; i < n; i += FRAME) {
    const out = right
      ? enc.encodeBuffer(left.subarray(i, i + FRAME), right.subarray(i, i + FRAME))
      : enc.encodeBuffer(left.subarray(i, i + FRAME));
    if (out.length) parts.push(out);
  }
  frames += n;
}

onmessage = e => {
  const m = e.data || {};
  try {
    if (m.start) {
      channels = m.start.channels === 2 ? 2 : 1;
      enc = new lamejs.Mp3Encoder(channels, m.start.sampleRate, m.start.kbps);
    } else if (m.pcm && enc) {
      encode(m.pcm);
      postMessage({ progress: frames });
    } else if (m.end && enc) {
      parts.push(enc.flush());
      postMessage({ done: new Blob(parts, { type: "audio/mpeg" }) });
      close();
    }
  } catch (err) {
    postMessage({ error: String((err && err.message) || err) });
    close();
  }
};
