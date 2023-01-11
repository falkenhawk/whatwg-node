import {
  isFetchEvent,
  isNodeRequest,
  isRequestInit,
  isServerResponse,
  NodeRequest,
  NodeResponse,
  normalizeNodeRequest,
  sendNodeResponse,
} from './utils';
import * as DefaultFetchAPI from '@whatwg-node/fetch';
import {
  DefaultServerAdapterContext,
  FetchAPI,
  FetchEvent,
  ServerAdapter,
  ServerAdapterBaseObject,
  ServerAdapterObject,
  ServerAdapterRequestHandler,
} from './types';
import { OnRequestHook, OnResponseHook, ServerAdapterPlugin } from './plugins/types';

async function handleWaitUntils(waitUntilPromises: Promise<unknown>[]) {
  const waitUntils = await Promise.allSettled(waitUntilPromises);
  waitUntils.forEach(waitUntil => {
    if (waitUntil.status === 'rejected') {
      console.error(waitUntil.reason);
    }
  });
}

export interface ServerAdapterOptions<TServerContext> {
  plugins?: ServerAdapterPlugin<TServerContext>[];
  fetchAPI?: Partial<FetchAPI>;
}

function createServerAdapter<
  TServerContext = DefaultServerAdapterContext,
  THandleRequest extends ServerAdapterRequestHandler<TServerContext> = ServerAdapterRequestHandler<TServerContext>
>(
  serverAdapterRequestHandler: THandleRequest,
  options?: ServerAdapterOptions<TServerContext>,
): ServerAdapter<TServerContext, ServerAdapterBaseObject<TServerContext, THandleRequest>>;
function createServerAdapter<TServerContext, TBaseObject extends ServerAdapterBaseObject<TServerContext>>(
  serverAdapterBaseObject: TBaseObject,
  options?: ServerAdapterOptions<TServerContext>,
): ServerAdapter<TServerContext, TBaseObject>;
function createServerAdapter<
  TServerContext = DefaultServerAdapterContext,
  THandleRequest extends ServerAdapterRequestHandler<TServerContext> = ServerAdapterRequestHandler<TServerContext>,
  TBaseObject extends ServerAdapterBaseObject<TServerContext, THandleRequest> = ServerAdapterBaseObject<
    TServerContext,
    THandleRequest
  >
