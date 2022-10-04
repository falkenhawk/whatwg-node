import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { PonyfillAbortError } from './AbortError';
import { PonyfillRequest, RequestPonyfillInit } from './Request';
import { PonyfillResponse } from './Response';
import { getHeadersObj } from './utils';
import { fileURLToPath } from 'url';
import { createReadStream } from 'fs';
import { Readable } from 'stream';

function getResponseForFile(url: string) {
  const path = fileURLToPath(url);
  const readable = createReadStream(path);
  return new PonyfillResponse(readable);
}

function getRequestFnForProtocol(protocol: string) {
  switch (protocol) {
    case 'http':
      return httpRequest;
    case 'https':
      return httpsRequest;
  }
  throw new Error(`Unsupported protocol: ${protocol}`);
}

export const fetchPonyfill = (
  info: string | PonyfillRequest | URL,
  init?: RequestPonyfillInit
): Promise<PonyfillResponse> => {
  if (typeof info === 'string' || info instanceof URL) {
    const ponyfillRequest = new PonyfillRequest(info, init);
    return fetchPonyfill(ponyfillRequest);
  }

  const fetchRequest = info;

  return new Promise((resolve, reject) => {
    try {
      const protocol = fetchRequest.url.split('://')[0];
      if (protocol === 'file') {
        const response = getResponseForFile(fetchRequest.url);
        resolve(response);
        return;
      }
      const requestFn = getRequestFnForProtocol(protocol);

      const nodeReadable = (
        fetchRequest.body != null
          ? 'pipe' in fetchRequest.body
            ? fetchRequest.body
            : Readable.from(fetchRequest.body)
          : null
      ) as Readable | null;
      const nodeHeaders = getHeadersObj(fetchRequest.headers);

      const abortListener: EventListener = function abortListener(event: Event) {
        nodeRequest.destroy();
        reject(new PonyfillAbortError((event as CustomEvent).detail));
      };

      fetchRequest.signal.addEventListener('abort', abortListener);

      const nodeRequest = requestFn(fetchRequest.url, {
        // signal: fetchRequest.signal will be added when v14 reaches EOL
        method: fetchRequest.method,
        headers: nodeHeaders,
      });

      nodeRequest.once('response', nodeResponse => {
        if (nodeResponse.headers.location) {
          if (fetchRequest.redirect === 'error') {
            const redirectError = new Error('Redirects are not allowed');
            reject(redirectError);
            nodeResponse.resume();
            return;
          }
          if (fetchRequest.redirect === 'follow') {
            const redirectedUrl = new URL(nodeResponse.headers.location, fetchRequest.url);
            const redirectResponse$ = fetchPonyfill(redirectedUrl, info);
            resolve(
              redirectResponse$.then(redirectResponse => {
                redirectResponse.redirected = true;
                return redirectResponse;
              })
            );
            nodeResponse.resume();
            return;
          }
        }
        const responseHeaders: Record<string, string | string[] | undefined> = nodeResponse.headers;
        const ponyfillResponse = new PonyfillResponse(nodeResponse, {
          status: nodeResponse.statusCode,
          statusText: nodeResponse.statusMessage,
          headers: responseHeaders,
          url: info.url,
        });
        resolve(ponyfillResponse);
      });
      nodeRequest.once('error', reject);

      if (nodeReadable) {
        nodeReadable.pipe(nodeRequest);
      } else {
        nodeRequest.end();
      }
    } catch (e) {
      reject(e);
    }
  });
};
