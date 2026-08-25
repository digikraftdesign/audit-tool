'use client';

import { useEffect } from 'react';

export default function PrintControls({ autoPrint }: { autoPrint: boolean }) {
  useEffect(() => {
    if (!autoPrint) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [autoPrint]);

  return (
    <div className="toolbar">
      <button className="btn" type="button" onClick={() => window.print()}>
        Print / Save as PDF
      </button>
    </div>
  );
}
