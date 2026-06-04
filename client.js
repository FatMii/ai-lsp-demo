/**
 * 模拟编辑器：按顺序跑 5 个 LSP 演示
 * 运行：pnpm demo
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startLanguageServer } from "./lsp-io.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// —— 下面每个函数对应 README 演示表中的一行 ——

/** 在 a.js 原文中定位 foo 调用处（第二行 foo()）的光标位置 */
function fooPositionInA(aText) {
  const lines = aText.split(/\r?\n/);
  const line = lines.findIndex((l) => /^\s*foo\s*\(/.test(l));
  const col = lines[line].indexOf("foo");
  return { line, character: col + 1 };
}

async function connect(lsp) {
  await lsp.request("initialize", {
    processId: process.pid,
    rootUri: lsp.fileUri("."),
    capabilities: {},
    clientInfo: { name: "demo-client", version: "1.0" },
  });
  lsp.notify("initialized", {});
}

function openWorkspaceFiles(lsp) {
  for (const file of ["a.js", "b.js"]) {
    const text = readFileSync(path.join(ROOT, file), "utf8");
    lsp.notify("textDocument/didOpen", {
      textDocument: {
        uri: lsp.fileUri(file),
        languageId: "javascript",
        version: 1,
        text,
      },
    });
  }
}

/**
 * 【1】跳转到定义
 *
 * 模拟：用户在 a.js 里把光标放在 foo 上，按「转到定义」。
 * 发送 LSP 请求 textDocument/definition，服务端（server.ts 的 goToDefinition）
 * 返回 foo 的定义位置 → 应落在 b.js。
 *
 * 编辑器真实行为：打开 b.js 并滚到对应行（这里只打印行列号）。
 */
async function demoGoToDefinition(lsp, aText) {
  console.log("【1】LSP：textDocument/definition（a.js 里的 foo → b.js）\n");

  const pos = fooPositionInA(aText);
  const result = await lsp.request("textDocument/definition", {
    textDocument: { uri: lsp.fileUri("a.js") },
    position: pos,
  });

  const loc = Array.isArray(result) ? result[0] : result;
  const file = loc.uri.split("/").pop();
  console.log(
    `  结果: ${file} 第 ${loc.range.start.line + 1} 行, 列 ${loc.range.start.character + 1}\n`
  );
}

/**
 * 【2】悬停说明
 *
 * 模拟：光标停在 foo 上，不跳转，弹出提示框。
 * 发送 textDocument/hover，服务端（getHover）返回 Markdown 说明。
 *
 * 与【1】的区别：definition 打开定义文件；hover 原地显示文档。
 */
async function demoHover(lsp, aText) {
  console.log("【2】LSP：textDocument/hover（悬停在 foo 上）\n");

  const result = await lsp.request("textDocument/hover", {
    textDocument: { uri: lsp.fileUri("a.js") },
    position: fooPositionInA(aText),
  });

  const content = result?.contents;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((c) => c.value ?? c).join("\n")
        : content?.value ?? "(无)";
  console.log(text.replace(/^/gm, "  "));
  console.log();
}

/**
 * 【3】查找引用
 *
 * 模拟：「查找所有引用」，列出符号 foo 在工程里出现的位置。
 * 发送 textDocument/references，服务端（getReferences）返回 Location 列表。
 */
async function demoReferences(lsp, aText) {
  console.log("【3】LSP：textDocument/references（foo 的所有引用）\n");

  const result = await lsp.request("textDocument/references", {
    textDocument: { uri: lsp.fileUri("a.js") },
    position: fooPositionInA(aText),
    context: { includeDeclaration: true },
  });

  const list = result ?? [];
  for (const loc of list) {
    const file = loc.uri.split("/").pop();
    const { line, character } = loc.range.start;
    console.log(`  · ${file} 第 ${line + 1} 行, 列 ${character + 1}`);
  }
  console.log();
}

/**
 * 【4】代码补全
 *
 * 模拟：用户在 a.js 末尾新起一行，输入 const result = fo，光标在 fo 后面，
 * 触发补全列表。
 * 先用 didChange 把「正在编辑」的内容同步给服务端，再发 textDocument/completion；
 * 服务端（getCompletions）按已输入前缀 fo 过滤，返回 foo 等候选（可选还有 MiMo 建议）。
 *
 * 编辑器真实行为：弹出下拉框，选中后把 insertText 插入光标处（这里只打印候选项）。
 */
async function demoCompletion(lsp, aText) {
  console.log("【4】LSP：textDocument/completion（模拟输入 fo，补全符号）\n");

  const draft = `${aText.trimEnd()}\nconst result = fo`;
  lsp.notify("textDocument/didChange", {
    textDocument: { uri: lsp.fileUri("a.js"), version: 2 },
    contentChanges: [{ text: draft }],
  });

  const lines = draft.split(/\r?\n/);
  const line = lines.length - 1;
  const col = lines[line].length;
  console.log(`  模拟编辑: …const result = fo^  (第 ${line + 1} 行)\n`);

  const result = await lsp.request("textDocument/completion", {
    textDocument: { uri: lsp.fileUri("a.js") },
    position: { line, character: col },
  });

  const items = result?.items ?? result ?? [];
  for (const item of items) {
    console.log(
      `  · [${item.detail || ""}] ${item.label}  →  insert: ${item.insertText ?? item.label}`
    );
  }
  console.log();
}

/**
 * 【5】用 AI 解释代码（自定义命令）
 *
 * 模拟：用户执行插件命令「解释当前文件」。
 * 发送 workspace/executeCommand，命令名 ai.explain，参数为 a.js 全文；
 * 服务端（explainCode）调用小米 MiMo，返回自然语言说明。
 *
 * 与【1】的区别：definition 回答「定义在哪」；这里回答「这段代码什么意思」。
 */
async function demoExplainCode(lsp, aText) {
  console.log("【5】LSP + AI：workspace/executeCommand（ai.explain）\n");

  const explanation = await lsp.request("workspace/executeCommand", {
    command: "ai.explain",
    arguments: [aText.trim()],
  });

  console.log("  MiMo 解释:\n");
  console.log(String(explanation).replace(/^/gm, "  "));
}

// —— 主流程：建议从上到下读 ——

async function main() {
  console.log("========== AST + LSP Demo ==========\n");

  const lsp = startLanguageServer(ROOT);
  const aText = readFileSync(path.join(ROOT, "a.js"), "utf8");

  try {
    await connect(lsp);
    openWorkspaceFiles(lsp);
    await demoGoToDefinition(lsp, aText);
    await demoHover(lsp, aText);
    await demoReferences(lsp, aText);
    await demoCompletion(lsp, aText);
    await demoExplainCode(lsp, aText);
    console.log("\n========== 演示结束 ==========");
  } finally {
    lsp.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
