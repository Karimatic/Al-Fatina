import { describe, expect, it } from "vitest";
import { isForeignClientError } from "./client-errors";

const SHOP = "https://al-fatina.karimmaticmz.workers.dev";

describe("browser errors that are not the shop's", () => {
  it("drops crypto-wallet and extension errors", () => {
    expect(isForeignClientError({ message: "Uncaught TypeError: Cannot redefine property: ethereum" }, SHOP)).toBe(true);
    expect(isForeignClientError({ message: "x is undefined", stack: "at chrome-extension://abc/inpage.js:1:2" }, SHOP)).toBe(true);
    expect(isForeignClientError({ message: "boom", filename: "moz-extension://abc/content.js" }, SHOP)).toBe(true);
    expect(isForeignClientError({ message: "boom", filename: "https://other.site/x.js" }, SHOP)).toBe(true);
    expect(isForeignClientError({ message: "Script error." }, SHOP)).toBe(true);
  });

  it("keeps the shop's own errors", () => {
    expect(isForeignClientError({ message: "Cannot read properties of undefined (reading 'price')", stack: `at ${SHOP}/assets/ProductView-x.js:1:2`, filename: `${SHOP}/assets/ProductView-x.js` }, SHOP)).toBe(false);
    expect(isForeignClientError({ message: "boom", stack: "at /assets/x.js:1:2" })).toBe(false);
  });
});
