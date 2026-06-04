/**
 * Language Server：响应 client.js 发来的 LSP 请求
 *
 * 建议阅读顺序：startServer() → 各 on* 处理函数 → MiMo 配置
 */
import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  Location,
  CompletionItemKind,
  TextDocumentSyncKind,
} from "vscode-languageserver/node.js";
import type {
  DefinitionParams,
  HoverParams,
  ReferenceParams,
  CompletionParams,
  CompletionItem,
  ExecuteCommandParams,
  Position,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { OpenAI } from "openai";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(projectRoot, ".env") });

const bJsUri = `file:///${path.resolve(projectRoot, "b.js").replace(/\\/g, "/")}`;
const aJsUri = `file:///${path.resolve(projectRoot, "a.js").replace(/\\/g, "/")}`;

// b.js 第一行 export function foo() 里，foo 的起止列（0 起算）
const fooRangeInB = {
  start: { line: 0, character: 16 },
  end: { line: 0, character: 19 },
};

const exportedFromB = [
  {
    name: "foo",
    kind: CompletionItemKind.Function,
    detail: "定义于 b.js",
    doc: "export function foo()",
  },
];

// —— MiMo（OpenAI 兼容）——

const aiOn =
  process.env.AI_ENABLED !== "false" &&
  Boolean(process.env.MIMO_API_KEY?.trim()) &&
  !process.env.MIMO_API_KEY?.includes("在这里");

const mimo = aiOn
  ? new OpenAI({
      apiKey: process.env.MIMO_API_KEY,
      baseURL:
        process.env.MIMO_BASE_URL || "https://token-plan-cn.xiaomimimo.com/v1",
    })
  : null;

const mimoModel = process.env.MIMO_MODEL || "mimo-v2.5-pro";

async function askMimo(
  system: string,
  user: string,
  maxTokens: number
): Promise<string | null> {
  if (!mimo) return null;
  const res = await mimo.chat.completions.create({
    model: mimoModel,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: maxTokens,
    // @ts-expect-error MiMo 扩展字段
    extra_body: { thinking: { type: "disabled" } },
  });
  return res.choices[0]?.message?.content ?? null;
}

// —— LSP 能力（对应 client 里各 demo 函数）——

function goToDefinition(params: DefinitionParams) {
  if (!params.textDocument.uri.includes("a.js")) return null;
  return Location.create(bJsUri, fooRangeInB);
}

function getHover(params: HoverParams) {
  if (!params.textDocument.uri.includes("a.js")) return null;
  return {
    contents: {
      kind: "markdown",
      value: [
        "**foo** — 函数",
        "",
        "定义：`b.js` 第 1 行",
        "",
        "```javascript",
        "export function foo() { ... }",
        "```",
        "",
        "_悬停不跳转；跳转请用 definition。_",
      ].join("\n"),
    },
  };
}

function getReferences(params: ReferenceParams) {
  if (!params.textDocument.uri.includes("a.js")) return [];
  // a.js 第 2 行 foo()；b.js 第 1 行定义处（demo 写死行列）
  return [
    Location.create(aJsUri, {
      start: { line: 1, character: 0 },
      end: { line: 1, character: 3 },
    }),
    Location.create(bJsUri, fooRangeInB),
  ];
}

function wordBeforeCursor(doc: TextDocument, pos: Position): string {
  const text = doc.getText({
    start: { line: pos.line, character: 0 },
    end: pos,
  });
  return text.match(/[\w$]+$/)?.[0] ?? "";
}

async function getCompletions(params: CompletionParams, docs: TextDocuments<TextDocument>) {
  const doc = docs.get(params.textDocument.uri);
  if (!doc || !params.textDocument.uri.includes("a.js")) {
    return { isIncomplete: false, items: [] as CompletionItem[] };
  }

  const prefix = wordBeforeCursor(doc, params.position);
  const items: CompletionItem[] = [];

  for (const sym of exportedFromB) {
    if (!prefix || sym.name.startsWith(prefix)) {
      items.push({
        label: sym.name,
        kind: sym.kind,
        detail: sym.detail,
        documentation: sym.doc,
        insertText: sym.name,
      });
    }
  }

  if (mimo && process.env.AI_COMPLETION !== "false") {
    try {
      const raw = await askMimo(
        "根据上下文只输出一行可插入的 JavaScript，不要 markdown、不要解释。",
        `文件：\n${doc.getText()}\n前缀：「${prefix || "(空)"}」`,
        60
      );
      const snippet = (raw ?? "")
        .trim()
        .replace(/^```[\w]*\n?|```$/g, "")
        .split("\n")[0]
        .trim();
      if (snippet) {
        items.push({
          label: `🤖 ${snippet.length > 36 ? snippet.slice(0, 36) + "…" : snippet}`,
          kind: CompletionItemKind.Snippet,
          detail: "MiMo AI 补全",
          insertText: snippet,
        });
      }
    } catch (e) {
      console.error("[AI] completion 失败:", e);
    }
  }

  return { isIncomplete: false, items };
}

async function explainCode(params: ExecuteCommandParams) {
  if (params.command !== "ai.explain") return "未知指令";
  const code = String(params.arguments?.[0] ?? "");
  if (!mimo) return "未配置 MIMO_API_KEY 或 AI_ENABLED=false。";

  const text = await askMimo(
    "用 2～3 句中文解释 JavaScript 代码，面向懂基础的读者。",
    `解释：\n${code}`,
    300
  );
  return text ?? "(无回复)";
}

// —— 启动：把上面的函数挂到 LSP 连接上 ——

function startServer() {
  const conn = createConnection(ProposedFeatures.all);
  const docs = new TextDocuments(TextDocument);

  conn.onInitialize(() => ({
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      definitionProvider: true,
      hoverProvider: true,
      referencesProvider: true,
      completionProvider: { triggerCharacters: ["."], resolveProvider: false },
      executeCommandProvider: { commands: ["ai.explain"] },
    },
  }));

  conn.onInitialized(() => docs.listen(conn));

  conn.onDefinition(goToDefinition);
  conn.onHover(getHover);
  conn.onReferences(getReferences);
  conn.onCompletion((p) => getCompletions(p, docs));
  conn.onExecuteCommand(explainCode);

  docs.listen(conn);
  conn.listen();
}

startServer();
