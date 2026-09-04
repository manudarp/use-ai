export interface Chunk {
  text: string;
  index: number;
}

export interface ChunkOptions {
  chunkSize?: number;
  overlap?: number;
}

export function chunkText(
  text: string,
  options: ChunkOptions = {}
): Chunk[] {

  const chunkSize =
    options.chunkSize ?? 1200;

  const overlap =
    options.overlap ?? 150;

  if (
    chunkSize <= 0
  ) {

    throw new Error(
      "chunkSize must be greater than 0."
    );
  }

  if (
    overlap < 0 ||
    overlap >= chunkSize
  ) {

    throw new Error(
      "overlap must be >= 0 and smaller than chunkSize."
    );
  }

  const normalized =
    text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .trim();

  if (!normalized) {
    return [];
  }

  const chunks: Chunk[] = [];

  let start = 0;
  let index = 0;

  while (
    start < normalized.length
  ) {

    const maximumEnd =
      Math.min(
        start + chunkSize,
        normalized.length
      );

    let end =
      maximumEnd;

    if (
      maximumEnd <
      normalized.length
    ) {

      const window =
        normalized.slice(
          start,
          maximumEnd
        );

      const paragraph =
        window.lastIndexOf(
          "\n\n"
        );

      const sentence =
        Math.max(
          window.lastIndexOf(". "),
          window.lastIndexOf("! "),
          window.lastIndexOf("? "),
          window.lastIndexOf("\n")
        );

      if (
        paragraph >
        chunkSize * 0.5
      ) {

        end =
          start +
          paragraph +
          2;

      } else if (
        sentence >
        chunkSize * 0.5
      ) {

        end =
          start +
          sentence +
          1;
      }
    }

    const chunk =
      normalized
        .slice(
          start,
          end
        )
        .trim();

    if (chunk) {

      chunks.push({
        text:
          chunk,

        index
      });

      index++;
    }

    if (
      end >= normalized.length
    ) {
      break;
    }

    start =
      Math.max(
        0,
        end - overlap
      );
  }

  return chunks;
}