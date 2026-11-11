/**
 * The HTTP side of one NanoKVM box.
 *
 * Why node:http and not fetch: two things the box needs are missing from undici's
 * public surface — a per-request `rejectUnauthorized` (the box ships a
 * self-signed certificate) and an abortable streaming read of the MJPEG
 * multipart body that does not buffer the whole stream. Both come for free here.
 */
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

/** The shared secret of the web UI — it only wraps the password in transit. */
const SECRET_KEY = 'nanokvm-sipeed-2024';

/**
 * Encrypt a password the way the web UI does (CryptoJS `AES.encrypt` with a
 * passphrase = OpenSSL "Salted__" format: AES-256-CBC, key/iv from EVP_BytesToKey
 * over MD5, base64, then URI-encoded).
 * @param {string} plain the password.
 * @returns {string} the value the login endpoint expects.
 */
export function encryptPassword(plain) {
  const salt = crypto.randomBytes(8);
  const secret = Buffer.from(SECRET_KEY);
  const d1 = crypto.createHash('md5').update(Buffer.concat([secret, salt])).digest();
  const d2 = crypto.createHash('md5').update(Buffer.concat([d1, secret, salt])).digest();
  const d3 = crypto.createHash('md5').update(Buffer.concat([d2, secret, salt])).digest();
  const key = Buffer.concat([d1, d2]);
  const iv = d3.subarray(0, 16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const envelope = Buffer.concat([Buffer.from('Salted__'), salt, encrypted]);
  return encodeURIComponent(envelope.toString('base64'));
}

/** A failed call to a box. `code` is the box's own error code when it gave one. */
export class NanoKvmHttpError extends Error {
  constructor(message, { status = 0, code = null, path = '', body = '' } = {}) {
    super(message);
    this.name = 'NanoKvmHttpError';
    this.status = status;
    this.code = code;
    this.path = path;
    this.body = body;
  }
}

/**
 * Build the transport options of one call.
 * @param {object} device the device (baseUrl, insecureTls).
 * @param {URL} url the absolute url.
 * @param {object} headers extra headers.
 * @param {number} timeoutMs the socket timeout.
 * @param {Buffer|null} payload the request body.
 * @returns {object} node request options.
 */
function requestOptions(device, url, headers, timeoutMs, payload) {
  const options = {
    method: undefined,
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port === '' ? undefined : Number(url.port),
    path: `${url.pathname}${url.search}`,
    timeout: timeoutMs,
    headers: {
      accept: 'application/json',
      ...(payload === null ? {} : { 'content-type': 'application/json', 'content-length': payload.length }),
      ...headers,
    },
  };
  if (url.protocol === 'https:') options.rejectUnauthorized = device.insecureTls !== true;
  return options;
}

/**
 * One request/response call.
 * @param {object} device the device.
 * @param {{method?: string, path: string, body?: unknown, headers?: Record<string,string>, timeoutMs?: number, signal?: AbortSignal}} spec the call.
 * @returns {Promise<{status: number, headers: object, body: Buffer, text: string, json: any}>} the reply.
 */
export function request(device, spec) {
  const method = spec.method ?? 'GET';
  const url = new URL(spec.path, device.baseUrl);
  const payload =
    spec.body === undefined || spec.body === null
      ? null
      : Buffer.from(typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body));
  const options = { ...requestOptions(device, url, spec.headers ?? {}, spec.timeoutMs ?? 15000, payload), method };
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        const text = body.toString('utf8');
        let json = null;
        try {
          json = text === '' ? null : JSON.parse(text);
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body, text, json });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new NanoKvmHttpError(`no answer within ${options.timeout} ms`, { path: spec.path })));
    req.on('error', (error) => {
      reject(
        error instanceof NanoKvmHttpError
          ? error
          : new NanoKvmHttpError(`${error?.code ?? 'request failed'}: ${error?.message ?? error}`, { path: spec.path }),
      );
    });
    if (spec.signal) {
      if (spec.signal.aborted) {
        req.destroy(new NanoKvmHttpError('aborted', { path: spec.path }));
        return;
      }
      spec.signal.addEventListener('abort', () => req.destroy(new NanoKvmHttpError('aborted', { path: spec.path })), {
        once: true,
      });
    }
    if (payload !== null) req.write(payload);
    req.end();
  });
}

/**
 * Read a streaming response chunk by chunk until `onChunk` says stop.
 * Used for the MJPEG stream, where the frames arrive as a multipart body.
 * @param {object} device the device.
 * @param {{path: string, headers?: Record<string,string>, timeoutMs?: number, signal?: AbortSignal, onChunk: (chunk: Buffer) => boolean}} spec the stream.
 * @returns {Promise<{status: number, headers: object, stopped: boolean}>} how the read ended.
 */
export function stream(device, spec) {
  const url = new URL(spec.path, device.baseUrl);
  const options = {
    ...requestOptions(device, url, spec.headers ?? {}, spec.timeoutMs ?? 15000, null),
    method: 'GET',
  };
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(options, (res) => {
      let stopped = false;
      const finish = () => {
        if (!stopped) return;
        req.destroy();
        resolve({ status: res.statusCode ?? 0, headers: res.headers, stopped: true });
      };
      if ((res.statusCode ?? 0) !== 200) {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          reject(
            new NanoKvmHttpError(`stream refused with HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString('utf8').slice(0, 200)}`, {
              status: res.statusCode ?? 0,
              path: spec.path,
            }),
          ),
        );
        return;
      }
      res.on('data', (chunk) => {
        if (stopped) return;
        try {
          if (spec.onChunk(Buffer.from(chunk))) {
            stopped = true;
            finish();
          }
        } catch (error) {
          stopped = true;
          req.destroy();
          reject(error);
        }
      });
      res.on('end', () => {
        if (stopped) return;
        resolve({ status: res.statusCode ?? 0, headers: res.headers, stopped: false });
      });
      res.on('error', (error) => {
        if (!stopped) reject(error);
      });
    });
    req.on('timeout', () => req.destroy(new NanoKvmHttpError(`stream timed out after ${options.timeout} ms`, { path: spec.path })));
    req.on('error', (error) => {
      if (error instanceof NanoKvmHttpError) reject(error);
      else reject(new NanoKvmHttpError(`${error?.code ?? 'stream failed'}: ${error?.message ?? error}`, { path: spec.path }));
    });
    if (spec.signal) {
      if (spec.signal.aborted) {
        req.destroy(new NanoKvmHttpError('aborted', { path: spec.path }));
        return;
      }
      spec.signal.addEventListener('abort', () => req.destroy(new NanoKvmHttpError('aborted', { path: spec.path })), {
        once: true,
      });
    }
    req.end();
  });
}
