import { test } from "node:test";
import assert from "node:assert/strict";
import { unwrapCollectorRows } from "./unwrap.ts";

test("flattens Scraper Studio listing envelopes (one nested item per row)", () => {
  const rows = unwrapCollectorRows([
    { items: [{ itemId: "1", title: "A" }], product_page_url: "https://news.ycombinator.com/item?id=1", input: { url: "https://news.ycombinator.com/" } },
    { items: [{ itemId: "2", title: "B" }], product_page_url: "https://news.ycombinator.com/item?id=2", input: { url: "https://news.ycombinator.com/" } },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { itemId: "1", title: "A" });
  assert.deepEqual(rows[1], { itemId: "2", title: "B" });
});

test("flattens a single envelope with many items", () => {
  const rows = unwrapCollectorRows([
    { repositories: [{ repo: "a/b" }, { repo: "c/d" }], product_page_url: "https://github.com/trending" },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.["repo"], "a/b");
});

test("already-flat rows pass through", () => {
  const src = [{ title: "A", points: 10 }, { title: "B", points: 3 }];
  assert.deepEqual(unwrapCollectorRows(src), src);
});

test("empty nested arrays do not invent rows", () => {
  const rows = unwrapCollectorRows([
    { repositories: [], product_page_url: "https://github.com/obra/superpowers" },
  ]);
  assert.equal(rows.length, 0);
});
