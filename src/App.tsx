import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "./components/Markdown";
import { createDraftEnvelope, draftStorageKey, parseDraft, reconcileDraft } from "./lib/drafts.mjs";
import { extractHeadings, generateAnswerMarkdown, uniqueHeadingSlugs } from "./lib/content.mjs";

type Problem = { id: string; number: number; title: string; body: string; hint: string; markdown: string };
type Chapter = { id: string; number: number; title: string; introduction: string; problems: Problem[] };
type ProblemDocument = {
  id: string; path: string; category: string; title: string; introduction: string; commonRules: string;
  signature: string; chapters: Chapter[]; markdown: string; problemCount: number;
};
type SavedAnswer = { id: string; path: string; title: string; sourcePath: string; savedAt: string; markdown: string };
type Content = { problems: ProblemDocument[]; answers: SavedAnswer[] };
type DraftState = { answers: Record<string, string>; baseSignature: string; sourceChanged: boolean };

const EMPTY_CONTENT: Content = { problems: [], answers: [] };

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function countAnswered(answers: Record<string, string>) {
  return Object.values(answers).filter((answer) => answer.trim()).length;
}

function loadDraftState(document: ProblemDocument): DraftState {
  const parsed = parseDraft(localStorage.getItem(draftStorageKey(document.path)) ?? "");
  const restored = reconcileDraft(parsed, document.signature);
  return {
    answers: restored.answers,
    baseSignature: parsed?.signature ?? document.signature,
    sourceChanged: restored.sourceChanged,
  };
}

function fileNameForDownload(document: ProblemDocument) {
  const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" }).replace(/[-:]/g, "").replace(" ", "-");
  const title = document.title.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-");
  return `${title}-answer-${stamp}.md`;
}

function ModeTabs({ mode, onChange }: { mode: "problems" | "answers"; onChange: (mode: "problems" | "answers") => void }) {
  return <div className="mode-tabs" role="tablist" aria-label="表示モード">
    <button type="button" role="tab" aria-selected={mode === "problems"} className={mode === "problems" ? "active" : ""} onClick={() => onChange("problems")}>問題</button>
    <button type="button" role="tab" aria-selected={mode === "answers"} className={mode === "answers" ? "active" : ""} onClick={() => onChange("answers")}>回答</button>
  </div>;
}

function QuestionCard({ problem, answer, onChange }: { problem: Problem; answer: string; onChange: (value: string) => void }) {
  const [tab, setTab] = useState<"input" | "preview">("input");
  const answered = Boolean(answer.trim());
  return <article className="question-card" id={problem.id}>
    <header className="question-header">
      <div><span className="question-number">問題 {String(problem.number).padStart(2, "0")}</span><h3>{problem.title}</h3></div>
      <span className={`answer-status ${answered ? "complete" : ""}`}><span aria-hidden="true">{answered ? "●" : "○"}</span>{answered ? "回答済み" : "未回答"}</span>
    </header>
    <Markdown source={problem.body} className="question-copy" />
    {problem.hint && <Markdown source={problem.hint} className="question-hint" />}
    <div className="answer-editor">
      <div className="answer-toolbar">
        <span className="answer-label">あなたの回答</span>
        <div className="answer-tabs">
          <button type="button" className={tab === "input" ? "active" : ""} onClick={() => setTab("input")}>入力</button>
          <button type="button" className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}>プレビュー</button>
        </div>
      </div>
      {tab === "input" ? (
        <textarea value={answer} onChange={(event) => onChange(event.target.value)} placeholder="Markdownで回答を入力してください。下書きはこのブラウザへ自動保存されます。" rows={8} aria-label={`${problem.title}の回答`} />
      ) : answer.trim() ? <Markdown source={answer} className="answer-preview" /> : <div className="preview-empty">まだ回答が入力されていません。</div>}
    </div>
  </article>;
}

