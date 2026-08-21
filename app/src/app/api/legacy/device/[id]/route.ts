import { mintFlag } from "@/lib/legacy";

/**
 * OLD TOWN street devices — each a different textbook flaw, each exploitable by
 * the player. No auth: these are the insecure legacy stack. You have to actually
 * perform the exploit (tamper the price, use default creds, guess the PIN, inject
 * content) — the device only drops a flag when you do.
 */
export const POST = async (req: Request) => {
  const id = decodeURIComponent(new URL(req.url).pathname.split("/").pop() || "");
  const b = (await req.json().catch(() => ({}))) as any;

  switch (id) {
    case "vend-01": {
      // Price is whatever the client sends. Set it to zero or negative → free.
      const price = Number(b.price);
      if (Number.isFinite(price) && price <= 0) {
        return Response.json({
          ok: true, flag: mintFlag("FLAG-PRICE-TAMPER"),
          result: `Dispensed a Neon-Cola for ${price} eddies. The machine trusted your price.`,
        });
      }
      return Response.json({ ok: false, hint: "The price field comes from you. What if it were 0, or less?" });
    }
    case "cam-01": {
      // Default credentials.
      if (String(b.user) === "admin" && String(b.pass) === "admin") {
        return Response.json({
          ok: true, flag: mintFlag("FLAG-DEFAULT-CREDS"),
          result: "CCTV admin panel unlocked. 6 cameras, full pan-tilt. Nobody changed the shipped password.",
        });
      }
      return Response.json({ ok: false, hint: "It's an off-the-shelf camera. What credentials does it ship with?" });
    }
    case "door-01": {
      // Weak PIN, no lockout.
      if (String(b.pin) === "0000") {
        return Response.json({
          ok: true, flag: mintFlag("FLAG-WEAK-PIN"),
          result: "Service door unlocked. PIN 0000, no lockout, no log.",
        });
      }
      return Response.json({ ok: false, hint: "Four digits, no lockout. Try the laziest possible code." });
    }
    case "ad-01": {
      // Unsanitized content injection.
      const content = String(b.content ?? "").slice(0, 80);
      if (content.trim()) {
        return Response.json({
          ok: true, flag: mintFlag("FLAG-CONTENT-INJECT"),
          rendered: content,
          result: `The billboard is now showing: "${content}". It rendered exactly what you sent, no questions asked.`,
        });
      }
      return Response.json({ ok: false, hint: "The sign renders whatever you submit. Put anything on it." });
    }
    default:
      return Response.json({ error: "no such device" }, { status: 404 });
  }
};
