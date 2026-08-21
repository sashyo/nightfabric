import type { CSSProperties } from "react";

/** The "Secured by Tide" watermark. It goes only on things Tide actually
 *  protects — the doken, the vault, the council, the scoreboard, the one
 *  tidified district — never on the legacy stack, which is forgeable by design. */
export function TideMark({ label = "SECURED BY TIDE", style }: { label?: string; style?: CSSProperties }) {
  return (
    <div
      title="Verified by a threshold of ORKs — no single key, nothing to forge."
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        fontSize: 8.5, letterSpacing: 1.4, fontWeight: 600,
        color: "var(--cyan)", opacity: 0.85,
        border: "1px solid color-mix(in srgb, var(--cyan) 45%, transparent)",
        borderRadius: 2, padding: "2px 6px",
        background: "color-mix(in srgb, var(--cyan) 8%, transparent)",
        textShadow: "0 0 6px color-mix(in srgb, var(--cyan) 60%, transparent)",
        ...style,
      }}
    >
      <span style={{ fontSize: 10 }}>◈</span>{label}
    </div>
  );
}
