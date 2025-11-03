// filepath: src/webgl/BakeManager.js
// A minimal baking manager that serializes DOM->Texture baking to avoid contention.
import { bakeElementToTexture } from './domBake.js';

class BakeManager {
  constructor() {
    this._queue = [];
    this._running = false;
  }

  enqueue(id, element, options = {}) {
    // Drop older pending jobs for the same id to keep only the latest request
    this._queue = this._queue.filter(j => j.id !== id);
    return new Promise((resolve, reject) => {
      this._queue.push({ id, element, options, resolve, reject });
      this._drain();
    });
  }

  async _drain() {
    if (this._running) return;
    this._running = true;
    while (this._queue.length) {
      const job = this._queue.shift();
      try {
        const res = await bakeElementToTexture(job.element, job.options);
        job.resolve(res);
      } catch (e) {
        job.reject(e);
      }
    }
    this._running = false;
  }
}

const instance = new BakeManager();
export default instance;
