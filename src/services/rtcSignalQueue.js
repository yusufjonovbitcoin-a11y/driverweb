export class RtcSignalQueue {
  #pending = new Map();
  #handled = new Set();
  #drainPromise = null;

  constructor({ process = null, idOf = (signal) => signal.id } = {}) {
    this.process = process;
    this.idOf = idOf;
  }

  get pendingCount() {
    return this.#pending.size;
  }

  enqueue(signal) {
    const id = this.idOf(signal);
    if (id == null || this.#handled.has(id) || this.#pending.has(id)) return false;
    this.#pending.set(id, signal);
    return true;
  }

  drain(process = this.process) {
    if (typeof process !== 'function') throw new TypeError('A signal processor is required.');
    if (this.#drainPromise) return this.#drainPromise;
    const operation = this.#drainPending(process);
    this.#drainPromise = operation;
    operation.then(
      () => { if (this.#drainPromise === operation) this.#drainPromise = null; },
      () => { if (this.#drainPromise === operation) this.#drainPromise = null; },
    );
    return operation;
  }

  reset() {
    this.#pending.clear();
    this.#handled.clear();
  }

  async #drainPending(process) {
    while (this.#pending.size > 0) {
      const [id, signal] = this.#pending.entries().next().value;
      await process(signal);
      this.#pending.delete(id);
      this.#handled.add(id);
    }
  }
}
