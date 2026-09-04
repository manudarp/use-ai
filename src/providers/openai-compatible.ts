import OpenAI from "openai";

import type {
  AIProvider,
  ChatMessage,
  GenerationResult,
  ProviderGenerateOptions
} from "../types.js";

import {
  AIProviderError
} from "../errors.js";

export interface OpenAICompatibleConfig {
  name?: string;
  apiKey: string;
  baseURL: string;
}

function convertMessages(
  messages: ChatMessage[]
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {

  return messages.map(
    message => {

      switch (message.role) {

        case "system":

          return {
            role: "system",
            content: message.content
          };

        case "user":

          return {
            role: "user",
            content: message.content
          };

        case "assistant":

          return {
            role: "assistant",
            content: message.content
          };

        case "tool":

          return {
            role: "tool",
            content: message.content,
            tool_call_id:
              message.toolCallId ?? ""
          };

        default:

          throw new AIProviderError(
            `Unsupported message role: ${message.role}`
          );
      }
    }
  );
}

export class OpenAICompatibleProvider
  implements AIProvider {

  readonly name: string;

  private readonly client: OpenAI;

  constructor(
    config: OpenAICompatibleConfig
  ) {

    if (!config.apiKey) {

      throw new AIProviderError(
        "API key is missing."
      );
    }

    if (!config.baseURL) {

      throw new AIProviderError(
        "baseURL is missing."
      );
    }

    this.name =
      config.name ??
      "openai-compatible";

    this.client =
      new OpenAI({
        apiKey:
          config.apiKey,

        baseURL:
          config.baseURL
      });
  }

  async generate(
    options: ProviderGenerateOptions
  ): Promise<GenerationResult> {

    try {

      const response =
        await this.client.chat.completions.create({

          model:
            options.model,

          messages:
            convertMessages(
              options.messages
            ),

          temperature:
            options.temperature,

          max_tokens:
            options.maxTokens
        });

      return {

        text:
          response
            .choices[0]
            ?.message
            ?.content ?? "",

        usage:
          response.usage
            ? {

                promptTokens:
                  response.usage.prompt_tokens,

                completionTokens:
                  response.usage
                    .completion_tokens,

                totalTokens:
                  response.usage
                    .total_tokens
              }

            : undefined
      };

    } catch (error) {

      throw new AIProviderError(
        this.formatError(
          "Generation failed",
          error
        )
      );
    }
  }

  async *stream(
    options: ProviderGenerateOptions
  ): AsyncGenerator<string> {

    try {

      const stream =
        await this.client
          .chat
          .completions
          .create({

            model:
              options.model,

            messages:
              convertMessages(
                options.messages
              ),

            temperature:
              options.temperature,

            max_tokens:
              options.maxTokens,

            stream:
              true
          });

      for await (
        const chunk of stream
      ) {

        const content =
          chunk
            .choices[0]
            ?.delta
            ?.content;

        if (content) {
          yield content;
        }
      }

    } catch (error) {

      throw new AIProviderError(
        this.formatError(
          "Streaming failed",
          error
        )
      );
    }
  }

  async embed(
    texts: string[],
    model: string
  ): Promise<number[][]> {

    if (
      texts.length === 0
    ) {
      return [];
    }

    try {

      const response =
        await this.client
          .embeddings
          .create({

            model,

            input:
              texts
          });

      return response.data
        .sort(
          (a, b) =>
            a.index - b.index
        )
        .map(
          item =>
            item.embedding
        );

    } catch (error) {

      throw new AIProviderError(
        this.formatError(
          "Embedding failed",
          error
        )
      );
    }
  }

  private formatError(
    prefix: string,
    error: unknown
  ): string {

    if (
      error instanceof Error
    ) {

      return `${prefix}: ${error.message}`;
    }

    return `${prefix}.`;
  }
}