import { Ollama, Message } from "ollama";
import { Config } from "../shared/types";

const log = (msg: string) => console.log(`[OLLAMA] ${msg}`);

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class OllamaClient {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    log(`Client created: model=${config.model}, ollamaUrl=${config.ollamaUrl}, apiKey=${process.env.OLLAMA_API_KEY ? "set" : "not set"}`);
  }

  updateConfig(config: Config): void {
    this.config = config;
    log(`Config updated: model=${config.model}, ollamaUrl=${config.ollamaUrl}`);
  }

  private isCloudModel(model: string): boolean {
    return model.endsWith(":cloud");
  }

  private createClient(model: string): Ollama {
    if (this.isCloudModel(model)) {
      log("Using Ollama cloud (ollama.com)");
      return new Ollama({
        host: "https://ollama.com",
        headers: {
          Authorization: "Bearer " + (process.env.OLLAMA_API_KEY || ""),
        },
      });
    }

    log(`Using local Ollama at ${this.config.ollamaUrl}`);
    return new Ollama({ host: this.config.ollamaUrl });
  }

  async *chatStream(
    messages: OllamaMessage[]
  ): AsyncGenerator<string, void, unknown> {
    const model = this.config.model;
    const isCloud = this.isCloudModel(model);
    log(`chatStream: model="${model}", isCloud=${isCloud}, messages=${messages.length}`);

    const client = this.createClient(model);

    const ollamaMessages: Message[] = messages.map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    }));

    try {
      log(`Calling ollama.chat with model="${model}", stream=true`);
      const response = await client.chat({
        model,
        messages: ollamaMessages,
        stream: true,
      });

      let tokenCount = 0;
      for await (const part of response) {
        if (part.message?.content) {
          tokenCount++;
          yield part.message.content;
        }
      }
      log(`Stream complete, total tokens yielded: ${tokenCount}`);
    } catch (err: any) {
      log(`ERROR: ${err.message}`);
      if (err.message?.includes("connect") || err.message?.includes("ECONNREFUSED")) {
        yield "[Error: Could not connect to Ollama. Is it running?]";
      } else if (err.message?.includes("401") || err.message?.includes("Unauthorized")) {
        yield "[Error: Ollama cloud auth failed. Check your OLLAMA_API_KEY env var.]";
      } else {
        yield `[Error: ${err.message}]`;
      }
    }
  }
}