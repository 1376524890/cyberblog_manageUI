import { writable } from "svelte/store";
export interface Proposal {
  id: string;
  operation: string;
  collection?: string;
  slug?: string;
  reason: string;
  data?: Record<string, unknown>;
  body?: string;
  before?: { data: Record<string, unknown>; body: string };
  expiresAt: string;
  state: "pending" | "running" | "done" | "failed";
  error?: string;
  number?: number;
}
export interface Turn {
  role: "user" | "assistant";
  text: string;
  proposals?: Proposal[];
  trace?: string[];
  usage?: any;
}
export const conversation = writable<Turn[]>([]);
export async function chatRequest(
  messages: { role: string; content: string }[],
  progress: (text: string) => void,
  signal: AbortSignal,
) {
  const response = await fetch("/api/v1/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!response.ok) {
    let error;
    try {
      error = await response.json();
    } catch {}
    throw new Error(error?.error?.message ?? "AI 请求失败，请稍后重试");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("浏览器不支持流式响应");
  const decoder = new TextDecoder();
  let buffer = "",
    result: any = null;
  try {
    for (;;) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        let type = "message",
          data = "";
        for (const line of event.split("\n")) {
          if (line.startsWith("event:")) type = line.slice(6).trim();
          if (line.startsWith("data:")) data += line.slice(5).trimStart();
        }
        if (!data) continue;
        const value = JSON.parse(data);
        if (type === "progress") progress(value.text);
        if (type === "error") throw new Error(value.message);
        if (type === "result") result = value;
      }
      if (chunk.done) break;
    }
  } finally {
    reader.releaseLock();
  }
  if (!result) throw new Error("连接提前结束，请重试");
  return result as {
    reply: string;
    proposals: Proposal[];
    trace: string[];
    usage?: any;
  };
}
