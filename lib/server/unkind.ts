// Words that may not stand on a garden sign. Planting has been open to everyone since 21 Oct, and every name shows in
// the shared Meadow and on the party's big screen, so the name step turns away the plainly offensive: swear words and
// slurs in English and, as people type them in Latin letters, in Hindi and Urdu, Kannada, Tamil, Telugu and Malayalam.
// A word counts only as a whole word (letters only: accents dropped, digits read as the letters they stand in for, so
// 5h1t is shit), apart from a few roots no name ever holds, which count anywhere in a word, stretched letters and all
// (motherfucker, fuuuck); a name typed letter by letter is read as one word (F U C K). Never parts of words otherwise,
// because real names hide rude ones (Kshitij, Shital, Hancock, Nazia, Pornima), and "Ana L" stays a name. Words that are
// also given names stay off the lists (Anal, Kike, Kutti, Sule, Sunni).
//
// The words are kept in ROT13, so they do not sit in plain text in a public repository: rot13 turns them back, and turns
// a new one into the form the lists keep. Pure, so the tests run without a server.

/** ROT13 on lower-case letters: the lists' own form, both ways. */
export function rot13(s: string): string {
  return s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
}

const decode = (list: string) => list.trim().split(/\s+/).map(rot13);

/** Whole words: English, then Hindi and Urdu, Kannada, Tamil, Telugu and Malayalam. */
const WORDS: ReadonlySet<string> = new Set(
  decode(`
  shpx shpxre shpxref shpxvat shpxrq zbgureshpxre fuvg fuvgf fuvggl ohyyfuvg ovgpu ovgpurf onfgneq onfgneqf phag
  phagf qvpx qvpxf qvpxurnq pbpx pbpxf chffl chffvrf juber juberf fyhg fyhgf nffubyr nffubyrf nefrubyr nff nefr
  jnaxre gjng cevpx cbea cbeab frk frkl cravf intvan obbo obbof gvgf gvggl gvggvrf nahf encr encrq encvfg anmv
  anmvf uvgyre qvyqb phz wvmm ubeal ahqr ahqrf zvys obyybpxf cvff ergneq ergneqrq snttbg snt sntf avttre avttref
  avttn avttnf puvax cnxv fcvp genaal
  puhgvln puhgvlr puhgvn puhg pubbg pubqh pubq znqnepubq znqrepubq orurapubq ourapubq onurapubq orapubq oubfqv
  oubfqvxr oubfnqv oubfqvjnyn oubfqn tnaqh tnnaqh tnaq tnnaq yhaq ynhqn yniqn ynjqn enaqv ennaq unenzv unenzmnqn
  unenzmnqr unenzxube xhgvln xhggvln wungh wunngh wunag wunnag puvany ounqjn ounqjr ounqin
  fhyrzntn fbbyrzntn obyvzntn obyvzntnar ghyyh
  gurivqvln guriqvln gurihqvln bzznyn bbzoh chaqn chaqnv xbbguv cbbyh bgun
  ynawn ynawnxbqnxn qrath qrathgn chxh cbbxh zbqqn
  zler zleh znveh xhaan gunlbyv cbbeh chynlnqv cbbevzbar
`),
);

/** Roots that count anywhere in a word, since no name holds them. */
const ROOTS: readonly string[] = decode(`
  shpx phag avttre avttn puhgvl znqnepubq znqrepubq orurapubq ourapubq onurapubq orapubq oubfq ovgpu juber uvgyre
  qvyqb wvmm snttbg gurivqvln guriqvln gunlbyv ynawnxbqnxn
`);

const DIGIT_LETTERS: Readonly<Record<string, string>> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b" };

/** A name's words, in lower case and letters only: accents dropped, digit stand-ins read as letters. */
function wordsOf(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[0134578]/g, (d) => DIGIT_LETTERS[d])
    .split(/[^\p{L}]+/u)
    .filter((w) => w !== "");
}

/** A word with every run of one letter cut to a single letter (fuuuck: fuck). */
const squeeze = (w: string) => w.replace(/(.)\1+/gu, "$1");

/** Whether a name holds a word that may not stand on a garden sign. */
export function isUnkindName(name: string): boolean {
  const words = wordsOf(name);
  // F U C K: a name typed letter by letter is read as one word too
  if (words.length > 1 && words.every((w) => Array.from(w).length === 1)) words.push(words.join(""));
  return words.some((w) => WORDS.has(w) || ROOTS.some((r) => w.includes(r) || squeeze(w).includes(r)));
}
