import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApiHandler } from "../scripts/local-api.mjs";

const fixtureMarkdown = `# テスト教材

説明です。

## 回答するときの共通ルール

自分の言葉で答える。

## 第1章　基本

### 問題1：最初の問い

問題本文です。

> **ヒント：**「検索語」で調べてください。

### 問題2：次の問い

もう一つの問題です。

> **ヒント：**「別の検索語」で調べてください。
`;

async function fixture() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ai-mondaisyu-test-"));
  const problemDirectory = path.join(projectRoot, "02-自主勉強課題", "01-Test");
  await mkdir(problemDirectory, { recursive: true });
  await writeFile(path.join(problemDirectory, "README.md"), fixtureMarkdown, "utf8");
  return projectRoot;
}

async function serve(projectRoot, now = () => new Date("2026-09-16T01:02:03Z")) {
  const handler = createApiHandler({ projectRoot, now });
  const server = http.createServer((request, response) => handler(request, response, () => {
    response.statusCode = 404;
    response.end("not found");
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("回答を排他的に別ファイルへ保存し、一覧へ反映する", async () => {
  const projectRoot = await fixture();
  const app = await serve(projectRoot);
  try {
    const content = await fetch(`${app.origin}/api/content`).then((response) => response.json());
    const document = content.problems[0];
    const firstQuestion = document.chapters[0].problems[0];
    const payload = { problemPath: document.path, answers: { [firstQuestion.id]: "回答です" } };
    const first = await fetch(`${app.origin}/api/answers`, { method: "POST", headers: { "Content-Type": "application/json", Origin: app.origin }, body: JSON.stringify(payload) });
    const second = await fetch(`${app.origin}/api/answers`, { method: "POST", headers: { "Content-Type": "application/json", Origin: app.origin }, body: JSON.stringify(payload) });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const firstBody = await first.json();
    const secondBody = await second.json();
    assert.notEqual(firstBody.answer.path, secondBody.answer.path);
    const updated = await fetch(`${app.origin}/api/content`).then((response) => response.json());
    assert.equal(updated.answers.length, 2);
  } finally {
    await app.close();
  }
});

test("不正パス、存在しない問題、別オリジン、不正JSON、過大要求を拒否する", async () => {
  const projectRoot = await fixture();
  const app = await serve(projectRoot);
  const post = (body, headers = {}) => fetch(`${app.origin}/api/answers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: app.origin, ...headers },
    body,
  });
  try {
    assert.equal((await post(JSON.stringify({ problemPath: "../秘密.md", answers: {} }))).status, 400);
    assert.equal((await post(JSON.stringify({ problemPath: "01-Test/なし.md", answers: {} }))).status, 404);
    assert.equal((await post(JSON.stringify({ problemPath: "01-Test/README.md", answers: {} }), { Origin: "https://evil.example" })).status, 403);
    assert.equal((await post(JSON.stringify({ problemPath: "01-Test/README.md", answers: {} }), { Origin: app.origin.replace("http:", "https:") })).status, 403);
    assert.equal((await post("{invalid-json")).status, 400);
    assert.equal((await post(JSON.stringify({ problemPath: "01-Test/README.md", answers: { q: "x".repeat(1024 * 1024) } }))).status, 413);
    assert.equal((await fetch(`${app.origin}/api/answers`, { method: "POST", headers: { "Content-Type": "text/plain", Origin: app.origin }, body: "text" })).status, 415);
  } finally {
    await app.close();
  }
});
