// React state updates are asynchronous: reserve a page request synchronously
// before multiple scroll notifications can start the same network request.
export class ChatPaginationScope {
  select(key) {
    if (key === this.key) return;
    this.key = key;
    this.invalidate();
  }

  invalidate() { this.pending = null; }

  begin() {
    if (this.pending) return null;
    const token = {};
    this.pending = token;
    return {
      isCurrent: () => this.pending === token,
      finish: () => { if (this.pending === token) this.pending = null; },
    };
  }
}
