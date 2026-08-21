"use client";

import { TideCloakProvider } from "@tidecloak/nextjs";
import tcConfig from "../../data/tidecloak.json";

/**
 * The adapter JSON carries the realm's PUBLIC verification key (`jwk`), the
 * vendor id and the home ORK URL. It is not a secret and it is not a
 * credential — but it is deployment-specific, and the `jwk` only appears when
 * IGA is enabled on the realm. If login works and server-side verification
 * fails, check that first.
 *
 * DPoP binds the access token to a key pair held in this browser, so a stolen
 * token is not a usable token. `useDPoP` goes inside the config object.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TideCloakProvider
      config={{ ...tcConfig, useDPoP: { mode: "strict", alg: "ES256" } }}
    >
      {children}
    </TideCloakProvider>
  );
}
