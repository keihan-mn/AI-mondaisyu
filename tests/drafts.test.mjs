import test from "node:test";
import assert from "node:assert/strict";
import { createDraftEnvelope, parseDraft, reconcileDraft } from "../src/lib/drafts.mjs";

test("下書きを保存・復元できる", () => {
  const envelope = createDraftEnvelope("signature-a", { q1: "回答" }, new Date("2026-09-16T00:00:00Z"));
  const parsed = parseDraft(JSON.stringify(envelope));
  assert.deepEqual(parsed.answers, { q1: "回答" });
  assert.equal(reconcileDraft(parsed, "signature-a").sourceChanged, false);
});

test("問題の署名が変わっても下書きを保持し更新を通知する", () => {
  const draft = createDraftEnvelope("old-signature", { q1: "消してはいけない回答" });
  const restored = reconcileDraft(draft, "new-signature");
  assert.deepEqual(restored.answers, { q1: "消してはいけない回答" });
  assert.equal(restored.sourceChanged, true);
});

test("壊れた下書きは安全に無視する", () => {
  assert.equal(parseDraft("not-json"), null);
  assert.equal(parseDraft('{"version":2}'), null);
});
