/**
 * Provider-to-env-var mapping for OpenCode API keys.
 *
 * OpenCode honours well-known env vars per provider when spawning a run.
 * Mudrik stores user-supplied keys in Config.apiKeys (keyed by provider
 * name, e.g. "anthropic") and injects them as the correct env var name
 * for every OpenCode subprocess.
 *
 * The mapping below covers the common providers. Anything not listed
 * falls back to `UPPERCASED_PROVIDER_API_KEY` — matches the de-facto
 * convention used by most SDKs.
 */

const KNOWN_PROVIDER_ENV_VARS: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  "google-vertex": "GOOGLE_VERTEX_API_KEY",
  groq: "GROQ_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  mistral: "MISTRAL_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  together: "TOGETHER_API_KEY",
  xai: "XAI_API_KEY",
  zai: "ZAI_API_KEY",
  "zai-coding-plan": "ZAI_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  cohere: "COHERE_API_KEY",
  azure: "AZURE_API_KEY",
  bedrock: "AWS_ACCESS_KEY_ID",
  ollama: "OLLAMA_API_KEY",
};

/** Returns the env-var name that OpenCode reads for a given provider. */
export function envVarForProvider(provider: string): string {
  const normalized = provider.toLowerCase().trim();
  if (KNOWN_PROVIDER_ENV_VARS[normalized]) {
    return KNOWN_PROVIDER_ENV_VARS[normalized];
  }
  return normalized.toUpperCase().replace(/[^A-Z0-9]/g, "_") + "_API_KEY";
}

/** Extracts the provider segment from a `provider/model` identifier. */
export function providerFromModelId(modelId: string): string {
  const slash = modelId.indexOf("/");
  return slash === -1 ? modelId : modelId.slice(0, slash);
}

/**
 * Merges the apiKeys map into the current environment, returning a new
 * env object suitable for passing to `spawn`'s `env` option. Existing env
 * vars in `baseEnv` take precedence — a user's shell-level key wins over
 * anything we store, so they can override without editing config.
 */
export function buildProviderEnv(
  baseEnv: NodeJS.ProcessEnv,
  apiKeys: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...baseEnv };
  if (!apiKeys) return out;
  for (const [provider, key] of Object.entries(apiKeys)) {
    if (!key) continue;
    const envName = envVarForProvider(provider);
    if (!out[envName]) out[envName] = key;
  }
  return out;
}
