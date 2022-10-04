import { PonyfillBody, BodyPonyfillInit, PonyfillBodyOptions } from './Body';
import { PonyfillHeaders, PonyfillHeadersInit } from './Headers';

export type ResponsePonyfilInit = PonyfillBodyOptions &
  Omit<ResponseInit, 'headers'> & {
    url?: string;
    redirected?: boolean;
    headers?: PonyfillHeadersInit;
  };

export class PonyfillResponse extends PonyfillBody implements Response {
  constructor(body?: BodyPonyfillInit | null, init?: ResponsePonyfilInit) {
    super(body || null, init);
    if (init) {
      this.headers = new PonyfillHeaders(init.headers);
      this.status = init.status || 200;
      this.statusText = init.statusText || 'OK';
      this.url = init.url || '';
      this.redirected = init.redirected || false;
    }
  }

  headers: Headers = new PonyfillHeaders();

  get ok() {
    return this.status >= 200 && this.status < 300;
  }

  status = 200;
  statusText = 'OK';
  url = '';
  redirected = false;

  type: ResponseType = 'default';

  clone() {
    return new PonyfillResponse(this.body, this);
  }

  static error() {
    const response = new PonyfillResponse(null, {
      status: 500,
      statusText: 'Internal Server Error',
    });
    return response;
  }

  static redirect(url: string, status = 301) {
    if (status < 300 || status > 399) {
      throw new RangeError('Invalid status code');
    }
    return new PonyfillResponse(null, {
      headers: {
        location: url,
      },
      status,
    });
  }

  static json(data: any, init: RequestInit = {}) {
    return new PonyfillResponse(JSON.stringify(data), {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
  }
}