function Sidebar({ content, mode, onModeChange, selectedProblemId, selectedAnswerId, onSelectProblem, onSelectAnswer, query, onQuery, open, onClose }: {
  content: Content; mode: "problems" | "answers"; onModeChange: (mode: "problems" | "answers") => void;
  selectedProblemId: string; selectedAnswerId: string; onSelectProblem: (id: string) => void; onSelectAnswer: (id: string) => void;
  query: string; onQuery: (value: string) => void; open: boolean; onClose: () => void;
}) {
  const needle = query.trim().toLocaleLowerCase("ja");
  const problems = content.problems.filter((document) => !needle || `${document.title} ${document.path} ${document.markdown}`.toLocaleLowerCase("ja").includes(needle));
  const answers = content.answers.filter((answer) => !needle || `${answer.title} ${answer.path} ${answer.markdown}`.toLocaleLowerCase("ja").includes(needle));
  const groups = [...new Set(problems.map((document) => document.category))];
  return <>
    <aside className={`course-sidebar ${open ? "open" : ""}`}>
      <button type="button" className="sidebar-close" onClick={onClose} aria-label="メニューを閉じる">×</button>
      <div className="brand-mark"><span className="brand-glyph">問</span><div><span className="brand-name">SELF STUDY</span><strong>自習問題ビューアー</strong></div></div>
      <ModeTabs mode={mode} onChange={onModeChange} />
      <label className="sidebar-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={mode === "problems" ? "問題を検索" : "回答を検索"} /></label>
      {mode === "problems" ? <nav aria-label="教材一覧">
        {groups.map((group) => <section className="nav-group" key={group}>
          <p className="nav-label">{group}</p>
          {problems.filter((document) => document.category === group).map((document) => <button type="button" key={document.id} className={`doc-button ${selectedProblemId === document.id ? "active" : ""}`} onClick={() => { onSelectProblem(document.id); onClose(); }}>
            <span className="doc-number">{String(document.problemCount).padStart(2, "0")}</span><span><span className="doc-name">{document.title}</span><small>{document.path}</small></span>
          </button>)}
        </section>)}
        {!problems.length && <p className="empty-results">該当する問題はありません。</p>}
      </nav> : <nav aria-label="保存済み回答一覧">
        <p className="nav-label">保存済み回答</p>
        {answers.map((answer) => <button type="button" key={answer.id} className={`doc-button answer-item ${selectedAnswerId === answer.id ? "active" : ""}`} onClick={() => { onSelectAnswer(answer.id); onClose(); }}>
          <span className="doc-number">✓</span><span><span className="doc-name">{answer.title}</span><small>{formatDate(answer.savedAt)}</small><small>{answer.path}</small></span>
        </button>)}
        {!answers.length && <p className="empty-results">保存済みの回答はありません。</p>}
      </nav>}
      <p className="sidebar-note">回答は端末内だけに保存され、Git管理の対象にはなりません。</p>
    </aside>
    {open && <button className="sidebar-scrim" type="button" onClick={onClose} aria-label="メニューを閉じる" />}
  </>;
}

function Toc({ headings }: { headings: { depth: number; text: string; id: string }[] }) {
  return <aside className="toc-sidebar"><p className="toc-heading">このページ</p><nav className="toc-list">
    {headings.map((heading) => <a key={heading.id} className={`toc-link depth-${heading.depth}`} href={`#${heading.id}`}>{heading.text}</a>)}
  </nav><p className="toc-footer">見出しを選ぶと、その場所へ移動します。</p></aside>;
}

