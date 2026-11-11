/**
 * A deliberately small WebSocket client.
 *
 * The box authenticates with a cookie and nothing else (server/middleware/jwt.go
 * reads `nano-kvm-token` and only that), while the WHATWG WebSocket in Node has
 * no way to attach a header to the upgrade request. So this file does the two
 * things the HID channel needs — an upgrade with a Cookie header, and binary
 * frames out — and ignores the rest of RFC 6455.
 */
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

const OPCODE = { continuation: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa };

/**
 * Frame one client→server message; client frames are always masked.
 * @param {number} opcode the frame opcode.
 * @param {Buffer} payload the frame body.
 * @returns {Buffer} the bytes to write.
 */
function encodeFrame(opcode, payload) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(length);
  for (let index = 0; index < length; index += 1) masked[index] = payload[index] ^ mask[index % 4];
  return Buffer.concat([header, mask, masked]);
}

/** One open HID channel to a box. */
export class HidSocket {
  /**
   * @param {import('node:net').Socket} socket the upgraded socket.
   * @param {Buffer} head bytes that arrived together with the upgrade reply.
   */
  constructor(socket, head) {
    this.socket = socket;
    this.buffer = Buffer.from(head ?? Buffer.alloc(0));
    this.closed = false;
    this.onclose = null;
    this.onerror = null;
    this.#pump();
    socket.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.#pump();
    });
    socket.on('close', () => this.#close('socket closed'));
    socket.on('error', (error) => {
      this.#close(`socket error: ${error?.message ?? error}`);
      this.onerror?.(error);
    });
  }

  /** @returns {boolean} whether the socket still carries frames. */
  get alive() {
    return !this.closed && this.socket.writable;
  }

  /**
   * Send one binary frame.
   * @param {Buffer} payload the frame body.
   */
  sendBinary(payload) {
    if (!this.alive) throw new Error('the HID socket is closed');
    this.socket.write(encodeFrame(OPCODE.binary, payload));
  }

  /** Close politely: a close frame, then the socket. */
  close() {
    if (this.closed) return;
    try {
      this.socket.write(encodeFrame(OPCODE.close, Buffer.alloc(0)));
    } catch {
      // The socket may already be gone; the destroy below is what matters.
    }
    this.closed = true;
    this.socket.destroy();
  }

  /** @param {string} reason close reason. */
  #close(reason) {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.(reason);
  }

  /** Parse as many complete frames as the buffer holds. */
  #pump() {
    for (;;) {
      if (this.buffer.length < 2) return;
      const first = this.buffer[0];
      const second = this.buffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const maskLength = masked ? 4 : 0;
      if (this.buffer.length < offset + maskLength + length) return;
      const mask = masked ? this.buffer.subarray(offset, offset + 4) : null;
      const start = offset + maskLength;
      const payload = Buffer.from(this.buffer.subarray(start, start + length));
      if (mask) for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      this.buffer = this.buffer.subarray(start + length);
      if (opcode === OPCODE.ping) {
        try {
          this.socket.write(encodeFrame(OPCODE.pong, payload));
        } catch {
          // A ping we cannot answer means the socket is going away.
        }
      } else if (opcode === OPCODE.close) {
        this.#close('closed by the box');
        this.socket.destroy();
        return;
      }
      // text/binary frames from the box are not interesting for HID input.
    }
  }
}

/**
 * Upgrade a plain HTTP request into a WebSocket.
 * @param {string} rawUrl the ws:// or wss:// url.
 * @param {{headers?: Record<string,string>, timeoutMs?: number, insecureTls?: boolean}} options the upgrade.
 * @returns {Promise<HidSocket>} the open channel.
 */
export function connect(rawUrl, options = {}) {
  const url = new URL(rawUrl);
  const secure = url.protocol === 'wss:' || url.protocol === 'https:';
  const key = crypto.randomBytes(16).toString('base64');
  const headers = {
    connection: 'Upgrade',
    upgrade: 'websocket',
    'sec-websocket-key': key,
    'sec-websocket-version': '13',
    ...(options.headers ?? {}),
  };
  const requestOptions = {
    hostname: url.hostname,
    port: url.port === '' ? (secure ? 443 : 80) : Number(url.port),
    path: `${url.pathname}${url.search}`,
    method: 'GET',
    headers,
    timeout: options.timeoutMs ?? 10000,
  };
  if (secure) requestOptions.rejectUnauthorized = options.insecureTls !== true;
  const transport = secure ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(requestOptions);
    req.on('upgrade', (res, socket, head) => {
      if (res.statusCode !== 101) {
        socket.destroy();
        reject(new Error(`the HID channel was refused with HTTP ${res.statusCode ?? 0}`));
        return;
      }
      socket.setTimeout(0);
      resolve(new HidSocket(socket, head));
    });
    req.on('response', (res) => {
      res.resume();
      reject(new Error(`the HID channel answered HTTP ${res.statusCode ?? 0} instead of an upgrade`));
    });
    req.on('timeout', () => req.destroy(new Error(`the HID channel did not open within ${requestOptions.timeout} ms`)));
    req.on('error', (error) => reject(error));
    req.end();
  });
}
