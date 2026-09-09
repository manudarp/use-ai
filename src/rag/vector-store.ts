import Database from "better-sqlite3";

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

  /**
   * Quantizzazione accettata solo per retrocompatibilità.
   * Ignorata dal backend JavaScript: la quantizzazione
   * nativa di sqlite-vector non è più disponibile.
   */
  quantization?: {
    qtype?:
      | "UINT8"
      | "INT8"
      | "1BIT"
      | "TURBO";

    qbits?: 2 | 3 | 4;

    maxMemory?: string;
  };

  /**
   * Attiva la cache dei vettori in memoria.
   * Consigliata solo per knowledge base con decine di migliaia
   * di chunk: la cache vive nel heap del processo, con 4 byte
   * per dimensione per chunk (≈ 600 MB per 100k chunk a 1536d,
   * soglia critica su architetture ia32, ~1,7/2 GB totali).
   * Default: false.
   */
  useVectorCache?:
    boolean;
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

const DIMENSION_KEY =
  "embedding_dimension";

export class SQLiteVectorStore {

  private readonly db:
    Database.Database;

  private readonly useVectorCache:
    boolean = false;

  private dimension:
    number | null = null;

  private vectorsCache:
    Float32Array[] | null = null;

  private vectorsIds:
    number[] | null = null;

  constructor(
    options: SQLiteVectorStoreOptions
  ) {

    this.db =
      new Database(
        options.dbPath
      );

    if (
      options.searchMode ===
        "quantized" ||
      options.quantization
    ) {

      console.warn(
        "[use-ai] Quantized search is not supported by the JavaScript vector backend; falling back to full scan."
      );
    }

    this.db.pragma(
      "journal_mode = WAL"
    );

    this.db.pragma(
      "foreign_keys = ON"
    );

    this.createSchema();

    this.restoreVectorConfiguration();
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
          @embedding
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

    this.invalidateCache();
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

    this.invalidateCache();
  }

  clear(): void {

    this.db.exec(`
      DELETE FROM documents;
    `);

    this.invalidateCache();
  }

  search(
    vector: number[],
    topK: number
  ): VectorSearchResult[] {

    if (
      this.dimension === null ||
      this.count === 0
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

    return this.searchFull(
      this.toFloat32Buffer(
        vector
      ),
      topK
    );
  }

  private searchFull(
    query: Buffer,
    topK: number
  ): VectorSearchResult[] {

    const queryVector =
      new Float32Array(
        query.buffer,
        query.byteOffset,
        query.length / 4
      );

    let scored:
      Array<{
        id: number;
        distance: number;
      }>;

    if (
      this.useVectorCache
    ) {

      if (
        this.vectorsCache === null
      ) {
        this.loadVectors();
      }

      scored =
        this.vectorsCache!
          .map(
            (vector, index) => ({

              id:
                this.vectorsIds![
                  index
                ],

              distance:
                cosineDistanceVectors(
                  queryVector,
                  vector
                )
            })
          );

    } else {

      const rows =
        this.db
          .prepare(`
            SELECT

              id,

              text,

              source,

              chunk_index,

              embedding

            FROM documents
          `)
          .all() as Array<{
            id: number;
            text: string;
            source: string;
            chunk_index: number;
            embedding: Buffer;
          }>;

      scored =
        rows.map(
          row => ({

            id:
              row.id,

            distance:
              cosineDistance(
                query,
                row.embedding
              )
          })
        );
    }

    scored.sort(
      (a, b) =>
        a.distance -
        b.distance
    );

    const top =
      scored.slice(
        0,
        topK
      );

    /*
     * Il testo lo recuperiamo SOLO per i vincitori:
     * con la cache attiva non è mai stato caricato in memoria.
     */

    return top.map(
      item => {

        const row =
          this.db
            .prepare(`
              SELECT

                text,

                source,

                chunk_index

              FROM documents
              WHERE id = ?
            `)
            .get(
              item.id
            ) as {
              text: string;
              source: string;
              chunk_index: number;
            };

        return {

          id:
            item.id,

          text:
            row.text,

          source:
            row.source,

          chunkIndex:
            row.chunk_index,

          distance:
            item.distance
        };
      }
    );
  }

  /*
   * Carica una volta sola tutti i vettori in memoria.
   * Da chiamare al primo utilizzo della cache e ogni
   * volta che questa viene invalidata.
   */
  private loadVectors(): void {

    const rows =
      this.db
        .prepare(`
          SELECT

            id,

            embedding

          FROM documents
        `)
        .all() as Array<{
          id: number;
          embedding: Buffer;
        }>;

    this.vectorsIds =
      rows.map(
        row =>
          row.id
      );

    this.vectorsCache =
      rows.map(
        row =>
          new Float32Array(
            row.embedding.buffer,
            row.embedding.byteOffset,
            row.embedding.length / 4
          )
      );
  }

  /*
   * Svuota la cache: la successiva search() ricaricherà
   * i vettori dal database. Chiamata dopo ogni modifica
   * ai dati (add, removeSource, clear).
   */
  private invalidateCache(): void {

    this.vectorsCache =
      null;

    this.vectorsIds =
      null;
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
    return "javascript-full-scan";
  }

  get vectorVersion(): string | null {
    return null;
  }

  close(): void {

    this.db.close();
  }
}

function cosineDistance(
  a: Buffer,
  b: Buffer
): number {

  const left =
    new Float32Array(
      a.buffer,
      a.byteOffset,
      a.length / 4
    );

  const right =
    new Float32Array(
      b.buffer,
      b.byteOffset,
      b.length / 4
    );

  return cosineDistanceVectors(
    left,
    right
  );
}

function cosineDistanceVectors(
  left: Float32Array,
  right: Float32Array
): number {

  if (
    left.length !==
    right.length
  ) {

    throw new KnowledgeBaseError(
      `Cosine distance dimension mismatch: ${left.length} vs ${right.length}.`
    );
  }

  let dot = 0;
  let normLeft = 0;
  let normRight = 0;

  for (
    let i = 0;
    i < left.length;
    i++
  ) {

    dot +=
      left[i] *
      right[i];

    normLeft +=
      left[i] *
      left[i];

    normRight +=
      right[i] *
      right[i];
  }

  if (
    normLeft === 0 ||
    normRight === 0
  ) {
    return 1;
  }

  return 1 -
    dot /
    (Math.sqrt(normLeft) * Math.sqrt(normRight));
}