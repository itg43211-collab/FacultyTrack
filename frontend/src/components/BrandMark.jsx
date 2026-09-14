import React from "react";

// شكل هندسي مستوحى من علامة "الشبك المتقاطع" في شعار الجامعة
export default function BrandMark({ size = 30 }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size}>
      <g stroke="#1FA19A" strokeWidth="9" strokeLinecap="round" fill="none">
        <line x1="15" y1="15" x2="85" y2="85" />
        <line x1="85" y1="15" x2="15" y2="85" />
        <line x1="50" y1="6" x2="50" y2="94" opacity="0.55" />
        <line x1="6" y1="50" x2="94" y2="50" opacity="0.55" />
      </g>
      <rect x="42" y="42" width="16" height="16" fill="#13133D" />
    </svg>
  );
}
