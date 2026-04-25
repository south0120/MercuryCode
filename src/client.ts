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

  fim(req: FimRequest): Promise<FimResponse> {
    return this.post<FimResponse>(FIM_URL, req);
  }

  editComplete(req: EditCompletionRequest): Promise<ChatResponse> {
    return this.post<ChatResponse>(EDIT_URL, req);
  }
}
