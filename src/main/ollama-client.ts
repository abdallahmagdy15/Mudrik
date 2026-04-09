import http from "http";
import https from "https";
import { Config } from "../shared/types";
import { SYSTEM_PROMPT } from "../shared/prompts";

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class OllamaClient {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  updateConfig(config: Config): void {
    this.config = config;
  }

  async *chatStream(
    messages: OllamaMessage[]
  ): AsyncGenerator<string, void, unknown> {
    const model = this.config.model;
    const isCloud = model.endsWith(":cloud");
    const actualModel = isCloud ? model.replace(":cloud", "") : model;

    if (isCloud && this.config.cloudProxyUrl) {
      yield* this.streamCloud(actualModel, messages);
    } else {
      yield* this.streamLocal(actualModel, messages);
    }
  }

  private async *streamLocal(
    model: string,
    messages: OllamaMessage[]
  ): AsyncGenerator<string, void, unknown> {
    const url = new URL("/api/chat", this.config.ollamaUrl);

    const body = JSON.stringify({
      model,
      messages,
      stream: true,
    });

    const response = await this.makeRequest(url, body, false);

    if (!response) {
      yield "[Error: Could not connect to Ollama. Is it running?]";
      return;
    }

    let buffer = "";
    for await (const chunk of response) {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.message?.content) {
            yield parsed.message.content;
          }
          if (parsed.done) {
            return;
          }
        } catch {
          // skip malformed lines
        }
      }
    }
  }

  private async *streamCloud(
    model: string,
    messages: OllamaMessage[]
  ): AsyncGenerator<string, void, unknown> {
    const url = new URL(this.config.cloudProxyUrl);

    const body = JSON.stringify({
      model,
      messages,
      stream: true,
    });

    const response = await this.makeRequest(url, body, true);

    if (!response) {
      yield "[Error: Could not connect to cloud proxy.]";
      return;
    }

    let buffer = "";
    for await (const chunk of response) {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim() || line === "data: [DONE]") continue;
        if (line.startsWith("data: ")) {
          try {
            const parsed = JSON.parse(line.slice(6));
            const content =
              parsed.choices?.[0]?.delta?.content ||
              parsed.choices?.[0]?.message?.content;
            if (content) {
              yield content;
            }
          } catch {
            // skip
          }
        }
      }
    }
  }

  private makeRequest(
    url: URL,
    body: string,
    useHttps: boolean
  ): Promise<AsyncIterable<Buffer> | null> {
    return new Promise((resolve) => {
      const lib = useHttps ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port || (useHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      };

      const req = lib.request(options, (res) => {
        if (res.statusCode !== 200) {
          resolve(null);
          return;
        }
        resolve(res as unknown as AsyncIterable<Buffer>);
      });

      req.on("error", () => resolve(null));
      req.setTimeout(30000, () => {
        req.destroy();
        resolve(null);
      });

      req.write(body);
      req.end();
    });
  }
}