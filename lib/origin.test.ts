// The site's address: the old one forwards its pages to the new one, path and all, for anyone without a garden there,
// and a device holding a garden on the old address (its session cookie) stays where its garden is.
import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";
import { SESSION_COOKIE } from "@/lib/server/session-rules";
import { OLD_HOST, PUBLIC_ORIGIN } from "./origin";

describe("the old address", () => {
  it("forwards each page to the same page at the new address, but not for a device that holds a garden there", async () => {
    const rules = await nextConfig.redirects!();
    const forwarded = rules.filter((r) => r.has?.some((h) => h.type === "host" && h.value === OLD_HOST));
    expect(forwarded.map((r) => r.source)).toEqual(["/", "/garden", "/meadow", "/meadow/garden", "/party"]);
    for (const r of forwarded) {
      expect(r.destination).toBe(`${PUBLIC_ORIGIN}${r.source}`);
      expect(r.missing).toEqual([{ type: "cookie", key: SESSION_COOKIE }]);
      expect(r.permanent).toBe(true);
    }
    // ahead of the root's own forward to /garden, so the old root goes straight to the new address
    expect(rules.indexOf(forwarded[0])).toBeLessThan(rules.findIndex((r) => r.source === "/" && r.destination === "/garden"));
  });

  it("is not the new one, which is served over https", () => {
    expect(new URL(PUBLIC_ORIGIN).protocol).toBe("https:");
    expect(new URL(PUBLIC_ORIGIN).host).not.toBe(OLD_HOST);
  });
});
