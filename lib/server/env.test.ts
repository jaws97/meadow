// Which deployment this is, and what it may write: only production saves checkpoints and weather; Vercel without
// VERCEL_ENV is never production; practice (rehearsal) plants come only from a dev server or a Preview and never show in
// production, where every planting is real, before the party too.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  botCheckOn,
  deployment,
  googleSignIn,
  isProduction,
  networkKey,
  partyCodes,
  plantingOpenToAll,
  showRehearsals,
  writesDerivedState,
} from "./env";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("deployment", () => {
  it("follows VERCEL_ENV on Vercel", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(deployment()).toBe("preview");
    expect(writesDerivedState()).toBe(false);
    vi.stubEnv("VERCEL_ENV", "production");
    expect(deployment()).toBe("production");
    expect(writesDerivedState()).toBe(true);
  });

  it("never treats Vercel without VERCEL_ENV as production, even though NODE_ENV is production there", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "");
    expect(deployment()).toBe("preview");
    expect(writesDerivedState()).toBe(false);
    expect(showRehearsals()).toBe(true);
  });

  it("treats next dev and tests as development, and a local production build (no VERCEL) as production", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(deployment()).toBe("development");
    vi.stubEnv("NODE_ENV", "test");
    expect(isProduction()).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect(isProduction()).toBe(true);
  });
});

describe("practice plants", () => {
  it("show on a dev server or a Preview, which plant only those", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(showRehearsals()).toBe(true);
  });

  it("never show in production, whatever the old MEADOW_REHEARSAL switch says", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    for (const flag of ["", "0", "1"]) {
      vi.stubEnv("MEADOW_REHEARSAL", flag);
      expect(showRehearsals()).toBe(false);
    }
  });
});

describe("partyCodes", () => {
  it("reads a comma-separated list, trimmed, so a code can be rotated without a gap", () => {
    vi.stubEnv("MEADOW_PARTY_CODE", "");
    expect(partyCodes()).toEqual([]);
    vi.stubEnv("MEADOW_PARTY_CODE", " Rose-7f3k9q , lantern2x8p ,");
    expect(partyCodes()).toEqual(["Rose-7f3k9q", "lantern2x8p"]);
  });
});

describe("plantingOpenToAll", () => {
  it("lets anyone plant unless MEADOW_PLANTING asks for the party link again", () => {
    vi.stubEnv("MEADOW_PLANTING", "");
    expect(plantingOpenToAll()).toBe(true);
    vi.stubEnv("MEADOW_PLANTING", "open");
    expect(plantingOpenToAll()).toBe(true);
    vi.stubEnv("MEADOW_PLANTING", " Party ");
    expect(plantingOpenToAll()).toBe(false);
  });
});

describe("googleSignIn", () => {
  const client = () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "123-abc.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "s3cret");
  };

  it("is off until the Google client is set, so anyone plants as before", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    expect(googleSignIn()).toBeNull();
    vi.stubEnv("GOOGLE_CLIENT_ID", "123-abc.apps.googleusercontent.com");
    expect(googleSignIn()).toBeNull();
  });

  it("uses a development key of its own on a dev server, so its practice sign-ins never match real ones", () => {
    client();
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("MEADOW_LOGIN_KEY", "");
    expect(googleSignIn()?.key).toMatch(/development/);
  });

  it("is off on a Preview, whose address Google would not send anyone back to", () => {
    client();
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(googleSignIn()).toBeNull();
  });

  it("needs a real key in production, and is off without one", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    client();
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("MEADOW_LOGIN_KEY", "too-short");
    expect(googleSignIn()).toBeNull();
    vi.stubEnv("MEADOW_LOGIN_KEY", "k".repeat(43));
    expect(googleSignIn()).toEqual({ clientId: "123-abc.apps.googleusercontent.com", clientSecret: "s3cret", key: "k".repeat(43) });
  });
});

describe("networkKey and botCheckOn", () => {
  it("scramble networks with MEADOW_LOGIN_KEY, the public development key off production, and nothing in production without one", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("MEADOW_LOGIN_KEY", "short");
    expect(networkKey()).toBeNull();
    vi.stubEnv("MEADOW_LOGIN_KEY", "k".repeat(40));
    expect(networkKey()).toBe("k".repeat(40));
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("MEADOW_LOGIN_KEY", "");
    expect(networkKey()).toMatch(/development/);
  });

  it("keep the bot check on unless MEADOW_BOT_CHECK is off", () => {
    vi.stubEnv("MEADOW_BOT_CHECK", "");
    expect(botCheckOn()).toBe(true);
    vi.stubEnv("MEADOW_BOT_CHECK", " Off ");
    expect(botCheckOn()).toBe(false);
    vi.stubEnv("MEADOW_BOT_CHECK", "on");
    expect(botCheckOn()).toBe(true);
  });
});
