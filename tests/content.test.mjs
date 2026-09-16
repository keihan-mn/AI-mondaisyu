import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateAnswerMarkdown, parseProblemDocument } from "../src/lib/content.mjs";

const sourcePath = new URL("../02-自主勉強課題/01-Git/README.md", import.meta.url);

test("現在のGit教材を4章・12問・12ヒントとして解析する", async () => {
  const markdown = await readFile(sourcePath, "utf8");
  const document = parseProblemDocument("01-Git/README.md", markdown);

  assert.equal(document.title, "Git初心者向け学習問題");
  assert.equal(document.chapters.length, 4);
  assert.equal(document.problemCount, 12);
  assert.equal(document.chapters.flatMap((chapter) => chapter.problems).filter((problem) => problem.hint).length, 12);
  assert.equal(new Set(document.chapters.flatMap((chapter) => chapter.problems).map((problem) => problem.id)).size, 12);
});

test("回答Markdownへ問題文、ヒント、部分回答、未回答を含める", async () => {
  const markdown = await readFile(sourcePath, "utf8");
  const document = parseProblemDocument("01-Git/README.md", markdown);
  const firstProblem = document.chapters[0].problems[0];
  const output = generateAnswerMarkdown(document, { [firstProblem.id]: "**自分の回答**です。" }, new Date("2026-09-16T01:02:03.000Z"));

  assert.match(output, /source: "01-Git\/README\.md"/);
  assert.match(output, /answered: 1/);
  assert.match(output, /Gitとは、何を記録し/);
  assert.match(output, /ヒント/);
  assert.match(output, /\*\*自分の回答\*\*/);
  assert.match(output, /_未回答_/);
  assert.equal((output.match(/#### 回答/g) ?? []).length, 12);
});

test("問題本文更新後も章・問題番号から作るIDは変化しない", async () => {
  const markdown = await readFile(sourcePath, "utf8");
  const before = parseProblemDocument("01-Git/README.md", markdown);
  const after = parseProblemDocument("01-Git/README.md", `${markdown}\n\n追記`);
  assert.deepEqual(
    before.chapters.flatMap((chapter) => chapter.problems).map((problem) => problem.id),
    after.chapters.flatMap((chapter) => chapter.problems).map((problem) => problem.id),
  );
  assert.notEqual(before.signature, after.signature);
});
