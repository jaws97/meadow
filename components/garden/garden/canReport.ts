// The latest watering-can press as this page played it (canLive writes it as it latches a press), for the development
// panel: how soon after the tap the garden first saw the press, and why its can stayed where it stands, if it did. On a
// phone opened with ?dev, one press on the care card says whether the can flew. Kept apart from canLive so the panel,
// which loads with the page, does not pull the garden's 3D code in with it.

export const canReport = {
  /** how long after the tap the garden first saw the press (s), -1 before the first press */
  seenAfter: -1,
  /** why the can stayed where it stands and only the soil answered, "" when it flew */
  stayed: "",
};

/** The latest press in a few words for the panel, "" before the first. */
export function canReportText(): string {
  if (canReport.seenAfter < 0) return "";
  const seen = `seen ${canReport.seenAfter.toFixed(2)} s after the press`;
  return canReport.stayed ? `Last can stayed home: ${canReport.stayed} (${seen})` : `Last can flew (${seen})`;
}
