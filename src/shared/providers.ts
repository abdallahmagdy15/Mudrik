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
 * Shape of OpenCode's `auth.json` — a flat map of provider → credential.
 * Values are kept narrow (`type: "api"` is the only kind we manage from
 * Mudrik). OAuth-style entries written by `opencode auth login` use the
 * same shape with `type: "oauth"` and an `access`/`refresh` pair; we only
 * touch entries whose type is `"api"` to avoid trampling on those.
 */
export interface OpenCodeAuthEntry {
  type: string;
  key?: string;
  [k: string]: unknown;
}
export type OpenCodeAuthFile = Record<string, OpenCodeAuthEntry>;

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

/**
 * Windows-essential env vars that any child process needs to run correctly
 * (DLL search path, temp dirs, user profile resolution). Inheriting the full
 * Electron `process.env` into Bun-compiled children (OpenCode 1.14.x and up)
 * triggers a Bun segfault on Windows — somewhere in the Electron/Chromium-
 * injected vars there's a value Bun can't parse during startup. Passing only
 * these keys sidesteps the issue.
 *
 * The filter also scrubs `ELECTRON_RUN_AS_NODE`, `ATOM_*`, and `CHROME_*`
 * noise that OpenCode has no business seeing.
 */
const WINDOWS_ESSENTIAL_ENV_VARS: readonly string[] = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  "COMSPEC",
  "USERPROFILE",
  "USERNAME",
  "USERDOMAIN",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "COMMONPROGRAMFILES",
  "TEMP",
  "TMP",
  "COMPUTERNAME",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "NUMBER_OF_PROCESSORS",
  "OS",
  // OpenCode honours XDG locations for config/data on all platforms.
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  // User-set override for the OpenCode binary path.
  "OPENCODE_BIN_PATH",
];

/**
 * Build a minimal env for spawning the OpenCode binary from Electron. Copies
 * only Windows-essential vars + any `*_API_KEY` keys already in the shell,
 * then layers provider API keys from `apiKeys` on top. Shell-provided keys
 * still win.
 *
 * Use this instead of `buildProviderEnv` wherever you spawn OpenCode — the
 * latter is kept for anywhere else that needs the full env passthrough.
 */
export function buildCleanOpenCodeEnv(
  baseEnv: NodeJS.ProcessEnv,
  apiKeys: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  // 1. Whitelist essential Windows env vars.
  for (const key of WINDOWS_ESSENTIAL_ENV_VARS) {
    const val = baseEnv[key];
    if (val !== undefined) out[key] = val;
  }
  // 2. Preserve any existing *_API_KEY from the shell so user overrides still work.
  for (const key of Object.keys(baseEnv)) {
    if (/_API_KEY$/.test(key) && baseEnv[key]) {
      out[key] = baseEnv[key];
    }
  }
  // 3. Layer in config-stored provider keys (shell values above take precedence).
  if (apiKeys) {
    for (const [provider, key] of Object.entries(apiKeys)) {
      if (!key) continue;
      const envName = envVarForProvider(provider);
      if (!out[envName]) out[envName] = key;
    }
  }
  return out;
}
