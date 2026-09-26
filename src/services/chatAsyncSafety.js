/** Prevent a completed request from mutating a newer conversation or call. */
export class OperationScope {
  #generation = 0;
  begin() {
    const generation = ++this.#generation;
    return () => generation === this.#generation;
  }
  cancel() { this.#generation += 1; }
}

export function stopMediaStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

/** Own acquired tracks even when ICE lookup fails or the call is cancelled. */
export async function acquireCallMedia(getMedia, getIceServers, isCurrent) {
  let stream;
  let failed = false;
  try {
    const results = await Promise.all([
      getMedia().then((value) => {
        stream = value;
        if (failed || !isCurrent()) stopMediaStream(stream);
        return value;
      }),
      getIceServers(),
    ]);
    if (!isCurrent()) throw new DOMException('Call cancelled', 'AbortError');
    return results;
  } catch (error) {
    failed = true;
    stopMediaStream(stream);
    throw error;
  }
}
