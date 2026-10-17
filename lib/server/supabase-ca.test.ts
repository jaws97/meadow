// The pinned database CA: the app's copy and the scripts' copy are the same certificate, it is the Supabase root the
// review checked (by fingerprint), and it stays valid well past the season.
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUPABASE_ROOT_CA } from "./supabase-ca";

const FINGERPRINT = "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA";

describe("SUPABASE_ROOT_CA", () => {
  it("is the same certificate the scripts use", () => {
    const file = readFileSync(new URL("../../db/supabase-root-2021-ca.crt", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(SUPABASE_ROOT_CA).toBe(file);
  });

  it("is Supabase's self-signed root, valid until 2031", () => {
    const cert = new X509Certificate(SUPABASE_ROOT_CA);
    expect(cert.fingerprint256).toBe(FINGERPRINT);
    expect(cert.subject).toContain("CN=Supabase Root 2021 CA");
    expect(cert.issuer).toBe(cert.subject);
    expect(cert.ca).toBe(true);
    expect(new Date(cert.validTo).getTime()).toBeGreaterThan(Date.UTC(2027, 0, 1));
  });
});
