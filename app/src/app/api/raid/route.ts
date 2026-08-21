import { withAuth } from "@/lib/auth/middleware";
import { rawFile, storePath } from "@/lib/store";

/**
 * THE CORPO RAID.
 *
 * There is no authorization subtlety here on purpose: any authenticated player
 * can dump this server's entire database, byte for byte. That is the demo. The
 * question a security model has to survive is not "can the attacker be kept
 * out" — it is "what do they get when they are already inside".
 *
 * Here they get base64 and timestamps. The keys are not in this process, not in
 * this file, not in this container, and were never assembled anywhere: they were
 * born as shards across the ORK network and are used blind. There is nothing on
 * this box to steal.
 */
export const GET = withAuth(async () => {
  const raw = rawFile();
  return Response.json({
    path: storePath(),
    bytes: Buffer.byteLength(raw, "utf-8"),
    // Everything. No redaction.
    contents: JSON.parse(raw),
    notes: [
      "This is the complete server-side state of Sanctum-9.",
      "No password hashes: passwords are verified by threshold protocol (PRISM). This server never receives one.",
      "No encryption keys: each `sealed` field was encrypted under a per-call key that was ElGamal-encrypted across the ORK network.",
      "No signing key: dokens are signed by a threshold of ORKs, not by this process. Stealing this file does not let you mint one.",
    ],
  });
});
