import path from "node:path";
import fs from "node:fs";

import {
  OpenAICompatibleProvider
} from "./providers/openai-compatible.js";

import {
  KnowledgeBase
} from "./rag/knowledge-base.js";

import {
  AIConfigurationError
} from "./errors.js";

import type {
  AIConfig,
  AIProvider,
  AskOptions,
  ChatMessage,
  ChatOptions,
  GenerateOptions,
  GenerationResult,
  IndexResult,
  SearchResult,
  ProviderConfig
} from "./types.js";

const DEFAULT_BASE_URL =
  "https://openrouter.ai/api/v1";

const DEFAULT_MODEL =
  "openrouter/free";

const DEFAULT_EMBEDDING_MODEL =
  "liquid/lfm-2.5-embedding-350m:free";

const DEFAULT_CHUNK_SIZE =
  1200;

const DEFAULT_CHUNK_OVERLAP =
  150;

const DEFAULT_TOP_K =
  5;

const DEFAULT_EMBEDDING_BATCH_SIZE =
  32;

export class AI {

  private readonly config:
    Required<
      Pick<
        AIConfig,
        | "model"
        | "embeddingModel"
        | "chunkSize"
        | "chunkOverlap"
        | "topK"
        | "autoIndex"
        | "embeddingBatchSize"
      >
    > &
    AIConfig;

  private readonly provider:
    AIProvider;

  private readonly embeddingProvider:
    AIProvider;

  private readonly knowledgeBase:
    KnowledgeBase | null;

  private initialized =
    false;

  constructor(
    config: AIConfig = {}
  ) {

    this.config = {

      ...config,

      model:
        config.model ??
        process.env.AI_MODEL ??
        DEFAULT_MODEL,

      embeddingModel:
        config.embeddingModel ??
        process.env.AI_EMBEDDING_MODEL ??
        DEFAULT_EMBEDDING_MODEL,

      chunkSize:
        config.chunkSize ??
        DEFAULT_CHUNK_SIZE,

      chunkOverlap:
        config.chunkOverlap ??
        DEFAULT_CHUNK_OVERLAP,

      topK:
        config.topK ??
        DEFAULT_TOP_K,

      autoIndex:
        config.autoIndex ??
        true,

      embeddingBatchSize:
        config.embeddingBatchSize ??
        DEFAULT_EMBEDDING_BATCH_SIZE
    };

    const providerConfig =
      this.resolveProviderConfig(
        config.provider
      );

    this.provider =
      new OpenAICompatibleProvider(
        providerConfig
      );

    const embeddingConfig =
      config.embeddingProvider
        ? this.resolveProviderConfig(
            config.embeddingProvider
          )
        : providerConfig;

    this.embeddingProvider =
      this.isSameProvider(
        providerConfig,
        embeddingConfig
      )
        ? this.provider
        : new OpenAICompatibleProvider(
            embeddingConfig
          );

    if (
      config.knowledgePath
    ) {

      const dbPath =
        config.dbPath ??
        path.join(
          process.cwd(),
          ".ai",
          "ai.sqlite"
        );

      const resolvedDbPath = path.resolve(
        config.dbPath ??
        path.join(process.cwd(), ".ai", "ai.sqlite")
      );

      fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });

