const normalize = (source) => source.replace(/\r\n?/g, "\n");

function hashText(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function cleanHeading(value) {
  return value.replace(/[*_`]/g, "").trim();
}

function splitHint(source) {
  const lines = source.trim().split("\n");
  const hintIndex = lines.findIndex((line) => /^>\s*\*\*ヒント[：:]\*\*/.test(line.trim()));
  if (hintIndex < 0) return { body: source.trim(), hint: "" };
  return {
    body: lines.slice(0, hintIndex).join("\n").trim(),
    hint: lines.slice(hintIndex).join("\n").trim(),
  };
}

export function stableProblemId(path, chapterNumber, problemNumber) {
  return `question-${hashText(`${path}\u0000${chapterNumber}\u0000${problemNumber}`)}`;
}

export function parseProblemDocument(path, markdown) {
  const source = normalize(markdown).trim();
  const lines = source.split("\n");
  const title = cleanHeading(lines.find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, "") || path.split("/").at(-1)?.replace(/\.md$/i, "") || "教材");
  const headingIndexes = [];
  lines.forEach((line, index) => {
    const match = line.match(/^##\s+(.+)$/);
    if (match) headingIndexes.push({ index, title: cleanHeading(match[1]) });
  });

  const firstSectionIndex = headingIndexes[0]?.index ?? lines.length;
  const introduction = lines
    .slice(1, firstSectionIndex)
    .join("\n")
    .replace(/^---\s*$/gm, "")
    .trim();
  let commonRules = "";
  const chapters = [];

  headingIndexes.forEach((heading, sectionIndex) => {
    const end = headingIndexes[sectionIndex + 1]?.index ?? lines.length;
    const sectionLines = lines.slice(heading.index + 1, end);
    if (/回答.*共通ルール/.test(heading.title)) {
      commonRules = sectionLines.join("\n").trim();
      return;
    }

    const chapterMatch = heading.title.match(/^第(\d+)章[\s　]*(.*)$/);
    const chapterNumber = chapterMatch ? Number(chapterMatch[1]) : chapters.length + 1;
    const chapterTitle = chapterMatch?.[2]?.trim() || heading.title;
    const problemHeadings = [];
    sectionLines.forEach((line, index) => {
      const match = line.match(/^###\s+問題\s*(\d+)[：:]?\s*(.*)$/);
      if (match) problemHeadings.push({ index, number: Number(match[1]), title: cleanHeading(match[2]) });
    });
    if (!problemHeadings.length) return;

    const chapterIntroduction = sectionLines.slice(0, problemHeadings[0].index).join("\n").trim();
    const problems = problemHeadings.map((problem, problemIndex) => {
      const problemEnd = problemHeadings[problemIndex + 1]?.index ?? sectionLines.length;
      const raw = sectionLines.slice(problem.index + 1, problemEnd).join("\n").trim();
      const { body, hint } = splitHint(raw);
      return {
        id: stableProblemId(path, chapterNumber, problem.number),
        number: problem.number,
        title: problem.title || `問題${problem.number}`,
        body,
        hint,
        markdown: raw,
      };
    });

    chapters.push({
      id: `chapter-${hashText(`${path}\u0000${chapterNumber}`)}`,
      number: chapterNumber,
      title: chapterTitle,
      introduction: chapterIntroduction,
      problems,
    });
  });

  return {
    id: `document-${hashText(path)}`,
    path,
    category: path.includes("/") ? path.split("/")[0] : "教材",
    title,
    introduction,
    commonRules,
    signature: hashText(`${path}\u0000${source}`),
    chapters,
    markdown: source,
    problemCount: chapters.reduce((sum, chapter) => sum + chapter.problems.length, 0),
  };
}

function yamlSafe(value) {
  return JSON.stringify(String(value));
}

export function generateAnswerMarkdown(document, answers, createdAt = new Date()) {
  const answerEntries = Object.entries(answers ?? {});
  const answeredCount = answerEntries.filter(([, answer]) => typeof answer === "string" && answer.trim()).length;
  const timestamp = createdAt instanceof Date ? createdAt.toISOString() : new Date(createdAt).toISOString();
  const output = [
    "---",
    `created_at: ${yamlSafe(timestamp)}`,
    `source: ${yamlSafe(document.path)}`,
    `answered: ${answeredCount}`,
    `total: ${document.problemCount}`,
    "---",
    "",
    `# ${document.title} — 回答`,
    "",
    `- 作成日時: ${timestamp}`,
    `- 元問題: \`${document.path}\``,
    `- 回答数: ${answeredCount} / ${document.problemCount}`,
  ];

  for (const chapter of document.chapters) {
    output.push("", `## 第${chapter.number}章　${chapter.title}`);
    if (chapter.introduction) output.push("", chapter.introduction);
    for (const problem of chapter.problems) {
      const answer = typeof answers?.[problem.id] === "string" ? answers[problem.id].trim() : "";
      output.push("", `### 問題${problem.number}：${problem.title}`, "", problem.body || "_問題文なし_", "");
      if (problem.hint) output.push(problem.hint, "");
      output.push("#### 回答", "", answer || "_未回答_", "");
    }
  }

  return `${output.join("\n").trim()}\n`;
}

export function extractHeadings(markdown) {
  const headings = [];
  for (const line of normalize(markdown).split("\n")) {
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    if (match) headings.push({ depth: match[1].length, text: cleanHeading(match[2]) });
  }
  return headings;
}

export function slugify(value) {
  return cleanHeading(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-") || "section";
}

export function uniqueHeadingSlugs(headings) {
  const used = new Map();
  return headings.map((heading) => {
    const base = slugify(heading.text);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  });
}
