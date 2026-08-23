import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createLensDisplacementMap } from "./liquid-glass.ts";

test("the lens map keeps pixels outside the rounded glass neutral", () => {
  const map = createLensDisplacementMap({ width: 64, height: 40, radius: 16, depth: 9 });

  assert.deepEqual(Array.from(map.pixels.slice(0, 4)), [128, 128, 128, 0]);
  assert.equal(map.width, 64);
  assert.equal(map.height, 40);
});

test("the lens map bends opposing edges symmetrically", () => {
  const map = createLensDisplacementMap({ width: 65, height: 41, radius: 16, depth: 9 });
  const pixel = (x: number, y: number) => {
    const offset = (y * map.width + x) * 4;
    return Array.from(map.pixels.slice(offset, offset + 4));
  };

  const left = pixel(1, 20);
  const right = pixel(63, 20);
  const top = pixel(32, 1);
  const bottom = pixel(32, 39);

  assert.ok(left[0]! < 128);
  assert.ok(right[0]! > 128);
  assert.ok(Math.abs(left[0]! + right[0]! - 256) <= 1);
  assert.ok(top[1]! < 128);
  assert.ok(bottom[1]! > 128);
  assert.ok(Math.abs(top[1]! + bottom[1]! - 256) <= 1);
});

test("the reusable lens follows the Aave displacement-map architecture", () => {
  const component = readFileSync(new URL("../../app/liquid-glass.tsx", import.meta.url), "utf8");

  assert.match(component, /ResizeObserver/);
  assert.match(component, /feDisplacementMap/);
  assert.match(component, /xChannelSelector="R"/);
  assert.match(component, /yChannelSelector="G"/);
  assert.match(component, /filterVersion/);
  assert.match(component, /toDataURL\("image\/png"\)/);
});

test("hydration cannot wash dark glass gray with a full-surface SVG light pass", () => {
  const component = readFileSync(new URL("../../app/liquid-glass.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(component, /feSpecularLighting/);
  assert.doesNotMatch(component, /feMergeNode in="specularRim"/);
});

test("button glass uses a neutral edge without a white highlight streak", () => {
  const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const rim = styles.match(/\.liquid-glass__rim\s*{([^}]*)}/)?.[1] ?? "";

  assert.match(rim, /border:\s*1px solid rgb\(var\(--text-primary-rgb\)/);
  assert.doesNotMatch(rim, /border:[^;]+--surface-rgb/);
  assert.doesNotMatch(rim, /inset 0 1px 0 rgb\(var\(--surface-rgb\)/);
  assert.doesNotMatch(styles, /\.liquid-glass__rim::after/);
});

test("dark glass has an edge-to-edge base beneath displaced refraction", () => {
  const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const darkGlass = styles.match(/\.liquid-glass\[data-tone="dark"\]\s*{([^}]*)}/)?.[1] ?? "";

  assert.match(darkGlass, /background:\s*var\(--text-primary\)/);
  assert.match(styles, /\.liquid-glass\s*{[^}]*overflow:\s*hidden/);
  assert.match(styles, /\.liquid-glass\[data-tone="dark"\] \.liquid-glass__refraction/);
});
