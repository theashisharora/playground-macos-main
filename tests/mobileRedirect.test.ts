import assert from "node:assert/strict";
import { test } from "node:test";
import { redirectSmallViewport } from "../src/utils/mobileRedirect.ts";

test("initial viewport routing, session override, and invalid destinations", () => {
  const preferences = new Map<string, string>();
  const navigations: string[] = [];
  const location = {
    origin: "https://macos.example",
    search: "",
    replace: (url: string) => navigations.push(url)
  };
  const viewport = { innerWidth: 390, location };
  Object.assign(globalThis, {
    window: viewport,
    sessionStorage: {
      getItem: (key: string) => preferences.get(key) ?? null,
      setItem: (key: string, value: string) => preferences.set(key, value)
    }
  });
  const classic = "https://classic.example/";
  for (const width of [390, 430, 767, 768, 844, 1280, 1440]) {
    viewport.innerWidth = width;
    assert.equal(redirectSmallViewport(classic, 768), width < 768);
  }
  viewport.innerWidth = 390;
  for (const invalid of [
    "bad URL",
    "javascript:alert(1)",
    "http://classic.example/",
    location.origin
  ]) {
    assert.equal(redirectSmallViewport(invalid, 768), false);
  }
  location.search = "?desktop=1";
  assert.equal(redirectSmallViewport(classic, 768), false);
  location.search = "";
  assert.equal(redirectSmallViewport(classic, 768), false);
  preferences.clear();
  assert.equal(redirectSmallViewport(classic, 768), true);
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    get() {
      throw new Error("Storage blocked");
    }
  });
  location.search = "?desktop=1";
  assert.equal(redirectSmallViewport(classic, 768), false);
  location.search = "";
  assert.equal(redirectSmallViewport(classic, 768), true);
  assert.ok(navigations.every((url) => url === classic));
});
