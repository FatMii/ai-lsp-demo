# ai-lsp-demo

用最小代码演示 **Language Server Protocol（LSP）**：编辑器（Client）与语言服务（Server）如何通过 JSON-RPC、stdio 通信，以及跳转定义、悬停、补全等常见能力如何对应到协议方法。

不实现完整 TypeScript 语言服务，而是用固定符号 `foo`（`a.js` 调用 `b.js`）模拟结果，便于先看清协议往返。

## 演示能力

运行 `pnpm demo` 后，终端依次输出【1】～【5】：

| 终端 | 能力 | LSP 方法 | client.js | server.ts |
|------|------|----------|-----------|-----------|
| 【1】 | 跳转到定义 | `textDocument/definition` | `demoGoToDefinition` | `goToDefinition` |
| 【2】 | 悬停说明 | `textDocument/hover` | `demoHover` | `getHover` |
| 【3】 | 查找引用 | `textDocument/references` | `demoReferences` | `getReferences` |
| 【4】 | 代码补全 | `textDocument/completion` | `demoCompletion` | `getCompletions` |
| 【5】 | AI 解释代码 | `workspace/executeCommand` | `demoExplainCode` | `explainCode` |

文档同步（无终端序号，但协议上必须有）：`textDocument/didOpen`、`textDocument/didChange`。

## 快速开始

**环境**：Node.js 18+、[pnpm](https://pnpm.io/)

```bash
git clone https://github.com/FatMii/ai-lsp-demo.git
cd ai-lsp-demo
pnpm i
pnpm demo
```

【1】～【4】无需配置即可运行；【5】需 MiMo API 密钥才有真实 AI 回复（见下）。

## 项目结构

```text
ai-lsp-demo/
├── client.js      # 模拟编辑器：spawn Server、发 LSP 请求
├── server.ts      # 模拟语言服务：处理 definition / hover 等
├── lsp-io.js      # Content-Length + JSON-RPC 读写（stdio）
├── a.js / b.js    # 跨文件调用示例（a 调用 b 中的 foo）
├── .env.example   # 环境变量模板（【5】可选）
└── package.json
```

- 想先懂 **LSP 在干什么**：读 `client.js` 的 `main()`，对照终端【1】～【5】。
- 想懂 **Server 怎么响应**：读 `server.ts` 里与上表对应的处理函数。
- 想懂 **字节怎么在管道里切包**：再读 `lsp-io.js`（不影响理解协议语义）。

## 架构示意

```text
client.js  ──stdin/stdout──►  server.ts
    │                            │
    request / notify             onDefinition / onHover / …
```

协议基于 [LSP 3.17](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/)，传输为 **stdio** + **Content-Length** 封装的 JSON-RPC 2.0。

## MiMo API（仅【5】）

【5】走 `workspace/executeCommand`，Server 用 MiMo（OpenAI 兼容）生成解释。没配密钥时 demo 仍会跑完，【5】输出为：`未配置 MIMO_API_KEY 或 AI_ENABLED=false。`

```bash
cp .env.example .env
# 填写 MIMO_API_KEY
```

`.env` 已在 `.gitignore`，**不要提交到仓库**。