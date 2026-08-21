"use client";

import { useEffect, useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import tcConfig from "../../../data/tidecloak.json";
import { CREW_ROLE } from "@/lib/districts";

/**
 * THE FORGE — the one irreducible human step in this whole build.
 *
 * A Forseti policy must carry a VVK signature, and there is no server-side
 * endpoint that can produce one. It comes out of an admin's browser enclave or
 * it does not exist. Doing it here, once, while the realm is still firstAdmin,
 * is the difference between one popup and a full multi-admin ceremony later.
 */

/**
 * secureFetch builds the DPoP proof from `new URL(url).origin`, which throws on
 * a relative path ("Failed to construct 'URL': Invalid URL"). Every call must be
 * absolute. Same-origin either way — this only satisfies the URL parser.
 */
const api = (p: string) => new URL(p, window.location.origin).toString();

type Step = { label: string; state: "idle" | "run" | "ok" | "fail"; detail?: string };

const STEPS: string[] = [
  "hash the contract source (SHA-512, uppercase)",
  "build the policy object",
  "createTideRequest",
  "operator approval (enclave popup)",
  "attach the realm admin policy",
  "executeSignRequest (waitForAll)",
  "attach signature + store",
];

export default function Forge() {
  const { authenticated, isInitializing, hasClientRole, secureFetch, IAMService, forceRefreshToken } =
    useTideCloak();
  const [steps, setSteps] = useState<Step[]>(STEPS.map((label) => ({ label, state: "idle" })));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);

  const isAdmin = hasClientRole("tide-realm-admin", "realm-management");

  useEffect(() => {
    if (!authenticated) return;
    secureFetch(api("/api/vault/policy"))
      .then((r) => setReady(r.ok))
      .catch(() => setReady(false));
  }, [authenticated, secureFetch]);

  const mark = (i: number, state: Step["state"], detail?: string) =>
    setSteps((s) => s.map((x, j) => (j === i ? { ...x, state, detail } : x)));

  async function sign() {
    setBusy(true);
    setSteps(STEPS.map((label) => ({ label, state: "idle" })));
    try {
      // 0 — contract hash
      mark(0, "run");
      const cRes = await secureFetch(api("/api/vault/contract"));
      const { source } = await cRes.json();
      if (!source) throw new Error("could not load CrewVaultContract.cs");
      const digest = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(source));
      const contractId = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
      mark(0, "ok", `${contractId.slice(0, 32)}…`);

      // 1 — policy object. ApprovalType/ExecutionType come from Models, NOT
      //     Models.Policy (that is the class, not a namespace).
      mark(1, "run");
      const { Models } = await import("@tideorg/js");
      const { Policy, ApprovalType, ExecutionType, BaseTideRequest } = Models as any;
      const vendorId = (tcConfig as any).vendorId;
      if (!vendorId) throw new Error("adapter JSON has no vendorId — re-export it");

      const policy = new Policy({
        version: "3",
        contractId,
        // Specific model ids, never "any": these are the ORK request types the
        // policy governs.
        modelId: ["PolicyEnabledEncryption:1", "PolicyEnabledDecryption:1"],
        keyId: vendorId,
        approvalType: ApprovalType.IMPLICIT,
        executionType: ExecutionType.PRIVATE,
        params: new Map([["Role", CREW_ROLE]]),
      });
      mark(1, "ok", `IMPLICIT · PRIVATE · Role=${CREW_ROLE}`);

      // 2 — build + initialise
      mark(2, "run");
      const { PolicySignRequest } = await import("heimdall-tide");
      const req = (PolicySignRequest as any).New(policy);
      req.addForsetiContractToUpload(source);
      req.setCustomExpiry(604800);
      const tc = (IAMService as any)._tc;
      if (!tc) throw new Error("TideCloak not initialised");
      const initialized = BaseTideRequest.decode(await tc.createTideRequest(req.encode()));
      mark(2, "ok");

      // 3 — the popup
      mark(3, "run", "approve in the enclave window");
      const approvals = await tc.requestTideOperatorApproval([
        { id: "crew-vault-policy", request: initialized.encode() },
      ]);
      const a: any = approvals?.[0];
      const approvedBytes = a?.approved?.request ?? a?.request;
      if (!approvedBytes || a?.denied) throw new Error("approval denied or dismissed");
      mark(3, "ok");

      // 4 — attach the realm's admin policy. Skipping this is the classic
      //     "Policy supplied has not been signed" failure.
      mark(4, "run");
      const apRes = await secureFetch(api("/api/admin-policy"));
      const ap = await apRes.json();
      if (!apRes.ok) throw new Error(ap.error ?? "admin policy unavailable");
      const approved = BaseTideRequest.decode(approvedBytes);
      approved.addPolicy(Uint8Array.from(ap.policyBytes));
      mark(4, "ok", `${ap.policyBytes.length} B`);

      // 5 — sign. waitForAll MUST be true.
      mark(5, "run");
      const signatures = await tc.executeSignRequest(approved.encode(), true);
      if (!signatures?.[0]) throw new Error("no signature returned");
      mark(5, "ok");

      // 6 — attach + persist. Order matters: toBytes() before assigning the
      //     signature yields unsigned bytes the ORKs will reject forever.
      mark(6, "run");
      policy.signature = signatures[0];
      const signed = policy.toBytes();
      const store = await secureFetch(api("/api/vault/policy"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyBytes: Array.from(new Uint8Array(signed)) }),
      });
      const sj = await store.json();
      if (!store.ok) throw new Error(sj.error ?? "could not store policy");
      mark(6, "ok", `${sj.bytes} B stored`);
      setDone(true);
      setReady(true);
    } catch (e: any) {
      const i = steps.findIndex((s) => s.state === "run");
      mark(i < 0 ? 0 : i, "fail", e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  if (isInitializing) return <Wrap><p>initialising enclave…</p></Wrap>;
  if (!authenticated) return <Wrap><p>Log in first.</p><a href="/"><button className="nf">TITLE</button></a></Wrap>;

  return (
    <Wrap>
      <h1 style={{ fontSize: 22, color: "var(--amber)", margin: "0 0 6px", letterSpacing: "0.12em" }}>
        THE FORGE
      </h1>
      <p style={{ fontSize: 12, color: "var(--dim)", lineHeight: 1.75, maxWidth: 640 }}>
        Sign the crew-vault Forseti policy. This uploads the contract to the realm and produces the
        VVK signature that lets every ORK enforce it. Do it <strong>now</strong>, while the realm is
        still <code>firstAdmin</code> — after <code>scripts/seat-council.sh</code> flips it to
        multiAdmin, the same signature costs a full quorum ceremony.
      </p>

      {ready === true && !busy && (
        <p style={{ fontSize: 12, color: "var(--green)" }}>
          A signed policy is already stored. Re-signing replaces it.
        </p>
      )}
      {!isAdmin && (
        <div className="panel" style={{ borderColor: "var(--red)", margin: "14px 0" }}>
          <p className="label" style={{ color: "var(--red)" }}>no tide-realm-admin in your doken</p>
          <p style={{ fontSize: 12, margin: "0 0 10px", lineHeight: 1.7 }}>
            Policy signing is an admin ceremony. If <code>scripts/seat-first-admin.sh</code> has
            already run, you almost certainly <em>have</em> the role and your doken predates it —
            role claims are snapshot into the token at issue and only change on refresh, with up to
            120s of propagation. Refresh it, or log out and back in.
          </p>
          <button
            className="nf"
            onClick={async () => {
              await forceRefreshToken();
              location.reload();
            }}
          >
            REFRESH DOKEN
          </button>
        </div>
      )}

      <div style={{ margin: "22px 0" }}>
        {steps.map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 10, padding: "5px 0", fontSize: 12 }}>
            <span style={{
              width: 16, color:
                s.state === "ok" ? "var(--green)" :
                s.state === "fail" ? "var(--red)" :
                s.state === "run" ? "var(--amber)" : "#2f4258",
            }}>
              {s.state === "ok" ? "✓" : s.state === "fail" ? "✕" : s.state === "run" ? "▸" : "·"}
            </span>
            <span style={{ color: s.state === "idle" ? "#4a6280" : "var(--text)" }}>{s.label}</span>
            {s.detail && (
              <span style={{ color: s.state === "fail" ? "var(--red)" : "var(--dim)", fontSize: 11 }}>
                — {s.detail}
              </span>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button className="nf amber" disabled={busy || !isAdmin} onClick={sign}>
          {busy ? "SIGNING…" : "SIGN THE VAULT POLICY"}
        </button>
        <a href="/play"><button className="nf">TO SANCTUM-9</button></a>
      </div>

      {done && (
        <p style={{ fontSize: 12, color: "var(--green)", marginTop: 18 }}>
          Signed and stored. The crew vault terminal at Kaishin Spire is live. Next:{" "}
          <code>bash scripts/seat-council.sh</code>
        </p>
      )}
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ height: "100vh", overflow: "auto", padding: "56px 32px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>{children}</div>
    </main>
  );
}
