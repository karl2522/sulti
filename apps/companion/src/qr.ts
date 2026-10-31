import { createRequire } from "node:module";

// The QR encoder that qrcode-terminal already ships (MIT, Kazuhiko Arase); no extra dependency.
const require = createRequire(import.meta.url);
const QRCode = require("qrcode-terminal/vendor/QRCode/index.js") as new (type: number, level: number) => {
  addData(s: string): void;
  make(): void;
  getModuleCount(): number;
  isDark(r: number, c: number): boolean;
};
const LEVEL_M = 0;

/** A QR code as a crisp SVG (one path), with the standard 4-module quiet zone. */
export function qrSvg(text: string): string {
  const qr = new QRCode(-1, LEVEL_M);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 8} ${n + 8}" shape-rendering="crispEdges" role="img" aria-label="Pairing QR code"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
