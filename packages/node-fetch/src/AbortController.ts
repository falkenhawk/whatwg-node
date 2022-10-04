import { PonyfillAbortSignal } from './AbortSignal';
import { CustomEvent } from '@whatwg-node/events';

// Will be removed after v14 reaches EOL
export class PonyfillAbortController implements AbortController {
  signal = new PonyfillAbortSignal();
  abort(reason?: any) {
    this.signal.dispatchEvent(new CustomEvent('abort', { detail: reason }));
  }
}
