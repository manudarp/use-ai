import Database from "better-sqlite3";

import {
  getExtensionPath
} from "@sqliteai/sqlite-vector";

import {
  KnowledgeBaseError
} from "../errors.js";

import type {
  VectorDocument
} from "../types.js";

export interface SQLiteVectorStoreOptions {

  dbPath: string;

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

export interface VectorSearchResult {

  id: number;

  text: string;

  source: string;

  chunkIndex: number;

  distance: number;
}

const TABLE_NAME =
  "documents";

const VECTOR_COLUMN =
  "embedding";

const DIMENSION_KEY =
  "embedding_dimension";

export class SQLiteVectorStore {

  private readonly db:
    Database.Database;

  private readonly searchMode:
    "full" | "quantized";

  private readonly quantization:
    SQLiteVectorStoreOptions["quantization"];

  private dimension:
    number | null = null;

  private vectorInitialized =
    false;

  constructor(
    options: SQLiteVectorStoreOptions
  ) {

    this.searchMode =
      options.searchMode ??
      "full";

    this.quantization =
      options.quantization;

    this.db =
      new Database(
        options.dbPath
      );

    this.db.pragma(
      "journal_mode = WAL"
    );

    this.db.pragma(
      "foreign_keys = ON"
    );

    this.loadExtension();

    this.createSchema();

    this.restoreVectorConfiguration();
  }

  private loadExtension(): void {

    try {

      this.db.loadExtension(
        getExtensionPath()
      );

    } catch (error) {

      throw new KnowledgeBaseError(
        `Unable to load sqlite-vector: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`
      );
    }
  }

  private createSchema(): void {

    this.db.exec(`

      CREATE TABLE IF NOT EXISTS documents (

        id INTEGER PRIMARY KEY,

        source TEXT NOT NULL,

        chunk_index INTEGER NOT NULL,

        text TEXT NOT NULL,

        embedding BLOB NOT NULL,

        UNIQUE(source, chunk_index)
      );

      CREATE INDEX IF NOT EXISTS
        idx_documents_source
      ON documents(source);

      CREATE TABLE IF NOT EXISTS metadata (

        key TEXT PRIMARY KEY,

        value TEXT NOT NULL
      );

    `);
  }

  private restoreVectorConfiguration(): void {

    const dimension =
      this.getMetadata(
        DIMENSION_KEY
      );

    if (!dimension) {
      return;
    }

    this.dimension =
      Number(dimension);

    this.initializeVector();
  }

  private getMetadata(
    key: string
  ): string | null {

    const row =
      this.db
        .prepare(`
          SELECT value
          FROM metadata
          WHERE key = ?
        `)
        .get(key) as
        | { value: string }
        | undefined;

    return row?.value ?? null;
  }

  private setMetadata(
    key: string,
    value: string
  ): void {

    this.db
      .prepare(`
        INSERT INTO metadata (
          key,
          value
        )
        VALUES (?, ?)

        ON CONFLICT(key)
        DO UPDATE SET
          value = excluded.value
      `)
      .run(
        key,
        value
      );
  }

  private initializeVector(): void {

    if (
      this.vectorInitialized ||
      this.dimension === null
    ) {
      return;
    }

    try {

      this.db
        .prepare(`
          SELECT vector_init(
            ?,
            ?,
            ?
          )
        `)
        .get(
          TABLE_NAME,
          VECTOR_COLUMN,
          `dimension=${this.dimension},type=FLOAT32,distance=COSINE`
        );

      this.vectorInitialized =
        true;

    } catch (error) {

      throw new KnowledgeBaseError(
        `Unable to initialize sqlite-vector: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`
      );
    }
  }

  private ensureDimension(
    vector: number[]
  ): void {

    if (
      vector.length === 0
    ) {

      throw new KnowledgeBaseError(
        "Embedding vector is empty."
      );
    }

    if (
      this.dimension === null
    ) {

      this.dimension =
        vector.length;

      this.setMetadata(
        DIMENSION_KEY,
        String(
          this.dimension
        )
      );

      this.initializeVector();

      return;
    }

    if (
      vector.length !==
      this.dimension
    ) {

      throw new KnowledgeBaseError(
        `Embedding dimension mismatch. Expected ${this.dimension}, received ${vector.length}.`
      );
    }
  }

  private toFloat32Buffer(
    vector: number[]
  ): Buffer {

    return Buffer.from(
      new Float32Array(
        vector
      ).buffer
    );
  }

