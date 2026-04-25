const API_BASE = "https://api.inceptionlabs.ai/v1";
const CHAT_URL = `${API_BASE}/chat/completions`;
const FIM_URL = `${API_BASE}/fim/completions`;
const EDIT_URL = `${API_BASE}/edit/completions`;
const MODELS_URL = `${API_BASE}/models`;

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

// Model catalog
export interface ModelInfo {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  max_output_length?: number;
  supported_features?: string[];
  pricing?: {
    prompt?: string;
    completion?: string;
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

  // Retry transient failures (5xx, ECONNRESET, ETIMEDOUT) up to 3 times with
  // 1s/2s/4s backoff. 4xx (auth, validation) is thrown immediately.
  private async post<T>(url: string, body: unknown, attempt = 0): Promise<T> {
    const MAX_ATTEMPTS = 3;
    const TRANSIENT_STATUS = new Set([500, 502, 503, 504, 522, 524]);
    const TRANSIENT_NETWORK = /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|fetch failed/i;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (TRANSIENT_NETWORK.test(msg) && attempt < MAX_ATTEMPTS - 1) {
        const wait = 1000 * 2 ** attempt;
        process.stderr.write(`mcode: network blip (${msg.slice(0, 60)}), retry ${attempt + 1}/${MAX_ATTEMPTS - 1} in ${wait}ms\n`);
        await new Promise((r) => setTimeout(r, wait));
        return this.post<T>(url, body, attempt + 1);
      }
      throw e;
    }
    if (!res.ok) {
      const text = await res.text();
      if (TRANSIENT_STATUS.has(res.status) && attempt < MAX_ATTEMPTS - 1) {
        const wait = 1000 * 2 ** attempt;
        process.stderr.write(`mcode: API ${res.status}, retry ${attempt + 1}/${MAX_ATTEMPTS - 1} in ${wait}ms\n`);
        await new Promise((r) => setTimeout(r, wait));
        return this.post<T>(url, body, attempt + 1);
      }
      throw new Error(`Mercury API ${res.status} (${new URL(url).pathname}): ${text}`);
    }
    return (await res.json()) as T;
  }

  chat(req: ChatRequest): Promise<ChatResponse> {
    return this.post<ChatResponse>(CHAT_URL, req);
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(MODELS_URL, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Mercury API ${res.status} (models): ${text}`);
    }
    const json = (await res.json()) as { data?: ModelInfo[] };
    return json.data ?? [];
  }

  /** Returns true if this account can actually call the model (one-token probe). */
  async probeModel(modelId: string): Promise<boolean> {
    try {
      await this.chat({
        model: modelId,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
      });
      return true;
    } catch {
      return false;
    }
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