export function App() {
  const [content, setContent] = useState<Content>(EMPTY_CONTENT);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [mode, setMode] = useState<"problems" | "answers">("problems");
  const [selectedProblemId, setSelectedProblemId] = useState("");
  const [selectedAnswerId, setSelectedAnswerId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [query, setQuery] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const applyContent = useCallback((incoming: Content) => {
    setContent(incoming);
    setSelectedProblemId((current) => incoming.problems.some((document) => document.id === current) ? current : incoming.problems[0]?.id ?? "");
    setSelectedAnswerId((current) => incoming.answers.some((answer) => answer.id === current) ? current : incoming.answers[0]?.id ?? "");
    setDrafts((current) => {
      const next = { ...current };
      for (const document of incoming.problems) {
        const existing = current[document.path];
        next[document.path] = existing
          ? { ...existing, sourceChanged: existing.baseSignature !== document.signature }
          : loadDraftState(document);
      }
      return next;
    });
  }, []);

  const reload = useCallback(async (quiet = false) => {
    try {
      const response = await fetch("/api/content", { cache: "no-store" });
      if (!response.ok) throw new Error("教材を読み込めませんでした。");
      applyContent(await response.json() as Content);
      setLoadError("");
    } catch (error) {
      if (!quiet) setLoadError(error instanceof Error ? error.message : "教材を読み込めませんでした。");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [applyContent]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const events = new EventSource("/api/events");
    const onUpdate = () => void reload(true);
    events.addEventListener("content-updated", onUpdate);
    return () => { events.removeEventListener("content-updated", onUpdate); events.close(); };
  }, [reload]);

  const selectedDocument = content.problems.find((document) => document.id === selectedProblemId) ?? content.problems[0];
  const selectedAnswer = content.answers.find((answer) => answer.id === selectedAnswerId) ?? content.answers[0];
  const draft = selectedDocument ? drafts[selectedDocument.path] ?? { answers: {}, baseSignature: selectedDocument.signature, sourceChanged: false } : undefined;

  useEffect(() => {
    if (!selectedDocument || !draft) return;
    const timer = window.setTimeout(() => {
      localStorage.setItem(draftStorageKey(selectedDocument.path), JSON.stringify(createDraftEnvelope(draft.baseSignature, draft.answers)));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [selectedDocument, draft]);

  useEffect(() => {
    const onScroll = () => {
      const available = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(available > 0 ? Math.min(100, window.scrollY / available * 100) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [mode, selectedProblemId, selectedAnswerId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName ?? "")) {
        event.preventDefault(); searchRef.current?.focus();
      }
      if (event.key === "Escape") { setSidebarOpen(false); setQuery(""); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const problemHeadings = useMemo(() => selectedDocument ? selectedDocument.chapters.flatMap((chapter) => [
    { depth: 2, text: `第${chapter.number}章　${chapter.title}`, id: chapter.id },
    ...chapter.problems.map((problem) => ({ depth: 3, text: `問題${problem.number}：${problem.title}`, id: problem.id })),
  ]) : [], [selectedDocument]);
  const answerHeadings = useMemo(() => {
    if (!selectedAnswer) return [];
    const headings = extractHeadings(selectedAnswer.markdown);
    const slugs = uniqueHeadingSlugs(headings);
    return headings.map((heading, index) => ({ ...heading, id: slugs[index] }));
  }, [selectedAnswer]);

  const updateAnswer = (problemId: string, value: string) => {
    if (!selectedDocument) return;
    setDrafts((current) => {
      const currentDraft = current[selectedDocument.path] ?? loadDraftState(selectedDocument);
      return { ...current, [selectedDocument.path]: { ...currentDraft, answers: { ...currentDraft.answers, [problemId]: value } } };
    });
  };

  const acknowledgeSourceUpdate = () => {
    if (!selectedDocument) return;
    setDrafts((current) => ({ ...current, [selectedDocument.path]: { ...(current[selectedDocument.path] ?? loadDraftState(selectedDocument)), baseSignature: selectedDocument.signature, sourceChanged: false } }));
  };

  const saveToComputer = async () => {
    if (!selectedDocument || !draft) return;
    setSaving(true); setNotice(null);
    try {
      const response = await fetch("/api/answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problemPath: selectedDocument.path, answers: draft.answers }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "回答を保存できませんでした。");
      const action = result.operation === "updated" ? "更新" : "保存";
      setNotice({ kind: "success", text: `回答を ${result.answer.path} へ${action}しました。` });
      await reload(true);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "回答を保存できませんでした。" });
    } finally { setSaving(false); }
  };

  const downloadMarkdown = () => {
    if (!selectedDocument || !draft) return;
    const markdown = generateAnswerMarkdown(selectedDocument, draft.answers, new Date());
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = fileNameForDownload(selectedDocument); link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  if (loading) return <main className="loading-screen"><span className="loading-mark">問</span><p>教材を読み込んでいます…</p></main>;
  if (loadError) return <main className="loading-screen error-screen"><span className="loading-mark">!</span><h1>読み込みに失敗しました</h1><p>{loadError}</p><button type="button" onClick={() => void reload()}>もう一度試す</button></main>;

  return <div className={`reader-shell ${focusMode ? "focus-mode" : ""}`}>
    <Sidebar content={content} mode={mode} onModeChange={(next) => { setMode(next); setQuery(""); window.scrollTo(0, 0); }} selectedProblemId={selectedProblemId} selectedAnswerId={selectedAnswerId} onSelectProblem={(id) => { setSelectedProblemId(id); setMode("problems"); window.scrollTo(0, 0); }} onSelectAnswer={(id) => { setSelectedAnswerId(id); setMode("answers"); window.scrollTo(0, 0); }} query={query} onQuery={setQuery} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
    <main className="main-column">
      <div className="reading-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
      <header className="topbar">
        <button type="button" className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="メニューを開く">☰</button>
        <p className="breadcrumb">自習問題 <span>/</span> <strong>{mode === "problems" ? selectedDocument?.title : selectedAnswer?.title}</strong></p>
        <div className="toolbar">
          <label className="top-search"><span aria-hidden="true">⌕</span><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="全文検索" /><kbd>/</kbd></label>
          <button type="button" className="icon-button focus-toggle" onClick={() => setFocusMode((value) => !value)}>{focusMode ? "通常表示" : "集中表示"}</button>
          {mode === "problems" && selectedDocument && <><button type="button" className="icon-button download-button" onClick={downloadMarkdown}>Markdownをダウンロード</button><button type="button" className="primary-button" onClick={() => void saveToComputer()} disabled={saving}>{saving ? "保存中…" : "回答を保存"}</button></>}
        </div>
      </header>

      {mode === "problems" && selectedDocument && draft ? <div className="article-wrap">
        <div className="article-eyebrow">SELF STUDY MATERIAL</div>
        <h1 className="article-title">{selectedDocument.title}</h1>
        <div className="article-meta"><span>{selectedDocument.path}</span><span>{selectedDocument.problemCount}問</span><span>{countAnswered(draft.answers)}問回答済み</span></div>
        <div className="progress-summary"><div><strong>{countAnswered(draft.answers)}</strong><span> / {selectedDocument.problemCount} 問</span></div><div className="progress-track"><span style={{ width: `${selectedDocument.problemCount ? countAnswered(draft.answers) / selectedDocument.problemCount * 100 : 0}%` }} /></div><small>下書きは自動保存されています</small></div>
        {notice && <div className={`notice ${notice.kind}`} role="status">{notice.text}<button type="button" onClick={() => setNotice(null)} aria-label="通知を閉じる">×</button></div>}
        {draft.sourceChanged && <div className="notice update" role="status"><span><strong>教材が更新されています。</strong>既存の下書きは保持しました。問題文を確認してから回答を続けてください。</span><button type="button" onClick={acknowledgeSourceUpdate}>確認しました</button></div>}
        {(selectedDocument.introduction || selectedDocument.commonRules) && <section className="material-intro">
          {selectedDocument.introduction && <Markdown source={selectedDocument.introduction} />}
          {selectedDocument.commonRules && <div className="common-rules"><span className="section-kicker">回答するときの共通ルール</span><Markdown source={selectedDocument.commonRules} /></div>}
        </section>}
        {selectedDocument.chapters.map((chapter) => <section className="chapter-section" key={chapter.id} id={chapter.id}>
          <div className="chapter-heading"><span>CHAPTER {String(chapter.number).padStart(2, "0")}</span><h2>第{chapter.number}章　{chapter.title}</h2></div>
          {chapter.introduction && <Markdown source={chapter.introduction} className="chapter-introduction" />}
          <div className="question-list">{chapter.problems.map((problem) => <QuestionCard key={problem.id} problem={problem} answer={draft.answers[problem.id] ?? ""} onChange={(value) => updateAnswer(problem.id, value)} />)}</div>
        </section>)}
      </div> : mode === "answers" && selectedAnswer ? <div className="article-wrap answer-document">
        <div className="article-eyebrow">SAVED ANSWER</div>
        <h1 className="article-title">{selectedAnswer.title}</h1>
        <div className="article-meta"><span>{formatDate(selectedAnswer.savedAt)}</span><span>{selectedAnswer.sourcePath || "元教材不明"}</span></div>
        <Markdown source={selectedAnswer.markdown} />
      </div> : <div className="empty-state"><span>∅</span><h1>{mode === "problems" ? "問題がありません" : "保存済み回答がありません"}</h1><p>{mode === "problems" ? "02-自主勉強課題 配下へ互換形式のMarkdownを追加してください。" : "問題に回答し、「回答を保存」を選ぶとここへ表示されます。"}</p></div>}
    </main>
    <Toc headings={mode === "problems" ? problemHeadings : answerHeadings} />
  </div>;
}
