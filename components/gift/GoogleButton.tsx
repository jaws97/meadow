"use client";
// The way into Google sign-in from the garden's own sheets and menus: Google's "Continue with Google" button, drawn as
// its branding asks (the four-colour G on white, a hairline border, Google's words), so it reads as Google's own door,
// with a quiet line under it on what Meadow keeps (lib/server/login-rules.ts: only a scrambled number, never an email,
// a name or a picture) and a link to the privacy page. `compact` is the smaller one offered beside something else (the
// seed, the personal link). Inside another app's built-in browser, where Google signs no one in, it offers the way out
// instead: the same page in Chrome on Android, and on an iPhone the app's own "Open in browser", with the address to
// copy (compact: a line).
import { useState } from "react";
import { copyText } from "@/components/gift/clipboard";
import { chromeIntentUrl, inAppBrowser, signInWithGoogle } from "@/lib/client/session";

/** Google's four-colour G, as its sign-in branding gives it. */
export function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** What Meadow keeps of a Google account, said where the button is. */
export function KeptLine() {
  return (
    <p className="gift-google-kept">
      We keep only a scrambled number from Google, never your email, name or photo.{" "}
      <a href="/privacy" target="_blank" rel="noopener">
        Privacy
      </a>
    </p>
  );
}

export function GoogleButton({ forWhat = "garden", compact = false }: { forWhat?: "garden" | "keep"; compact?: boolean }) {
  // the sheets render only in the browser (the door decides after load), so the browser can be asked at once
  const [inApp] = useState(() => (typeof navigator === "undefined" ? null : inAppBrowser(navigator.userAgent)));
  const [going, setGoing] = useState(false);
  const [copied, setCopied] = useState(false);

  const size = compact ? "compact" : undefined;
  if (inApp === "android" && compact) {
    return (
      <p className="gift-google-kept">
        <a href={chromeIntentUrl(window.location.href)}>Open in Chrome</a> to sign in with Google.
      </p>
    );
  }
  if (inApp === "ios" && compact) {
    return <p className="gift-google-kept">To sign in with Google, open this page in Safari (the app&rsquo;s &middot;&middot;&middot; menu, Open in browser).</p>;
  }
  if (inApp === "android") {
    return (
      <div className="gift-google-wrap">
        <a className="gift-primary" href={chromeIntentUrl(window.location.href)}>
          Open in Chrome to continue
        </a>
        <p className="gift-google-kept">Google signs in only in a browser, not inside this app.</p>
      </div>
    );
  }
  if (inApp === "ios") {
    return (
      <div className="gift-google-wrap">
        <p className="gift-google-away">
          Google signs in only in Safari, not inside this app. Tap the app&rsquo;s <strong>&middot;&middot;&middot;</strong> menu and choose{" "}
          <strong>Open in browser</strong>.
        </p>
        <button
          type="button"
          className="gift-secondary"
          onClick={async () => {
            setCopied(await copyText(window.location.href));
          }}
        >
          {copied ? "Address copied" : "Copy the address instead"}
        </button>
      </div>
    );
  }
  return (
    <div className="gift-google-wrap" data-size={size}>
      <button
        type="button"
        className="gift-google"
        data-size={size}
        disabled={going}
        aria-busy={going || undefined}
        onClick={() => {
          setGoing(true);
          signInWithGoogle(forWhat);
        }}
      >
        <GoogleG />
        {going ? "Opening Google" : "Continue with Google"}
      </button>
      <KeptLine />
    </div>
  );
}
