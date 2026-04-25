const API_BASE = "https://api.inceptionlabs.ai/v1";
const CHAT_URL = `${API_BASE}/chat/completions`;
const FIM_URL = `${API_BASE}/fim/completions`;
const EDIT_URL = `${API_BASE}/edit/completions`;

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
}

export interface ChatResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    finish_reason: string;
    message: ChatMessage;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Streaming chunks (OpenAI-compatible delta format)
export interface ChatStreamDelta {
  role?: "assistant";
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
  }>;
}

export interface ChatStreamChunk {
  id?: string;
  model?: string;
  choices: Array<{
    index: number;
    delta: ChatStreamDelta;
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Fill-in-Middle (Mercury Edit 2)
export interface FimRequest {
  model: string; // e.g. "mercury-edit-2"
  prompt: string; // text BEFORE the insertion point
  suffix: string; // text AFTER the insertion point
  max_tokens?: number;
}

export interface FimResponse {
  choices: Array<{ index: number; text: string; finish_reason?: string }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// Next-Edit completion (Mercury Edit 2)
// Uses chat-style messages with embedded markup tags:
//   <|code_to_edit|>...<|/code_to_edit|>
//   <|cursor|>
//   <|edit_diff_history|>...<|/edit_diff_history|>
export interface EditCompletionRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
}

export class MercuryClient {
  constructor(private apiKey: string) {}

  private async post<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Mercury API ${res.status} (${new URL(url).pathname}): ${text}`);
    }
    return (await res.json()) as T;
  }

  chat(req: ChatRequest): Promise<ChatResponse> {
    return this.post<ChatResponse>(CHAT_URL, req);
  }

  /**
   * Stream a chat completion as Server-Sent Events.
   * Yields each delta chunk; consumer accumulates content/tool_calls.
   * Includes a final usage chunk when supported.
   */
  async *chatStream(req: ChatRequest): AsyncGenerator<ChatStreamChunk, void, unknown> {
    const body = {
      ...req,
      stream: true,
      stream_options: { include_usage: true },
    };
    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Mercury API ${res.status} (chat stream): ${text}`);
    }
    if (!res.body) throw new Error("Mercury API: empty response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by a blank line.
      const idx = buffer.lastIndexOf("\n\n");
      if (idx < 0) continue;
      const events = buffer.slice(0, idx).split("\n\n");
      buffer = buffer.slice(idx + 2);
      for (const evt of events) {
        for (const line of evt.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          if (data === "[DONE]") return;
          try {
            yield JSON.parse(data) as ChatStreamChunk;
          } catch {
            // skip malformed chunk
          }
        }
      }
    }
  }

  fim(req: FimRequest): Promise<FimResponse> {
    return this.post<FimResponse>(FIM_URL, req);
  }

  editComplete(req: EditCompletionRequest): Promise<ChatResponse> {
    return this.post<ChatResponse>(EDIT_URL, req);
  }
}