>(
  serverAdapterBaseObject: TBaseObject | THandleRequest,
  options?: ServerAdapterOptions<TServerContext>,
): ServerAdapter<TServerContext, TBaseObject> {
  const fetchAPI = {
    ...DefaultFetchAPI,
    ...options?.fetchAPI,
  }
  const givenHandleRequest =
    typeof serverAdapterBaseObject === 'function' ? serverAdapterBaseObject : serverAdapterBaseObject.handle;

  const onRequestHooks: OnRequestHook<TServerContext>[] = [];
  const onResponseHooks: OnResponseHook<TServerContext>[] = [];

  for (const plugin of options?.plugins ?? []) {
    if (plugin.onRequest) {
      onRequestHooks.push(plugin.onRequest);
    }
    if (plugin.onResponse) {
      onResponseHooks.push(plugin.onResponse);
    }
  }

  async function handleRequest(request: Request, serverContext: TServerContext) {
    const url = new URL(request.url, 'http://localhost');
    let requestHandler: ServerAdapterRequestHandler<TServerContext> = givenHandleRequest;
    let response: Response | undefined
    for (const onRequestHook of onRequestHooks) {
      await onRequestHook({
        request,
        serverContext,
        fetchAPI,
        url,
        requestHandler,
        setRequestHandler(newRequestHandler) {
          requestHandler = newRequestHandler;
        },
        endResponse(newResponse) {
          response = newResponse
        },
      })
      if (response) {
        break;
      }
    }
    if (!response) {
      response = await requestHandler(request, serverContext);
    }
    for (const onResponseHook of onResponseHooks) {
      await onResponseHook({
        request,
        response,
        serverContext,
      })
    }
    return response;
  }

  function handleNodeRequest(nodeRequest: NodeRequest, ...ctx: Partial<TServerContext>[]) {
    const serverContext = ctx.length > 1 ? Object.assign({}, ...ctx) : ctx[0];
    const request = normalizeNodeRequest(nodeRequest, fetchAPI.Request);
    return handleRequest(request, serverContext);
  }

  async function requestListener(
    nodeRequest: NodeRequest,
    serverResponse: NodeResponse,
    ...ctx: Partial<TServerContext>[]
  ) {
    const waitUntilPromises: Promise<unknown>[] = [];
    const defaultServerContext = {
      req: nodeRequest,
      res: serverResponse,
      waitUntil(promise: Promise<void> | void) {
        if (promise != null) {
          waitUntilPromises.push(promise);
        }
      },
    };
    const response = await handleNodeRequest(nodeRequest, defaultServerContext as any, ...ctx);
    if (response) {
      await sendNodeResponse(response, serverResponse);
    } else {
      await new Promise<void>(resolve => {
        serverResponse.statusCode = 404;
        serverResponse.once('end', resolve);
        serverResponse.end();
      });
    }
    if (waitUntilPromises.length > 0) {
      await handleWaitUntils(waitUntilPromises);
    }
  }

  function handleEvent(event: FetchEvent, ...ctx: Partial<TServerContext>[]): void {
    if (!event.respondWith || !event.request) {
      throw new TypeError(`Expected FetchEvent, got ${event}`);
    }
    const serverContext = ctx.length > 0 ? Object.assign({}, event, ...ctx) : event;
    const response$ = handleRequest(event.request, serverContext);
    event.respondWith(response$);
  }

  function handleRequestWithWaitUntil(request: Request, ...ctx: Partial<TServerContext>[]) {
    const serverContext: TServerContext & object = ctx.length > 1 ? Object.assign({}, ...ctx) : ctx[0] || {};
    if (!('waitUntil' in serverContext)) {
      const waitUntilPromises: Promise<void>[] = [];
      const response$ = handleRequest(request, {
        ...serverContext,
        waitUntil(promise: Promise<void> | void) {
          if (promise != null) {
            waitUntilPromises.push(promise);
          }
        },
      });
      if (waitUntilPromises.length > 0) {
        return handleWaitUntils(waitUntilPromises).then(() => response$);
      }
      return response$;
    }
    return handleRequest(request, serverContext);
  }

  const fetchFn: ServerAdapterObject<TServerContext>['fetch'] = (
    input,
    ...maybeCtx: Partial<TServerContext>[]
  ) => {
    if (typeof input === 'string' || input instanceof URL) {
      const [initOrCtx, ...restOfCtx] = maybeCtx;
      if (isRequestInit(initOrCtx)) {
        return handleRequestWithWaitUntil(new fetchAPI.Request(input, initOrCtx), ...restOfCtx);
      }
      return handleRequestWithWaitUntil(new fetchAPI.Request(input), ...maybeCtx);
    }
    return handleRequestWithWaitUntil(input, ...maybeCtx);
  };

  const genericRequestHandler = (
    input: Request | FetchEvent | NodeRequest | ({ request: Request } & Partial<TServerContext>),
    ...maybeCtx: Partial<TServerContext>[]
  ): Promise<Response> | Response | Promise<void> | void => {
    // If it is a Node request
    const [initOrCtxOrRes, ...restOfCtx] = maybeCtx;
    if (isNodeRequest(input)) {
      if (!isServerResponse(initOrCtxOrRes)) {
        throw new TypeError(`Expected ServerResponse, got ${initOrCtxOrRes}`);
      }
      return requestListener(input, initOrCtxOrRes, ...restOfCtx);
    }

    if (isServerResponse(initOrCtxOrRes)) {
      throw new TypeError('Got Node response without Node request');
    }

    // Is input a container object over Request?
    if (typeof input === 'object' && 'request' in input) {
      // Is it FetchEvent?
      if (isFetchEvent(input)) {
        return handleEvent(input, ...maybeCtx);
      }
      // In this input is also the context
      return handleRequestWithWaitUntil(input.request, input, ...maybeCtx);
    }

    // Or is it Request itself?
    // Then ctx is present and it is the context
    return fetchFn(input, ...maybeCtx);
  };

  const adapterObj: ServerAdapterObject<TServerContext> = {
    handleRequest,
    fetch: fetchFn,
    handleNodeRequest,
    requestListener,
    handleEvent,
    handle: genericRequestHandler as ServerAdapterObject<TServerContext>['handle'],
  };

  return new Proxy(genericRequestHandler, {
    // It should have all the attributes of the handler function and the server instance
    has: (_, prop) => {
      return (
        prop in adapterObj ||
        prop in genericRequestHandler ||
        (serverAdapterBaseObject && prop in serverAdapterBaseObject)
      );
    },
    get: (_, prop) => {
      const adapterProp = adapterObj[prop];
      if (adapterProp) {
        if (adapterProp.bind) {
          return adapterProp.bind(adapterObj);
        }
        return adapterProp;
      }
      const handleProp = genericRequestHandler[prop];
      if (handleProp) {
        if (handleProp.bind) {
          return handleProp.bind(genericRequestHandler);
        }
        return handleProp;
      }
      if (serverAdapterBaseObject) {
        const serverAdapterBaseObjectProp = serverAdapterBaseObject[prop];
        if (serverAdapterBaseObjectProp) {
          if (serverAdapterBaseObjectProp.bind) {
            return serverAdapterBaseObjectProp.bind(serverAdapterBaseObject);
          }
          return serverAdapterBaseObjectProp;
        }
      }
    },
    apply(_, __, args: Parameters<ServerAdapterObject<TServerContext>['handle']>) {
      return genericRequestHandler(...args);
    },
  }) as any; // 😡
}

export { createServerAdapter };
