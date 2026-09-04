export interface AIProvider {
  readonly name: string;

  generate(
    options: ProviderGenerateOptions
  ): Promise<GenerationResult>;

  stream(
    options: ProviderGenerateOptions
  ): AsyncGenerator<string>;

  embed(
    texts: string[],
    model: string
  ): Promise<number[][]>;
}

export interface ProviderConfig {
  name?: string;
  apiKey: string;
  baseURL: string;
}

export interface AIConfig {

  provider?: ProviderConfig;

  embeddingProvider?: ProviderConfig;

  model?: string;

  embeddingModel?: string;

  knowledgePath?: string;

  dbPath?: string;

  chunkSize?: number;

  chunkOverlap?: number;

  embeddingBatchSize?: number;

  topK?: number;

  temperature?: number;

  maxTokens?: number;

  autoIndex?: boolean;

  vectorSearch?: {
    mode?: "full" | "quantized";
    quantization?: {
      qtype?:
        | "UINT8"
        | "INT8"
        | "1BIT"
        | "TURBO";

      qbits?: 2 | 3 | 4;

      maxMemory?: string;
    };
  };
}

export type ChatRole =
  | "system"
  | "user"
  | "assistant"
  | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface AskOptions {
  system?: string;
  useKnowledge?: boolean;
  topK?: number;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatOptions {
  useKnowledge?: boolean;
  knowledgeQuery?: string;
  topK?: number;
  temperature?: number;
  maxTokens?: number;
}

export interface GenerateOptions {
  system?: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}

export interface SearchResult {
  id: number;
  text: string;
  source: string;
  chunkIndex: number;
  distance: number;
  score: number;
}

export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface GenerationResult {
  text: string;
  usage?: Usage;
}

export interface IndexResult {
  added: string[];
  updated: string[];
  unchanged: string[];
  removed: string[];

  errors: Array<{
    file: string;
    error: string;
  }>;
}

export interface IndexStateEntry {
  hash: string;
  size: number;
  modifiedAt: number;
}

export type IndexState =
  Record<string, IndexStateEntry>;

export interface ProviderGenerateOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface VectorDocument {
  text: string;
  source: string;
  chunkIndex: number;
  embedding: number[];
}