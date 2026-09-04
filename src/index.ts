export {
  AI
} from "./client.js";

export {
  AICoreError,
  AIConfigurationError,
  AIProviderError,
  KnowledgeBaseError
} from "./errors.js";

export {
  chunkText
} from "./rag/chunker.js";

export {
  OpenAICompatibleProvider
} from "./providers/openai-compatible.js";

export type {
  OpenAICompatibleConfig
} from "./providers/openai-compatible.js";

export type {
  AIConfig,
  AIProvider,
  ProviderConfig,
  AskOptions,
  ChatMessage,
  ChatOptions,
  GenerateOptions,
  GenerationResult,
  IndexResult,
  SearchResult,
  Usage,
  VectorDocument
} from "./types.js";