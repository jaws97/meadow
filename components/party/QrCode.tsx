"use client";
// The QR code, drawn as one SVG path from qrcode-generator's module matrix
// (error correction M: the party link fits a 33-module code, so each module
// is as large as the panel allows, which is what lets a phone read it from a
// few metres away). Plain squares, near-black on warm paper, with the full
// four-module quiet zone the standard asks for: no logo in the middle and no
// rounded dots, because a code that scans first time across a room matters
// more here than ornament. Rows are merged into runs, so the path stays short.
import qrcode from "qrcode-generator";
import { useMemo } from "react";

/** Modules of light margin round the code, as the standard requires. */
const QUIET = 4;
const INK = "#17130e";
const PAPER = "#fbf6ea";

export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value, "Byte");
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (!qr.isDark(r, c)) {
          c++;
          continue;
        }
        let run = 1;
        while (c + run < n && qr.isDark(r, c + run)) run++;
        d += `M${c + QUIET} ${r + QUIET}h${run}v1h-${run}z`;
        c += run;
      }
    }
    return { size: n + QUIET * 2, path: d };
  }, [value]);

  return (
    <svg className={className} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill={PAPER} />
      <path d={path} fill={INK} />
    </svg>
  );
}
