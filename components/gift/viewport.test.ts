// The gift's sheet above a phone's keyboard: laid in the visible part of the page whatever the browser does to the rest.
import { describe, expect, it } from "vitest";
import { keyboardBox } from "./viewport";

describe("the sheet above the keyboard", () => {
  it("leaves the stylesheet alone while no keyboard is up, toolbars moving included", () => {
    expect(keyboardBox(760, { height: 760, offsetTop: 0 })).toBeNull();
    expect(keyboardBox(760, { height: 700, offsetTop: 0 })).toBeNull();
  });

  it("lays the sheet in what is still visible when the keyboard covers the page (an iPhone, the page panned or not)", () => {
    expect(keyboardBox(760, { height: 380, offsetTop: 0 })).toEqual({ top: 0, height: 380 });
    expect(keyboardBox(760, { height: 380, offsetTop: 120.4 })).toEqual({ top: 120, height: 380 });
  });

  it("needs nothing when the browser resized the whole page for the keyboard (Android)", () => {
    expect(keyboardBox(420, { height: 420, offsetTop: 0 })).toBeNull();
  });
});
