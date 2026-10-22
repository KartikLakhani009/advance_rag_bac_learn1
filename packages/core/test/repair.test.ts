import { describe, expect, it } from "vitest";
import { buildVocab, fixThLigature, joinLines, normalizeText, repairText } from "../src/pdf/repair.js";

describe("repair", () => {
  it("fixes the fl ligature and the dropped Th ligature", () => {
    expect(repairText("Te conﬂict in the Middle East")).toBe("The conflict in the Middle East");
    expect(normalizeText("ﬂ ﬁ")).toBe("fl fi");
  });
  it("maps the common damaged words only at word boundaries", () => {
    expect(fixThLigature("Tis reflects a view. Tey said Tere and Tese and Tose, Tus Tird.")).toBe(
      "This reflects a view. They said There and These and Those, Thus Third.",
    );
    expect(fixThLigature("Teheran and Tesla are untouched")).toBe("Teheran and Tesla are untouched");
  });
  it("repairs ambiguous words only in context", () => {
    expect(fixThLigature("Ten the economy slowed.")).toBe("Then the economy slowed.");
    expect(fixThLigature("Ten countries joined.")).toBe("Ten countries joined.");
  });
  it("joins words hyphenated across a line break", () => {
    expect(joinLines(["a sustainabil-", "ity target"])).toBe("a sustainability target");
    expect(repairText("sustainabil- ity")).toBe("sustainability");
  });
  it("keeps the hyphen when the document uses the compound", () => {
    const vocab = buildVocab(["long-term plans and long-term goals"]);
    expect(joinLines(["a long-", "term plan"], vocab)).toBe("a long-term plan");
  });
});