  add(
    documents: VectorDocument[]
  ): void {

    if (
      documents.length === 0
    ) {
      return;
    }

    this.ensureDimension(
      documents[0].embedding
    );

    for (
      const document of documents
    ) {

      this.ensureDimension(
        document.embedding
      );
    }

    const statement =
      this.db.prepare(`
        INSERT INTO documents (
          source,
          chunk_index,
          text,
          embedding
        )
        VALUES (
          @source,
          @chunkIndex,
          @text,
          vector_as_f32(@embedding)
        )

        ON CONFLICT (
          source,
          chunk_index
        )
        DO UPDATE SET

          text =
            excluded.text,

          embedding =
            excluded.embedding
      `);

    const transaction =
      this.db.transaction(
        (
          rows: VectorDocument[]
        ) => {

          for (
            const row of rows
          ) {

            statement.run({

              source:
                row.source,

              chunkIndex:
                row.chunkIndex,

              text:
                row.text,

              embedding:
                this.toFloat32Buffer(
                  row.embedding
                )
            });
          }
        }
      );

    transaction(
      documents
    );
  }

  removeSource(
    source: string
  ): void {

    this.db
      .prepare(`
        DELETE FROM documents
        WHERE source = ?
      `)
      .run(source);
  }

  clear(): void {

    this.db.exec(`
      DELETE FROM documents;
    `);
  }

  search(
    vector: number[],
    topK: number
  ): VectorSearchResult[] {

    if (
      !this.vectorInitialized
    ) {
      return [];
    }

    if (
      vector.length !==
      this.dimension
    ) {

      throw new KnowledgeBaseError(
        `Query embedding has dimension ${vector.length}, expected ${this.dimension}.`
      );
    }

    const query =
      this.toFloat32Buffer(
        vector
      );

    if (
      this.searchMode ===
      "quantized"
    ) {

      this.ensureQuantization();

      return this.searchQuantized(
        query,
        topK
      );
    }

    return this.searchFull(
      query,
      topK
    );
  }

  private searchFull(
    vector: Buffer,
    topK: number
  ): VectorSearchResult[] {

    const rows =
      this.db
        .prepare(`
          SELECT

            d.id,

            d.text,

            d.source,

            d.chunk_index,

            v.distance

          FROM vector_full_scan(
            'documents',
            'embedding',
            ?,
            ?
          ) AS v

          JOIN documents AS d
            ON d.rowid = v.rowid
        `)
        .all(
          vector,
          topK
        ) as Array<{
          id: number;
          text: string;
          source: string;
          chunk_index: number;
          distance: number;
        }>;

    return rows.map(
      row => ({

        id:
          row.id,

        text:
          row.text,

        source:
          row.source,

        chunkIndex:
          row.chunk_index,

        distance:
          row.distance
      })
    );
  }

  private searchQuantized(
    vector: Buffer,
    topK: number
  ): VectorSearchResult[] {

    const rows =
      this.db
        .prepare(`
          SELECT

            d.id,

            d.text,

            d.source,

            d.chunk_index,

            v.distance

          FROM vector_quantize_scan(
            'documents',
            'embedding',
            ?,
            ?
          ) AS v

          JOIN documents AS d
            ON d.rowid = v.rowid
        `)
        .all(
          vector,
          topK
        ) as Array<{
          id: number;
          text: string;
          source: string;
          chunk_index: number;
          distance: number;
        }>;

    return rows.map(
      row => ({

        id:
          row.id,

        text:
          row.text,

        source:
          row.source,

        chunkIndex:
          row.chunk_index,

        distance:
          row.distance
      })
    );
  }

  private ensureQuantization(): void {

    try {

      const options =
        this.quantization;

      const parts: string[] = [];

      if (
        options?.qtype
      ) {

        parts.push(
          `qtype=${options.qtype}`
        );
      }

      if (
        options?.qbits
      ) {

        parts.push(
          `qbits=${options.qbits}`
        );
      }

      if (
        options?.maxMemory
      ) {

        parts.push(
          `max_memory=${options.maxMemory}`
        );
      }

      const optionString =
        parts.join(",");

      this.db
        .prepare(`
          SELECT vector_quantize(
            ?,
            ?,
            ?
          )
        `)
        .get(
          TABLE_NAME,
          VECTOR_COLUMN,
          optionString
        );

      this.db
        .prepare(`
          SELECT vector_quantize_preload(
            ?,
            ?
          )
        `)
        .get(
          TABLE_NAME,
          VECTOR_COLUMN
        );

    } catch (error) {

      throw new KnowledgeBaseError(
        `Unable to prepare vector quantization: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`
      );
    }
  }

  get count(): number {

    const row =
      this.db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM documents
        `)
        .get() as {
          count: number;
        };

    return row.count;
  }

  get vectorDimension(): number | null {
    return this.dimension;
  }

  get vectorBackend(): string | null {

    try {

      const row =
        this.db
          .prepare(`
            SELECT vector_backend() AS backend
          `)
          .get() as {
            backend: string;
          };

      return row.backend;

    } catch {

      return null;
    }
  }

  get vectorVersion(): string | null {

    try {

      const row =
        this.db
          .prepare(`
            SELECT vector_version() AS version
          `)
          .get() as {
            version: string;
          };

      return row.version;

    } catch {

      return null;
    }
  }

  close(): void {

    this.db.close();
  }
}