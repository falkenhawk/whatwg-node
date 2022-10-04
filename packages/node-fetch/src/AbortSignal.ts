import { PonyfillAbortError } from './AbortError';
// Will be removed after v14 reaches EOL
import { EventTarget } from '@whatwg-node/events';

export class PonyfillAbortSignal extends EventTarget implements AbortSignal {
  aborted = false;
  _onabort: ((this: AbortSignal, ev: Event) => any) | null = null;
  reason: any;
  throwIfAborted(): void {
    if (this.aborted) {
      throw new PonyfillAbortError();
    }
  }

  get onabort() {
    return this._onabort;
  }

  set onabort(value) {
    if (this._onabort) {
      this.removeEventListener('abort', this._onabort);
    }
    this.addEventListener('abort', value);
  }
}
