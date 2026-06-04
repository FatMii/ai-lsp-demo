/**
 * LSP 底层收发（Content-Length + JSON-RPC）
 *
 * 若只想理解「编辑器和服务端在聊什么」，读 client.js / server.ts 即可；
 * 本文件是协议细节，可以最后再翻。
 */
import { spawn } from "node:child_process";
import path from "node:path";

function encodeMessage(obj) {
  const body = JSON.stringify(obj);
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

function decodeMessages(buffer, onMessage) {
  let rest = buffer;
  for (;;) {
    const headerEnd = rest.indexOf("\r\n\r\n");
    if (headerEnd < 0) break;
    const header = rest.slice(0, headerEnd).toString();
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) break;
    const bodyLen = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (rest.length < bodyStart + bodyLen) break;
    onMessage(JSON.parse(rest.slice(bodyStart, bodyStart + bodyLen).toString()));
    rest = rest.slice(bodyStart + bodyLen);
  }
  return rest;
}

/**
 * 启动 server.ts 子进程，并返回可发 LSP 消息的对象
 */
export function startLanguageServer(projectRoot) {
  const serverPath = path.join(projectRoot, "server.ts");
  // proc：ChildProcess，用 spawn 拉起的语言服务子进程（实际跑的是 server.ts）
  // client 经 proc.stdin 发 LSP 请求，从 proc.stdout 读 JSON-RPC 回复；close() 时 proc.kill() 结束子进程
  const proc = spawn("npx", ["tsx", serverPath, "--stdio"], {
    cwd: projectRoot,
    // stdin/stdout 设为 pipe，才能在本进程里读写；stderr 继承到终端便于看 server 日志
    stdio: ["pipe", "pipe", "inherit"],
    env: process.env,
    shell: true,
  });

  let nextId = 0;
  const pending = new Map();
  let readBuffer = Buffer.alloc(0);

  // 子进程 stdout 上收到的是带 Content-Length 头的 LSP 报文
  proc.stdout.on("data", (chunk) => {
    readBuffer = decodeMessages(Buffer.concat([readBuffer, chunk]), (msg) => {
      if (msg.id == null || !pending.has(msg.id)) return;
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    });
  });

  // 写入子进程 stdin，即发给 server.ts 的 LSP 消息
  const send = (payload) => proc.stdin.write(encodeMessage(payload));

  return {
    fileUri(filename) {
      const abs = path.resolve(projectRoot, filename).replace(/\\/g, "/");
      return `file:///${abs}`;
    },

    /** 需要服务端回复 */
    request(method, params) {
      const id = ++nextId;
      send({ jsonrpc: "2.0", id, method, params });
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          reject(new Error(`超时: ${method}`));
        }, 60_000);
      });
    },

    /** 不需要回复 */
    notify(method, params) {
      send({ jsonrpc: "2.0", method, params });
    },

    close() {
      proc.kill(); // 演示结束，关掉语言服务子进程
    },
  };
}
