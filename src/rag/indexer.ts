import type {
  IndexResult
} from "../types.js";

import type {
  KnowledgeBase
} from "./knowledge-base.js";

export async function indexKnowledgeBase(
  knowledgeBase: KnowledgeBase
): Promise<IndexResult> {

  return knowledgeBase.index();
}

export async function reindexKnowledgeBase(
  knowledgeBase: KnowledgeBase
): Promise<IndexResult> {

  return knowledgeBase.reindex();
}