import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import {
  chunkText
} from "./chunker.js";

import {
  SQLiteVectorStore
} from "./vector-store.js";

import {
  KnowledgeBaseError
} from "../errors.js";

import type {
  IndexResult,
  IndexState,
  SearchResult,
  VectorDocument
} from "../types.js";

export interface KnowledgeBaseOptions {

  knowledgePath: string;

  dbPath: string;

  embedding: (
    texts: string[]
  ) => Promise<number[][]>;

  chunkSize?: number;

  chunkOverlap?: number;

  embeddingBatchSize?: number;

  searchMode?:
    | "full"
    | "quantized";

  quantization?: {
    qtype?:
      | "UINT8"
      | "INT8"
      | "1BIT"
      | "TURBO";

    qbits?: 2 | 3 | 4;

    maxMemory?: string;
  };
}

const INDEX_STATE_FILE =
  "index-state.json";

const SUPPORTED_EXTENSIONS =
  new Set([
    ".txt",
    ".md",
    ".markdown",
    ".json"
  ]);

export class KnowledgeBase {

  private readonly options:
    KnowledgeBaseOptions;

  private readonly vectorStore:
    SQLiteVectorStore;

  constructor(
    options: KnowledgeBaseOptions
  ) {

    this.options =
      options;

    this.vectorStore =
      new SQLiteVectorStore({

        dbPath:
          options.dbPath,

        searchMode:
          options.searchMode,

        quantization:
          options.quantization
      });
  }

  private async ensureDirectories(): Promise<void> {

    await fs.mkdir(
      this.options.knowledgePath,
      {
        recursive: true
      }
    );

    await fs.mkdir(
      path.dirname(
        this.options.dbPath
      ),
      {
        recursive: true
      }
    );
  }

  private statePath(): string {

    return path.join(
      path.dirname(
        this.options.dbPath
      ),
      INDEX_STATE_FILE
    );
  }

  private async loadState(): Promise<IndexState> {

    try {

      const content =
        await fs.readFile(
          this.statePath(),
          "utf8"
        );

      return JSON.parse(
        content
      ) as IndexState;

    } catch {

      return {};
    }
  }

  private async saveState(
    state: IndexState
  ): Promise<void> {

    await fs.writeFile(
      this.statePath(),
      JSON.stringify(
        state,
        null,
        2
      ),
      "utf8"
    );
  }

  private async listFiles(): Promise<string[]> {

    await this.ensureDirectories();

    const entries =
      await fs.readdir(
        this.options.knowledgePath,
        {
          withFileTypes: true
        }
      );

    return entries
      .filter(
        entry =>
          entry.isFile() &&
          SUPPORTED_EXTENSIONS.has(
            path.extname(
              entry.name
            ).toLowerCase()
          )
      )
      .map(
        entry =>
          entry.name
      );
  }

  private async readFile(
    filename: string
  ): Promise<string> {

    const filePath =
      path.join(
        this.options.knowledgePath,
        filename
      );

    const content =
      await fs.readFile(
        filePath,
        "utf8"
      );

    if (
      path.extname(
        filename
      ).toLowerCase() ===
      ".json"
    ) {

      try {

        return JSON.stringify(
          JSON.parse(
            content
          ),
          null,
          2
        );

      } catch {

        return content;
      }
    }

    return content;
  }

  private async hashFile(
    filePath: string
  ): Promise<string> {

    const buffer =
      await fs.readFile(
        filePath
      );

    return createHash(
      "sha256"
    )
      .update(buffer)
      .digest("hex");
  }

  private async indexFile(
    filename: string
  ): Promise<void> {

    const content =
      await this.readFile(
        filename
      );

    const chunks =
      chunkText(
        content,
        {
          chunkSize:
            this.options.chunkSize,

          overlap:
            this.options.chunkOverlap
        }
      );

    if (
      chunks.length === 0
    ) {
      return;
    }

    const batchSize =
      this.options
        .embeddingBatchSize ??
      32;

    const documents:
      VectorDocument[] = [];

    for (
      let start = 0;
      start < chunks.length;
      start += batchSize
    ) {

      const batch =
        chunks.slice(
          start,
          start + batchSize
        );

      const embeddings =
        await this.options.embedding(
          batch.map(
            chunk =>
              chunk.text
          )
        );

      if (
        embeddings.length !==
        batch.length
      ) {

        throw new KnowledgeBaseError(
          `Embedding count mismatch for ${filename}.`
        );
      }

      for (
        let i = 0;
        i < batch.length;
        i++
      ) {

        documents.push({

          text:
            batch[i].text,

          source:
            filename,

          chunkIndex:
            batch[i].index,

          embedding:
            embeddings[i]
        });
      }
    }

    this.vectorStore.add(
      documents
    );
  }

