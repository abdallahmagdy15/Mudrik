import http from "http";
import https from "https";
import { Config } from "../shared/types";
import { SYSTEM_PROMPT } from "../shared/prompts";

const log = (msg: string) => console.log(`[OLLAMA] ${msg}`);

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class OllamaClient {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    log(`Client created: url=${config.ollamaUrl}, model=${config.model}, cloudProxy=${config.cloudProxyUrl || "(none)"}`);
  }

  updateConfig(config: Config): void {
    this.config = config;
    log(`Config updated: url=${config.ollamaUrl}, model=${config.model}`);
  }

  async *chatStream(
    messages: OllamaMessage[]
  ): AsyncGenerator<string, void, unknown> {
    const model = this.config.model;
    const isCloud = model.endsWith(":cloud");
    const actualModel = isCloud ? model.replace(":cloud", "") : model;

    log(`chatStream: model="${model}", isCloud=${isCloud}, actualModel="${actualModel}"`);

    if (isCloud && this.config.cloudProxyUrl) {
      log(`Routing to cloud proxy: ${this.config.cloudProxyUrl}`);
      yield* this.streamCloud(actualModel, messages);
    } else {
      log(`Routing to local Ollama: ${this.config.ollamaUrl}`);
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

    log(`Sending local request to ${url.toString()}, body length=${body.length}`);

    const response = await this.makeRequest(url, body, false);

    if (!response) {
      log("ERROR: No response from Ollama (connection failed or non-200 status)");
      yield "[Error: Could not connect to Ollama. Is it running?]";
      return;
    }

    log("Connection established, streaming tokens...");
    let tokenCount = 0;
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
            tokenCount++;
            yield parsed.message.content;
          }
          if (parsed.done) {
            log(`Stream done, total tokens yielded: ${tokenCount}`);
            return;
          }
        } catch (parseErr: any) {
          log(`WARN: Failed to parse stream line: ${line.slice(0, 100)}`);
        }
      }
    }
    log(`Stream ended (no done signal), tokens yielded: ${tokenCount}`);
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

    log(`Sending cloud request to ${url.toString()}`);

    const response = await this.makeRequest(url, body, true);

    if (!response) {
      log("ERROR: No response from cloud proxy");
      yield "[Error: Could not connect to cloud proxy.]";
      return;
    }

    log("Cloud connection established, streaming...");
    let tokenCount = 0;
    let buffer = "";
    for await (const chunk of response) {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim() || line === "data: [DONE]") {
          if (line === "data: [DONE]") {
            log(`Cloud stream done, tokens yielded: ${tokenCount}`);
          }
          continue;
        }
        if (line.startsWith("data: ")) {
          try {
            const parsed = JSON.parse(line.slice(6));
            const content =
              parsed.choices?.[0]?.delta?.content ||
              parsed.choices?.[0]?.message?.content;
            if (content) {
              tokenCount++;
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

      log(`HTTP ${options.method} ${url.protocol}//${options.hostname}:${options.port}${options.path}`);

      const req = lib.request(options, (res) => {
        log(`Response status: ${res.statusCode}`);
        if (res.statusCode !== 200) {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            log(`Error response body: ${body.slice(0, 200)}`);
            resolve(null);
          });
          return;
        }
        resolve(res as unknown as AsyncIterable<Buffer>);
      });

      req.on("error", (err) => {
        log(`Request error: ${err.message}`);
        resolve(null);
      });
      req.setTimeout(30000, () => {
        log("Request timeout (30s)");
        req.destroy();
        resolve(null);
      });

      req.write(body);
      req.end();
    });
  }
}