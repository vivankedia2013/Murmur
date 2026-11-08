// Runs Whisper locally in a worker thread so the app never freezes.
const { parentPort, workerData } = require('worker_threads');

let asr = null;
let loadedModel = null;
let loading = null;

async function load(model) {
  if (asr && loadedModel === model) return;
  if (loading) await loading;
  loading = (async () => {
    parentPort.postMessage({ type: 'status', state: 'loading', progress: 0 });
    const { pipeline, env } = await import('@huggingface/transformers');
    env.cacheDir = workerData.cacheDir;
    asr = null;
    asr = await pipeline('automatic-speech-recognition', model, {
      dtype: 'q8',
      device: 'cpu',
      progress_callback: (p) => {
        if (p.status === 'progress' && typeof p.progress === 'number') {
          parentPort.postMessage({ type: 'status', state: 'downloading', progress: Math.round(p.progress) });
        }
      },
    });
    loadedModel = model;
    parentPort.postMessage({ type: 'status', state: 'ready' });
  })();
  try { await loading; } finally { loading = null; }
}

parentPort.on('message', async (msg) => {
  try {
    if (msg.type === 'load') {
      await load(msg.model);
    } else if (msg.type === 'transcribe') {
      await load(msg.model);
      const out = await asr(msg.audio, { chunk_length_s: 30, stride_length_s: 5 });
      parentPort.postMessage({ type: 'result', id: msg.id, text: out.text || '' });
    }
  } catch (err) {
    parentPort.postMessage({ type: 'error', id: msg.id, message: String(err && err.message || err) });
  }
});