      this.knowledgeBase =
        new KnowledgeBase({

          knowledgePath:
            path.resolve(
              config.knowledgePath
            ),

          dbPath:
            path.resolve(
              dbPath
            ),

          embedding:
            texts =>
              this.embeddingProvider.embed(
                texts,
                this.config.embeddingModel
              ),

          chunkSize:
            this.config.chunkSize,

          chunkOverlap:
            this.config.chunkOverlap,

          embeddingBatchSize:
            this.config
              .embeddingBatchSize,

          searchMode:
            config.vectorSearch
              ?.mode ??
            "full",

          quantization:
            config.vectorSearch
              ?.quantization
        });

    } else {

      this.knowledgeBase =
        null;
    }
  }

  private resolveProviderConfig(
    config?: ProviderConfig
  ): ProviderConfig {

    if (config) {

      return {

        name:
          config.name ??
          "openai-compatible",

        apiKey:
          config.apiKey,

        baseURL:
          config.baseURL
      };
    }

    const apiKey =
      process.env.AI_API_KEY ??
      process.env.TOGETHER_API_KEY ??
      process.env.OPENAI_API_KEY;

    if (!apiKey) {

      throw new AIConfigurationError(
        "No API key configured. Pass provider.apiKey or set AI_API_KEY."
      );
    }

    return {

      name:
        "openai-compatible",

      apiKey,

      baseURL:
        process.env.AI_BASE_URL ??
        DEFAULT_BASE_URL
    };
  }

  private isSameProvider(
    a: ProviderConfig,
    b: ProviderConfig
  ): boolean {

    return (
      a.apiKey ===
      b.apiKey &&

      a.baseURL ===
      b.baseURL
    );
  }

  async init(): Promise<IndexResult | null> {

    if (
      this.initialized
    ) {
      return null;
    }

    let result:
      IndexResult | null =
      null;

    if (
      this.knowledgeBase &&
      this.config.autoIndex
    ) {

      result =
        await this.knowledgeBase.index();
    }

    this.initialized =
      true;

    return result;
  }

  async reindex(): Promise<IndexResult> {

    if (
      !this.knowledgeBase
    ) {

      throw new AIConfigurationError(
        "Knowledge base is not configured."
      );
    }

    return this.knowledgeBase.reindex();
  }

  async search(
    query: string,
    topK =
      this.config.topK
  ): Promise<SearchResult[]> {

    if (
      !this.knowledgeBase
    ) {
      return [];
    }

    return this.knowledgeBase.search(
      query,
      topK
    );
  }

  async generate(
    options: GenerateOptions
  ): Promise<string> {

    const messages:
      ChatMessage[] = [];

    if (
      options.system
    ) {

      messages.push({

        role:
          "system",

        content:
          options.system
      });
    }

    messages.push({

      role:
        "user",

      content:
        options.user
    });

    const result:
      GenerationResult =
      await this.provider.generate({

        model:
          this.config.model,

        messages,

        temperature:
          options.temperature ??
          this.config.temperature,

        maxTokens:
          options.maxTokens ??
          this.config.maxTokens
      });

    return result.text;
  }

  async ask(
    question: string,
    options: AskOptions = {}
  ): Promise<string> {

    if (
      !question.trim()
    ) {

      throw new Error(
        "Question cannot be empty."
      );
    }

    const useKnowledge =
      options.useKnowledge ??
      Boolean(
        this.knowledgeBase
      );

    let context = "";

    if (
      useKnowledge &&
      this.knowledgeBase
    ) {

      const results =
        await this.knowledgeBase.search(
          question,
          options.topK ??
          this.config.topK
        );

      context =
        results
          .map(
            (result, index) =>
              [
                `SOURCE ${index + 1}: ${result.source}`,
                result.text
              ].join("\n")
          )
          .join(
            "\n\n---\n\n"
          );
    }

    const systemParts:
      string[] = [];

    if (
      options.system
    ) {

      systemParts.push(
        options.system
      );
    }

    if (context) {

      systemParts.push(`

You are answering a question using a local knowledge base.

Use the supplied context as the primary source of truth.

If the answer cannot be determined from the context,
say clearly that the available knowledge base does not
contain enough information.

Do not invent facts that are not supported by the context.

KNOWLEDGE BASE CONTEXT:

${context}
`);
    }

    return this.generate({

      system:
        systemParts.length
          ? systemParts.join(
              "\n\n"
            )
          : undefined,

      user:
        question,

      temperature:
        options.temperature ??
        this.config.temperature,

      maxTokens:
        options.maxTokens ??
        this.config.maxTokens
    });
  }

  async chat(
    messages: ChatMessage[],
    options: ChatOptions = {}
  ): Promise<string> {

    if (
      messages.length === 0
    ) {

      throw new Error(
        "Chat messages cannot be empty."
      );
    }

    let finalMessages =
      [...messages];

    if (
      options.useKnowledge &&
      this.knowledgeBase
    ) {

      const query =
        options.knowledgeQuery ??
        [...messages]
          .reverse()
          .find(
            message =>
              message.role ===
              "user"
          )
          ?.content ??
        "";

      if (query) {

        const results =
          await this.knowledgeBase.search(
            query,
            options.topK ??
            this.config.topK
          );

        const context =
          results
            .map(
              (result, index) =>
                [
                  `SOURCE ${index + 1}: ${result.source}`,
                  result.text
                ].join("\n")
            )
            .join(
              "\n\n---\n\n"
            );

        if (context) {

          finalMessages = [

            {
              role:
                "system",

              content: `
Use the following local knowledge base when relevant.

Do not invent information that contradicts it.

KNOWLEDGE BASE:

${context}
`
            },

            ...finalMessages
          ];
        }
      }
    }

    const result =
      await this.provider.generate({

        model:
          this.config.model,

        messages:
          finalMessages,

        temperature:
          options.temperature ??
          this.config.temperature,

        maxTokens:
          options.maxTokens ??
          this.config.maxTokens
      });

    return result.text;
  }

  stream(
    user: string,
    options: {
      system?: string;
      temperature?: number;
      maxTokens?: number;
    } = {}
  ): AsyncGenerator<string> {

    const messages:
      ChatMessage[] = [];

    if (
      options.system
    ) {

      messages.push({

        role:
          "system",

        content:
          options.system
      });
    }

    messages.push({

      role:
        "user",

      content:
        user
    });

    return this.provider.stream({

      model:
        this.config.model,

      messages,

      temperature:
        options.temperature ??
        this.config.temperature,

      maxTokens:
        options.maxTokens ??
        this.config.maxTokens
    });
  }

  get model(): string {
    return this.config.model;
  }

  get embeddingModel(): string {
    return this.config.embeddingModel;
  }

  get providerName(): string {
    return this.provider.name;
  }

  get embeddingProviderName(): string {
    return this.embeddingProvider.name;
  }

  get hasKnowledgeBase(): boolean {
    return Boolean(
      this.knowledgeBase
    );
  }

  get knowledgeCount(): number {
    return this.knowledgeBase?.count ?? 0;
  }

  get vectorDimension(): number | null {
    return this.knowledgeBase
      ?.vectorDimension ?? null;
  }

  get vectorBackend(): string | null {
    return this.knowledgeBase
      ?.vectorBackend ?? null;
  }

  get vectorVersion(): string | null {
    return this.knowledgeBase
      ?.vectorVersion ?? null;
  }

  close(): void {
    this.knowledgeBase?.close();
  }
}