import { Fragment, type ReactNode } from "react";
import { extractHeadings, uniqueHeadingSlugs } from "../lib/content.mjs";

function safeLink(href: string) {
  return /^(https?:|mailto:|#)/i.test(href) ? href : "#";
}

function inline(text: string): ReactNode[] {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  return text.split(pattern).filter(Boolean).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return <a key={index} href={safeLink(link[2])} target="_blank" rel="noreferrer">{link[1]}</a>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function tableCells(value: string) {
  return value.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

export function Markdown({ source, className = "" }: { source: string; className?: string }) {
  const normalized = source.replace(/\r\n?/g, "\n");
  const visibleSource = normalized.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const lines = visibleSource.split("\n");
  const headingSlugs = uniqueHeadingSlugs(extractHeadings(visibleSource));
  const blocks: ReactNode[] = [];
  let index = 0;
  let headingIndex = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim() || /^---\s*$/.test(line)) { index += 1; continue; }

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) code.push(lines[index++]);
      index += 1;
      blocks.push(<pre key={`code-${index}`}><code data-language={language}>{code.join("\n")}</code></pre>);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const depth = heading[1].length;
      const Heading = `h${depth}` as "h1" | "h2" | "h3" | "h4";
      const id = depth >= 2 && depth <= 3 ? headingSlugs[headingIndex++] : undefined;
      blocks.push(<Heading id={id} key={`heading-${index}`}>{inline(heading[2])}</Heading>);
      index += 1;
      continue;
    }

    if (line.startsWith(">")) {
      const quote = [];
      while (index < lines.length && lines[index].startsWith(">")) quote.push(lines[index++].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={`quote-${index}`}><p>{inline(quote.join(" "))}</p></blockquote>);
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const items: string[] = [];
      const isOrdered = Boolean(ordered);
      const itemPattern = isOrdered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
      while (index < lines.length) {
        const item = lines[index].match(itemPattern);
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      const children = items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>);
      blocks.push(isOrdered ? <ol key={`list-${index}`}>{children}</ol> : <ul key={`list-${index}`}>{children}</ul>);
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && /^\s*\|?\s*:?-+/.test(lines[index + 1])) {
      const headers = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|")) rows.push(tableCells(lines[index++]));
      blocks.push(
        <div className="table-scroll" key={`table-${index}`}><table>
          <thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex}>{inline(cell)}</th>)}</tr></thead>
          <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{inline(cell)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,4})\s|^```|^>|^\s*[-*+]\s+|^\s*\d+[.)]\s+|^---\s*$/.test(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(<p key={`paragraph-${index}`}>{inline(paragraph.join(" "))}</p>);
  }

  return <div className={`markdown-body ${className}`.trim()}>{blocks}</div>;
}
