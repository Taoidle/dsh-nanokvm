/**
 * Just enough JPEG to answer "how big is this frame" without a decoder.
 *
 * The MJPEG stream carries whole JPEG images; a screenshot tool wants the
 * dimensions for its text summary and the pointer math needs them too.
 */

/**
 * Read the frame dimensions from the first Start-Of-Frame marker.
 * @param {Buffer} jpeg the image bytes.
 * @returns {{width: number, height: number}|null} the dimensions, or null when the marker is absent.
 */
export function jpegSize(jpeg) {
  if (!Buffer.isBuffer(jpeg) || jpeg.length < 4) return null;
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < jpeg.length) {
    if (jpeg[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = jpeg[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = jpeg.readUInt16BE(offset + 2);
    if (length < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (offset + 9 > jpeg.length) return null;
      return { height: jpeg.readUInt16BE(offset + 5), width: jpeg.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * Find the first complete JPEG image in a byte run.
 * @param {Buffer} buffer the accumulated bytes.
 * @returns {{jpeg: Buffer, rest: Buffer}|null} the frame and the bytes after it.
 */
export function takeJpeg(buffer) {
  const start = buffer.indexOf(Buffer.from([0xff, 0xd8]));
  if (start < 0) return null;
  const end = buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
  if (end < 0) return null;
  return { jpeg: buffer.subarray(start, end + 2), rest: buffer.subarray(end + 2) };
}
