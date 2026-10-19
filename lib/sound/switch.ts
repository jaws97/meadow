// The address's ?sound= switch for the garden's sound button (components/sound/SoundButton, mounted by the garden door,
// components/gift/GardenDoor). The button shows in a colleague's own garden; ?sound=1 shows it in any door, for
// testing a showcase or the gift flow, and ?sound=off never shows it, for a screen recording or a quiet demo. Pure, so
// it is tested in node (switch.test.ts); the hook that reads the address stays with the button.

/** What the address asks of the sound button: "on" shows it in any door (testing), "off" never shows it. */
export type SoundSwitch = "on" | "off" | null;

/** The words that mean on: "" is a bare ?sound. */
const ON_WORDS: readonly string[] = ["", "1", "on", "yes", "true"];
const OFF_WORDS: readonly string[] = ["0", "off", "no", "false"];

/**
 * ?sound=1 (or on, yes, true, or a bare ?sound) is "on"; ?sound=0 (or off, no, false) is "off"; no ?sound, or any
 * other word, is null. Case and surrounding spaces are ignored.
 * @param value the raw query value, as URLSearchParams.get gives it (null when there is no ?sound)
 */
export function parseSoundSwitch(value: string | null): SoundSwitch {
  if (value === null) return null;
  const word = value.trim().toLowerCase();
  if (ON_WORDS.includes(word)) return "on";
  if (OFF_WORDS.includes(word)) return "off";
  return null;
}
