// Carrying a garden from the old address to the new one: a device holding a garden at the old address gets a fresh
// personal link to the new address's garden; anything else goes on to the same page at the new address, and no other
// host can make a link here.
import { afterEach, describe, expect, it, vi } from "vitest";
import { OLD_HOST, PUBLIC_ORIGIN } from "@/lib/origin";
import { moveTarget, type MoveDeps } from "./move";

const q = (s: string) => new URLSearchParams(s);
const deps = (personId: string | null, newLink: MoveDeps["newLink"] = async () => "TOKEN123") => {
  const d = { personId: vi.fn(async () => personId), newLink: vi.fn(newLink) };
  return d;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("moveTarget", () => {
  it("carries a garden held at the old address to the new address's garden, link in the fragment", async () => {
    const d = deps("person-1");
    expect(await moveTarget(OLD_HOST, q("to=/garden&code=PARTY"), d)).toEqual({ location: `${PUBLIC_ORIGIN}/garden#k=TOKEN123`, carried: true });
    expect(d.newLink).toHaveBeenCalledWith("person-1");
    expect(await moveTarget(OLD_HOST, q("to=/"), deps("person-1"))).toMatchObject({ location: `${PUBLIC_ORIGIN}/garden#k=TOKEN123`, carried: true });
  });

  it("sends a device without a garden on to the same page at the new address, query kept", async () => {
    expect(await moveTarget(OLD_HOST, q("to=/garden&code=PARTY&dev"), deps(null))).toEqual({
      location: `${PUBLIC_ORIGIN}/garden?code=PARTY&dev=`,
      carried: false,
    });
    expect(await moveTarget(OLD_HOST, q("to=/"), deps(null))).toEqual({ location: `${PUBLIC_ORIGIN}/`, carried: false });
  });

  it("goes on plainly when no link can be made just now (the hourly limit, a busy database)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = deps("person-1", async () => {
      throw Object.assign(new Error("several links this hour"), { code: "too_many_links" });
    });
    expect(await moveTarget(OLD_HOST, q("to=/garden"), d)).toEqual({ location: `${PUBLIC_ORIGIN}/garden`, carried: false });
  });

  it("makes no link on any other host, and only ever sends a device to the garden pages of the new address", async () => {
    const d = deps("person-1");
    expect(await moveTarget(new URL(PUBLIC_ORIGIN).host, q("to=/garden"), d)).toEqual({ location: `${PUBLIC_ORIGIN}/garden`, carried: false });
    expect(await moveTarget(null, q("to=/garden"), d)).toMatchObject({ carried: false });
    expect(d.personId).not.toHaveBeenCalled();
    for (const odd of ["//evil.example", "https://evil.example/", "/party", "/api/seed"]) {
      expect((await moveTarget(OLD_HOST, q(`to=${encodeURIComponent(odd)}`), deps(null))).location).toBe(`${PUBLIC_ORIGIN}/garden`);
    }
  });
});
