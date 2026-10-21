import { describe, it, expect, afterEach } from 'bun:test';
import { MonidAPI } from '../../src/api/client.js';
import { MonidError } from '../../src/utils/error.js';
import { VERSION } from '../../src/config/constants.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answer the next request with this exact body, status and content type. */
function stubFetch(body: string, status: number, contentType: string): void {
  globalThis.fetch = (async () =>
    new Response(body, {
      status,
      headers: { 'content-type': contentType },
    })) as typeof fetch;
}

const api = new MonidAPI({ apiKey: 'test-key', baseUrl: 'https://api.example.test' });

/** The bare `<html>` + CRLF error page a gateway returns — not the API. */
const GATEWAY_HTML = '<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>...</body>\r\n</html>';

describe('MonidAPI request error handling', () => {
  it('reports the HTTP status when a gateway answers 5xx with HTML', async () => {
    // Regression: the body was parsed BEFORE the status was checked, so this
    // surfaced as `Unexpected token '<', "<html>..." is not valid JSON` and
    // the 502 was lost entirely.
    stubFetch(GATEWAY_HTML, 502, 'text/html');

    const err = await api.whoami().then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(MonidError);
    expect((err as MonidError).statusCode).toBe(502);
    expect((err as MonidError).code).toBe('HTTP_502');
    expect((err as MonidError).message).toBe('HTTP 502');
    expect((err as MonidError).message).not.toContain('Unexpected token');
  });

  it('keeps the mapped code for a non-JSON 401', async () => {
    stubFetch(GATEWAY_HTML, 401, 'text/html');

    const err = await api.whoami().then(() => null, (e: unknown) => e);
    expect((err as MonidError).code).toBe('AUTH_FAILED');
    expect((err as MonidError).statusCode).toBe(401);
  });

  it('still prefers a structured API error message over the status', async () => {
    stubFetch(
      JSON.stringify({ error: { code: 'INSUFFICIENT_BALANCE', message: 'Balance too low' } }),
      402,
      'application/json',
    );

    const err = await api.whoami().then(() => null, (e: unknown) => e);
    expect((err as MonidError).code).toBe('INSUFFICIENT_BALANCE');
    expect((err as MonidError).message).toBe('Balance too low');
  });

  it('names a 2xx that is not JSON instead of throwing a parse error', async () => {
    stubFetch('<html>\r\n<body>captive portal</body>\r\n</html>', 200, 'text/html');

    const err = await api.whoami().then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(MonidError);
    expect((err as MonidError).code).toBe('INVALID_RESPONSE');
    expect((err as MonidError).message).toContain('Expected JSON');
    expect((err as MonidError).message).toContain('text/html');
    expect((err as MonidError).message).not.toContain('Unexpected token');
  });

  it('describes an empty 2xx body rather than reporting a parse error', async () => {
    stubFetch('', 200, 'application/json');

    const err = await api.whoami().then(() => null, (e: unknown) => e);
    expect((err as MonidError).code).toBe('INVALID_RESPONSE');
    expect((err as MonidError).message).toContain('empty');
  });

  it('truncates a long non-JSON body in the error message', async () => {
    stubFetch('x'.repeat(5000), 200, 'text/plain');

    const err = await api.whoami().then(() => null, (e: unknown) => e);
    expect((err as MonidError).message).toContain('…');
    expect((err as MonidError).message.length).toBeLessThan(200);
  });

  it('returns the parsed payload on a normal 200', async () => {
    stubFetch(JSON.stringify({ workspace: 'Test Workspace' }), 200, 'application/json');

    const out = await api.whoami() as unknown as { workspace: string };
    expect(out.workspace).toBe('Test Workspace');
  });
});

describe('MonidAPI request headers', () => {
  it('identifies itself as cli@<version>', async () => {
    let sent: Headers | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sent = new Headers(init?.headers);
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    await api.whoami();
    expect(sent?.get('X-Monid-Client')).toBe(`cli@${VERSION}`);
  });
});

describe('MonidAPI sendFeedback', () => {
  function captureRequest(response: unknown, status = 201) {
    const sent: { url?: string; method?: string; body?: unknown } = {};
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      sent.url = url;
      sent.method = init?.method;
      sent.body = init?.body ? JSON.parse(String(init.body)) : undefined;
      return new Response(JSON.stringify(response), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    return sent;
  }

  it('POSTs the text to /v1/feedback and returns the stored id', async () => {
    const sent = captureRequest({ feedbackId: 'fb-1', createdAt: '2026-10-20T00:00:00.000Z' });

    const out = await api.sendFeedback('great results');
    expect(sent.method).toBe('POST');
    expect(sent.url).toBe('https://api.example.test/v1/feedback');
    expect(sent.body).toEqual({ text: 'great results' });
    expect(out.feedbackId).toBe('fb-1');
  });

  it('includes runId only when given', async () => {
    const sent = captureRequest({ feedbackId: 'fb-2', createdAt: '2026-10-20T00:00:00.000Z' });

    await api.sendFeedback('stale posts', '01JGXYZABCDEFGHJKMNPQRSTVW');
    expect(sent.body).toEqual({ text: 'stale posts', runId: '01JGXYZABCDEFGHJKMNPQRSTVW' });
  });

  it('surfaces a 404 for an unknown run as NOT_FOUND', async () => {
    captureRequest({ code: 404, message: 'Run 01X not found' }, 404);

    const err = await api.sendFeedback('x', '01X').then(() => null, (e: unknown) => e);
    expect((err as MonidError).statusCode).toBe(404);
    expect((err as MonidError).code).toBe('NOT_FOUND');
    expect((err as MonidError).message).toBe('Run 01X not found');
  });
});