  async index(): Promise<IndexResult> {

    const previousState =
      await this.loadState();

    const nextState:
      IndexState = {};

    const result:
      IndexResult = {

        added: [],

        updated: [],

        unchanged: [],

        removed: [],

        errors: []
      };

    const files =
      await this.listFiles();

    const current =
      new Set(files);

    /*
     * Deleted files
     */

    for (
      const filename of
      Object.keys(previousState)
    ) {

      if (
        !current.has(
          filename
        )
      ) {

        try {

          this.vectorStore
            .removeSource(
              filename
            );

          result.removed.push(
            filename
          );

        } catch (error) {

          result.errors.push({

            file:
              filename,

            error:
              this.errorMessage(
                error
              )
          });

          nextState[
            filename
          ] =
            previousState[
              filename
            ];
        }
      }
    }

    /*
     * Current files
     */

    for (
      const filename of files
    ) {

      try {

        const filePath =
          path.join(
            this.options.knowledgePath,
            filename
          );

        const stat =
          await fs.stat(
            filePath
          );

        const hash =
          await this.hashFile(
            filePath
          );

        const previous =
          previousState[
            filename
          ];

        const unchanged =
          previous &&
          previous.hash === hash &&
          previous.size === stat.size &&
          previous.modifiedAt ===
            stat.mtimeMs;

        if (
          unchanged
        ) {

          nextState[
            filename
          ] =
            previous;

          result.unchanged.push(
            filename
          );

          continue;
        }

        const updated =
          Boolean(previous);

        if (
          updated
        ) {

          this.vectorStore
            .removeSource(
              filename
            );
        }

        await this.indexFile(
          filename
        );

        nextState[
          filename
        ] = {

          hash,

          size:
            stat.size,

          modifiedAt:
            stat.mtimeMs
        };

        if (
          updated
        ) {

          result.updated.push(
            filename
          );

        } else {

          result.added.push(
            filename
          );
        }

      } catch (error) {

        result.errors.push({

          file:
            filename,

          error:
            this.errorMessage(
              error
            )
        });

        if (
          previousState[
            filename
          ]
        ) {

          nextState[
            filename
          ] =
            previousState[
              filename
            ];
        }
      }
    }

    await this.saveState(
      nextState
    );

    return result;
  }

  async reindex(): Promise<IndexResult> {

    this.vectorStore.clear();

    await this.saveState({});

    return this.index();
  }

  async search(
    query: string,
    topK = 5
  ): Promise<SearchResult[]> {

    if (
      !query.trim()
    ) {
      return [];
    }

    const [embedding] =
      await this.options.embedding([
        query
      ]);

    if (!embedding) {
      return [];
    }

    const results =
      this.vectorStore.search(
        embedding,
        topK
      );

    return results.map(
      result => ({

        id:
          result.id,

        text:
          result.text,

        source:
          result.source,

        chunkIndex:
          result.chunkIndex,

        distance:
          result.distance,

        score:
          1 - result.distance
      })
    );
  }

  get count(): number {

    return this.vectorStore.count;
  }

  get vectorDimension(): number | null {

    return this.vectorStore
      .vectorDimension;
  }

  get vectorBackend(): string | null {

    return this.vectorStore
      .vectorBackend;
  }

  get vectorVersion(): string | null {

    return this.vectorStore
      .vectorVersion;
  }

  close(): void {

    this.vectorStore.close();
  }

  private errorMessage(
    error: unknown
  ): string {

    if (
      error instanceof Error
    ) {

      return error.message;
    }

    return String(error);
  }
}