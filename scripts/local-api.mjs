import { mkdirSync, watch } from "node:fs";
import path from "node:path";
import { ContentError, MAX_REQUEST_BYTES, loadContent, saveAnswers } from "./content-service.mjs";

function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

export function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const protocol = request.socket?.encrypted ? "https:" : "http:";
    return new URL(origin).origin === `${protocol}//${request.headers.host}`;
  } catch {
    return false;
  }
}

export async function readJsonBody(request, limit = MAX_REQUEST_BYTES) {
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (declaredLength > limit) throw new ContentError("TOO_LARGE", "保存要求が大きすぎます。", 413);
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new ContentError("TOO_LARGE", "保存要求が大きすぎます。", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ContentError("INVALID_JSON", "保存要求をJSONとして読み取れませんでした。", 400);
  }
}

export function createApiHandler({ projectRoot, events, now }) {
  return async function handleApi(request, response, next = () => {}) {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname === "/api/events") {
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        return sendJson(response, 405, { error: "GETメソッドのみ利用できます。" });
      }
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      response.flushHeaders?.();
      response.write(": connected\n\n");
      events?.add(response);
      response.on("close", () => events?.delete(response));
      return;
    }
    if (pathname !== "/api/content" && pathname !== "/api/answers") return next();

    try {
      if (pathname === "/api/content") {
        if (request.method !== "GET") {
          response.setHeader("Allow", "GET");
          return sendJson(response, 405, { error: "GETメソッドのみ利用できます。" });
        }
        return sendJson(response, 200, await loadContent(projectRoot));
      }

      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        return sendJson(response, 405, { error: "POSTメソッドのみ利用できます。" });
      }
      if (!isSameOrigin(request)) return sendJson(response, 403, { error: "別の画面からの保存要求は受け付けられません。" });
      if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
        return sendJson(response, 415, { error: "JSON形式の保存要求のみ利用できます。" });
      }
      const body = await readJsonBody(request);
      const answer = await saveAnswers({
        projectRoot,
        problemPath: body?.problemPath,
        answers: body?.answers,
        now: now?.() ?? new Date(),
      });
      return sendJson(response, 201, { answer });
    } catch (error) {
      if (error instanceof ContentError) return sendJson(response, error.status, { code: error.code, error: error.message });
      console.error("ローカルAPIの処理に失敗しました。", error);
      return sendJson(response, 500, { error: "ローカルAPIの処理に失敗しました。" });
    }
  };
}

function watchTree(projectRoot, listener) {
  const answersRoot = path.join(projectRoot, "answers");
  mkdirSync(answersRoot, { recursive: true });
  const targets = [path.join(projectRoot, "02-自主勉強課題"), answersRoot];
  const watchers = [];
  for (const target of targets) {
    try {
      watchers.push(watch(target, { recursive: true }, (_event, filename) => {
        if (typeof filename === "string" && filename.toLowerCase().endsWith(".md")) listener();
      }));
    } catch (error) {
      if (error?.code !== "ENOENT") console.warn(`監視を開始できませんでした: ${target}`, error);
    }
  }
  return { close: () => watchers.forEach((watcher) => watcher.close()) };
}

export function localContentApi({ projectRoot }) {
  return {
    name: "local-content-api",
    apply: "serve",
    configureServer(server) {
      const events = new Set();
      let timer;
      const watcher = watchTree(projectRoot, () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          for (const response of events) response.write("event: content-updated\ndata: {}\n\n");
        }, 100);
      });
      server.httpServer?.on("close", () => {
        clearTimeout(timer);
        watcher.close();
        for (const response of events) response.end();
        events.clear();
      });
      server.middlewares.use(createApiHandler({ projectRoot, events }));
    },
  };
}
