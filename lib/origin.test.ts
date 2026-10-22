// The site's address: the old one forwards its pages to the new one, path and all, for anyone without a garden there,
// and carries a device that holds a garden on the old address (its session cookie) across through /api/move.
import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";
import { SESSION_COOKIE } from "@/lib/server/session-rules";
import { MOVE_PAGES, OLD_HOST, PUBLIC_ORIGIN } from "./origin";

const onOldHost = (r: { has?: { type: string; value?: string }[] }) => r.has?.some((h) => h.type === "host" && h.value === OLD_HOST) ?? false;

describe("the old address", () => {
  it("forwards each page to the same page at the new address, for a device that holds no garden there", async () => {
    const rules = await nextConfig.redirects!();
    const forwarded = rules.filter((r) => onOldHost(r) && r.missing?.length);
    expect(forwarded.map((r) => r.source)).toEqual(["/", "/garden", "/meadow", "/meadow/garden", "/party"]);
    for (const r of forwarded) {
      expect(r.destination).toBe(`${PUBLIC_ORIGIN}${r.source}`);
      expect(r.missing).toEqual([{ type: "cookie", key: SESSION_COOKIE }]);
      expect(r.permanent).toBe(true);
    }
    // ahead of the root's own forward to /garden, so the old root goes straight to the new address
    expect(rules.indexOf(forwarded[0])).toBeLessThan(rules.findIndex((r) => r.source === "/" && r.destination === "/garden"));
  });

  it("carries a device that holds a garden there across, from its garden pages, through /api/move", async () => {
    const rules = await nextConfig.redirects!();
    const moves = rules.filter((r) => onOldHost(r) && r.has?.some((h) => h.type === "cookie"));
    expect(moves.map((r) => r.source)).toEqual([...MOVE_PAGES]);
    for (const r of moves) {
      expect(r.has).toContainEqual({ type: "cookie", key: SESSION_COOKIE });
      expect(r.destination).toBe(`/api/move?to=${encodeURIComponent(r.source)}`);
      expect(r.permanent).toBe(false);
    }
    expect(rules.indexOf(moves[0])).toBeLessThan(rules.findIndex((r) => r.source === "/" && r.destination === "/garden"));
  });

  it("the new root is the welcome page, and forwards only a device that holds a garden on to it", async () => {
    const rules = await nextConfig.redirects!();
    const root = rules.filter((r) => r.source === "/" && !onOldHost(r));
    expect(root).toHaveLength(1);
    expect(root[0].has).toEqual([{ type: "cookie", key: SESSION_COOKIE }]);
    expect(root[0].missing).toBeUndefined();
    expect(root[0].destination).toBe("/garden");
    expect(root[0].permanent).toBe(false);
  });

  it("is not the new one, which is served over https", () => {
    expect(new URL(PUBLIC_ORIGIN).protocol).toBe("https:");
    expect(new URL(PUBLIC_ORIGIN).host).not.toBe(OLD_HOST);
  });
});
