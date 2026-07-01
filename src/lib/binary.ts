const SCAN_BYTES = 8000;

export function isBinary(buf: Buffer): boolean {
  const head = Math.min(buf.length, SCAN_BYTES);
  for (let i = 0; i < head; i++) {
    if (buf[i] === 0) return true;
  }
  if (buf.length > SCAN_BYTES) {
    for (let i = Math.max(head, buf.length - SCAN_BYTES); i < buf.length; i++) {
      if (buf[i] === 0) return true;
    }
  }
  return false;
}

export function isUtf16Bom(buf: Buffer): boolean {
  return (
    buf.length >= 2 &&
    ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))
  );
}
