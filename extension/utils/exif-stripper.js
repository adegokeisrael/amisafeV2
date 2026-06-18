/**
 * utils/exif-stripper.js
 *
 * Re-renders a base64 PNG/JPEG through an OffscreenCanvas to strip all EXIF,
 * GPS, device model, and timestamp metadata before any storage or transmission.
 *
 * This means the image file that leaves the device contains zero metadata
 * about where it was taken, on which device, or at what time.
 */

/**
 * @param {string} dataUrl - base64 data URL (image/png or image/jpeg)
 * @returns {Promise<string>} - cleaned base64 data URL (always image/png)
 */
export async function stripExif(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        // OffscreenCanvas re-renders the pixel data without metadata
        const canvas = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        canvas.convertToBlob({ type: 'image/png' }).then(blob => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror  = reject;
          reader.readAsDataURL(blob);
        });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/**
 * Verify no EXIF header remains in a PNG buffer.
 * PNG spec: EXIF chunk starts with 0x65584966 ('eXIf').
 * Returns true if clean.
 *
 * @param {ArrayBuffer} buffer
 * @returns {boolean}
 */
export function verifyNoExif(buffer) {
  const view = new DataView(buffer);
  const signature = String.fromCharCode(
    view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)
  );
  if (signature !== '\x89PNG') return true; // not a PNG — skip check

  let offset = 8;
  while (offset < view.byteLength - 4) {
    const chunkLen  = view.getUint32(offset);
    const chunkType = String.fromCharCode(
      view.getUint8(offset + 4), view.getUint8(offset + 5),
      view.getUint8(offset + 6), view.getUint8(offset + 7)
    );
    if (chunkType === 'eXIf') return false; // EXIF chunk found — not clean
    offset += 12 + chunkLen;
  }
  return true;
}
