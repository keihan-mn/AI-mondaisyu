import { constants } from "node:fs";
import { mkdir, open, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateAnswerMarkdown, parseProblemDocument } from "../src/lib/content.mjs";

export const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_ANSWER_CHARS = 120_000;
const MAX_ANSWER_FIELDS = 500;

export class ContentError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ContentError";
    this.code = code;
    this.status = status;
  }
}

async function listMarkdownFiles(root) {
  const output = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) output.push(fullPath);
    }
  }
  await walk(root);
  return output.sort((left, right) => left.localeCompare(right, "ja"));
}

export async function loadProblems(projectRoot) {
  const problemsRoot = path.join(projectRoot, "02-自主勉強課題");
  const files = await listMarkdownFiles(problemsRoot);
  const documents = [];
  for (const file of files) {
    const markdown = await readFile(file, "utf8");
    const relativePath = path.relative(problemsRoot, file).split(path.sep).join("/");
    const document = parseProblemDocument(relativePath, markdown);
    if (document.problemCount > 0) documents.push(document);
  }
  return documents;
}

function answerTitle(markdown, fallback) {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}

function answerSource(markdown) {
  const yaml = markdown.match(/^---\n([\s\S]*?)\n---/);
  const source = yaml?.[1]?.match(/^source:\s*(.+)$/m)?.[1];
  if (!source) return "";
  try { return JSON.parse(source); } catch { return source.replace(/^['"]|['"]$/g, ""); }
}

export async function loadAnswers(projectRoot) {
  const answersRoot = path.join(projectRoot, "answers");
  const files = await listMarkdownFiles(answersRoot);
  const answers = [];
  for (const file of files) {
    const [markdown, fileStat] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    const relativePath = path.relative(answersRoot, file).split(path.sep).join("/");
    answers.push({
      id: `answer-${Buffer.from(relativePath).toString("base64url")}`,
      path: relativePath,
      title: answerTitle(markdown, path.basename(file, ".md")),
      sourcePath: answerSource(markdown),
      savedAt: fileStat.mtime.toISOString(),
      markdown,
    });
  }
  return answers.sort((left, right) => right.savedAt.localeCompare(left.savedAt));
}

export async function loadContent(projectRoot) {
  const [problems, answers] = await Promise.all([loadProblems(projectRoot), loadAnswers(projectRoot)]);
  return { problems, answers };
}

export function validateAnswers(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ContentError("INVALID_ANSWERS", "回答データの形式が正しくありません。");
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_ANSWER_FIELDS) {
    throw new ContentError("TOO_MANY_ANSWERS", "回答項目が多すぎます。", 413);
  }
  const answers = {};
  for (const [key, answer] of entries) {
    if (typeof key !== "string" || typeof answer !== "string") {
      throw new ContentError("INVALID_ANSWER", "回答は文字列で指定してください。");
    }
    if (answer.length > MAX_ANSWER_CHARS) {
      throw new ContentError("ANSWER_TOO_LARGE", "1問あたりの回答が大きすぎます。", 413);
    }
    answers[key] = answer;
  }
  return answers;
}

function safeName(value, fallback = "教材") {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

export async function saveAnswers({ projectRoot, problemPath, answers, now = new Date() }) {
  if (typeof problemPath !== "string" || !problemPath || problemPath.includes("\\") || problemPath.startsWith("/") || problemPath.split("/").includes("..")) {
    throw new ContentError("INVALID_PATH", "問題ファイルの指定が正しくありません。");
  }
  const documents = await loadProblems(projectRoot);
  const document = documents.find((candidate) => candidate.path === problemPath);
  if (!document) throw new ContentError("PROBLEM_NOT_FOUND", "指定された問題ファイルは存在しません。", 404);
  const validatedAnswers = validateAnswers(answers);
  const allowedIds = new Set(document.chapters.flatMap((chapter) => chapter.problems.map((problem) => problem.id)));
  for (const answerId of Object.keys(validatedAnswers)) {
    if (!allowedIds.has(answerId)) throw new ContentError("UNKNOWN_QUESTION", "教材に存在しない問題の回答が含まれています。");
  }

  const folderName = safeName(document.category);
  const materialName = safeName(document.title);
  const answersRoot = path.join(projectRoot, "answers");
  const answerDirectory = path.join(answersRoot, folderName);
  await mkdir(answerDirectory, { recursive: true });
  const markdown = generateAnswerMarkdown(document, validatedAnswers, now);

  // 以前の日時付きファイルも含め、同じ教材の最新回答を引き継いで更新する。
  const existingAnswer = (await loadAnswers(projectRoot))
    .find((answer) => answer.sourcePath === document.path);
  if (existingAnswer) {
    const fullPath = path.join(answersRoot, ...existingAnswer.path.split("/"));
    await writeFile(fullPath, markdown, { encoding: "utf8", mode: 0o600 });
    return {
      created: false,
      answer: {
        ...existingAnswer,
        title: `${document.title} — 回答`,
        savedAt: now.toISOString(),
        markdown,
      },
    };
  }

  const baseName = `${materialName}-answer`;
  for (let sequence = 0; sequence < 10_000; sequence += 1) {
    const suffix = sequence === 0 ? "" : `-${String(sequence + 1).padStart(2, "0")}`;
    const fileName = `${baseName}${suffix}.md`;
    const fullPath = path.join(answerDirectory, fileName);
    let handle;
    try {
      handle = await open(fullPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      await handle.writeFile(markdown, "utf8");
      await handle.close();
      const relativePath = path.relative(answersRoot, fullPath).split(path.sep).join("/");
      return {
        created: true,
        answer: {
          id: `answer-${Buffer.from(relativePath).toString("base64url")}`,
          path: relativePath,
          title: `${document.title} — 回答`,
          sourcePath: document.path,
          savedAt: now.toISOString(),
          markdown,
        },
      };
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error?.code === "EEXIST") {
        const existingMarkdown = await readFile(fullPath, "utf8");
        if (answerSource(existingMarkdown) === document.path) {
          await writeFile(fullPath, markdown, { encoding: "utf8", mode: 0o600 });
          const relativePath = path.relative(answersRoot, fullPath).split(path.sep).join("/");
          return {
            created: false,
            answer: {
              id: `answer-${Buffer.from(relativePath).toString("base64url")}`,
              path: relativePath,
              title: `${document.title} — 回答`,
              sourcePath: document.path,
              savedAt: now.toISOString(),
              markdown,
            },
          };
        }
        continue;
      }
      throw error;
    }
  }
  throw new ContentError("NAME_EXHAUSTED", "回答ファイル名を確保できませんでした。", 500);
}
