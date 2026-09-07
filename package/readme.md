# use-ai

Modulo AI/RAG riutilizzabile per applicazioni **Node.js ed Electron**, progettato per funzionare con qualsiasi API **OpenAI-compatible** e per integrare una knowledge base locale con ricerca semantica.

L'obiettivo del progetto è fornire un'unica interfaccia per:

* chat e generazione testuale;
* streaming delle risposte;
* generazione di embedding;
* indicizzazione automatica di documenti;
* ricerca semantica;
* RAG (Retrieval-Augmented Generation);
* gestione incrementale della knowledge base;
* utilizzo di provider AI differenti senza modificare il codice applicativo.

Il modulo è stato progettato in particolare per applicazioni **Electron Windows**, comprese applicazioni che devono essere distribuite in architettura **IA-32 (x86)**.

---

## Indice

* [Caratteristiche](#caratteristiche)
* [Architettura](#architettura)
* [Struttura del progetto](#struttura-del-progetto)
* [Installazione](#installazione)
* [Configurazione](#configurazione)
* [Provider OpenAI-compatible](#provider-openai-compatible)
* [Utilizzo base](#utilizzo-base)
* [RAG e Knowledge Base](#rag-e-knowledge-base)
* [Indicizzazione](#indicizzazione)
* [Ricerca semantica](#ricerca-semantica)
* [Chat con RAG](#chat-con-rag)
* [Streaming](#streaming)
* [Vector Store](#vector-store)
* [Electron](#electron)
* [Windows IA-32](#windows-ia-32)
* [API](#api)
* [Tipi principali](#tipi-principali)
* [Gestione degli errori](#gestione-degli-errori)
* [Variabili d'ambiente](#variabili-dambiente)
* [Considerazioni sulla sicurezza](#considerazioni-sulla-sicurezza)
* [Performance](#performance)
* [Sviluppo](#sviluppo)
* [Estendere il modulo](#estendere-il-modulo)
* [Limitazioni](#limitazioni)
* [Roadmap](#roadmap)
* [Licenza](#licenza)

---

# Caratteristiche

## Provider indipendente

Il modulo non è legato a un singolo servizio AI.

Qualsiasi servizio che esponga un'API compatibile con OpenAI può essere utilizzato configurando:

```ts
{
  apiKey: "...",
  baseURL: "https://..."
}
```

Questo permette di utilizzare, ad esempio:

* OpenAI;
* Together AI;
* OpenRouter;
* Groq;
* server AI locali;
* LM Studio;
* altri endpoint OpenAI-compatible.

Non è necessario creare un provider specifico per Together AI o per ogni singolo servizio.

---

## LLM ed embedding separabili

Il modello utilizzato per generare le risposte può essere diverso da quello utilizzato per gli embedding.

Esempio:

```text
LLM
OpenAI
    ↓
GPT

Embedding
Together AI
    ↓
multilingual embedding model
```

Questo permette di scegliere separatamente:

* qualità della generazione;
* qualità della ricerca semantica;
* costo;
* velocità.

---

## RAG locale

La knowledge base può essere composta da documenti locali.

Il flusso è:

```text
Documenti
   ↓
Parsing
   ↓
Chunking
   ↓
Embedding
   ↓
Vector Store
   ↓
Ricerca semantica
   ↓
Contesto
   ↓
LLM
   ↓
Risposta
```

Il modello non deve conoscere preventivamente i documenti: il contenuto rilevante viene recuperato durante la richiesta.

---

## Indicizzazione incrementale

Il modulo non deve necessariamente ricalcolare tutti gli embedding ogni volta.

Per ogni file vengono memorizzate informazioni sufficienti a riconoscere se il documento è cambiato.

Indicativamente:

```text
file
 ├── size
 ├── modification time
 └── SHA-256
```

Se il documento non è cambiato, viene mantenuto l'indice esistente.

Se viene modificato:

```text
vecchi chunk
     ↓
rimozione
     ↓
nuovo parsing
     ↓
nuovi embedding
     ↓
nuovi chunk
```

---

# Architettura

L'architettura principale è composta da tre livelli.

```text
┌─────────────────────────────────────┐
│               AI Core               │
│                                     │
│  ┌─────────────┐  ┌──────────────┐ │
│  │ Chat        │  │ Embeddings   │ │
│  │ Provider    │  │ Provider     │ │
│  └─────────────┘  └──────────────┘ │
│          │                │         │
│          └───────┬────────┘         │
│                  ↓                  │
│           ┌─────────────┐           │
│           │     RAG     │           │
│           └──────┬──────┘           │
│                  ↓                  │
│           ┌─────────────┐           │
│           │ VectorStore │           │
│           └─────────────┘           │
└─────────────────────────────────────┘
```

L'elemento più importante è il `VectorStore`.

Il RAG non deve sapere come vengono effettivamente memorizzati e confrontati gli embedding.

Questo permette di utilizzare backend differenti.

---

# Struttura del progetto

```text
use-ai/
│
├── package.json
├── tsconfig.json
├── .gitignore
├── .env.example
├── README.md
│
└── src/
    │
    ├── index.ts
    ├── client.ts
    ├── types.ts
    ├── errors.ts
    │
    ├── providers/
    │   ├── index.ts
    │   └── openai-compatible.ts
    │
    └── rag/
        ├── chunker.ts
        ├── indexer.ts
        ├── knowledge-base.ts
        ├── retriever.ts
        │
        └── vector-store/
            ├── interface.ts
            └── js-vector-store.ts
```

La struttura può essere estesa con ulteriori backend del vector store.

---

# Installazione

Dalla directory del progetto:

```bash
npm install
```

Per compilare:

```bash
npm run build
```

Il risultato viene generato nella directory:

```text
dist/
```

---

# Configurazione

La configurazione principale viene effettuata creando un'istanza di `AI`.

Esempio minimale:

```ts
import { AI } from "use-ai";

const ai = new AI({
  provider: {
    apiKey: process.env.AI_API_KEY!,
    baseURL: process.env.AI_BASE_URL!
  },

  model: process.env.AI_MODEL!,

  embeddingModel: process.env.AI_EMBEDDING_MODEL!
});
```

---

# Provider OpenAI-compatible

Il provider principale è:

```ts
OpenAICompatibleProvider
```

Non è necessario specificare il nome del servizio.

La configurazione viene determinata dall'endpoint.

## OpenAI

```ts
const ai = new AI({
  provider: {
    apiKey: process.env.OPENAI_API_KEY!,
    baseURL: "https://api.openai.com/v1"
  },

  model: "gpt-5",

  embeddingModel: "text-embedding-3-small"
});
```

---

## Together AI

Together AI può essere utilizzato direttamente perché espone un endpoint OpenAI-compatible.

```ts
const ai = new AI({
  provider: {
    apiKey: process.env.TOGETHER_API_KEY!,
    baseURL: "https://api.together.ai/v1"
  },

  model: "MODEL_NAME",

  embeddingModel: "EMBEDDING_MODEL_NAME"
});
```

Non esiste quindi una configurazione speciale:

```ts
provider: "together"
```

Il provider rimane genericamente OpenAI-compatible.

---

## OpenRouter

```ts
const ai = new AI({
  provider: {
    apiKey: process.env.OPENROUTER_API_KEY!,
    baseURL: "https://openrouter.ai/api/v1"
  },

  model: "MODEL_NAME"
});
```

---

## Server locale

È possibile utilizzare un server locale OpenAI-compatible:

```ts
const ai = new AI({
  provider: {
    apiKey: "local",
    baseURL: "http://localhost:1234/v1"
  },

  model: "MODEL_NAME",

  embeddingModel: "EMBEDDING_MODEL_NAME"
});
```

Questo consente di utilizzare il modulo anche senza dipendere necessariamente da un servizio cloud.

---

# Provider separati

LLM ed embedding possono utilizzare provider diversi.

```ts
const ai = new AI({
  provider: {
    apiKey: process.env.OPENAI_API_KEY!,
    baseURL: "https://api.openai.com/v1"
  },

  embeddingProvider: {
    apiKey: process.env.TOGETHER_API_KEY!,
    baseURL: "https://api.together.ai/v1"
  },

  model: "gpt-5",

  embeddingModel: "EMBEDDING_MODEL_NAME"
});
```

Il risultato è:

```text
                   ┌── OpenAI ──→ LLM
AI Core ───────────┤
                   └── Together ─→ Embeddings
```

---

# Utilizzo base

Una volta creato il client:

```ts
const response = await ai.generate(
  "Spiegami cos'è il machine learning."
);

console.log(response.text);
```

Il risultato contiene il testo generato e, quando disponibile, informazioni sull'utilizzo.

---

# Chat

È possibile utilizzare messaggi strutturati:

```ts
const response = await ai.chat([
  {
    role: "system",
    content: "Sei un assistente tecnico."
  },
  {
    role: "user",
    content: "Spiegami cos'è un database vettoriale."
  }
]);

console.log(response.text);
```

---

# RAG e Knowledge Base

Per utilizzare il RAG è necessario specificare una directory contenente i documenti.

```ts
const ai = new AI({
  provider: {
    apiKey: process.env.AI_API_KEY!,
    baseURL: process.env.AI_BASE_URL!
  },

  model: process.env.AI_MODEL!,

  embeddingModel: process.env.AI_EMBEDDING_MODEL!,

  knowledgePath: "./knowledge"
});
```

La directory può contenere, ad esempio:

```text
knowledge/
├── manuale.md
├── regolamento.txt
├── configurazione.json
└── documentazione/
    └── api.md
```

I formati supportati dipendono dal parser configurato dal modulo.

Attualmente il core è orientato principalmente a:

```text
.txt
.md
.markdown
.json
```

---

# Indicizzazione

L'indicizzazione può essere eseguita esplicitamente:

```ts
const result = await ai.reindex();

console.log(result);
```

Il processo è:

```text
file
 ↓
read
 ↓
normalize
 ↓
chunk
 ↓
embedding
 ↓
vector store
```

---

# Chunking

I documenti vengono suddivisi in chunk prima di essere trasformati in embedding.

Configurazione:

```ts
const ai = new AI({
  // ...

  chunkSize: 1200,
  chunkOverlap: 150
});
```

Il chunker cerca di evitare, quando possibile, di interrompere il testo nel mezzo di una struttura semantica.

La priorità è generalmente:

```text
paragrafo
   ↓
frase
   ↓
newline
   ↓
limite caratteri
```

---

# Embedding batch

Gli embedding vengono richiesti a batch per ridurre il numero di chiamate al provider.

Configurazione:

```ts
embeddingBatchSize: 32
```

Ad esempio:

```text
100 chunk
 ↓
32
32
32
4
```

Il valore può essere modificato in base ai limiti del provider.

---

# Ricerca semantica

È possibile interrogare direttamente la knowledge base:

```ts
const results = await ai.search(
  "Come viene configurato il database?"
);
```

Ogni risultato contiene informazioni come:

```ts
{
  id: 123,

  text: "...",

  source: "manuale.md",

  chunkIndex: 4,

  distance: 0.18,

  score: 0.82
}
```

`distance` rappresenta la distanza vettoriale.

Per una cosine distance:

```text
score = 1 - distance
```

Quindi un valore di `score` più elevato indica una maggiore similarità.

---

# Configurazione della ricerca

È possibile specificare quanti risultati recuperare:

```ts
const results = await ai.search(
  "configurazione database",
  {
    topK: 5
  }
);
```

Il valore predefinito è normalmente:

```text
topK = 5
```

---

# Chat con RAG

Il metodo principale per utilizzare il sistema RAG è:

```ts
const response = await ai.ask(
  "Come posso configurare il database?"
);
```

Il modulo esegue:

```text
domanda
   ↓
embedding della domanda
   ↓
ricerca semantica
   ↓
top K documenti
   ↓
costruzione del contesto
   ↓
LLM
   ↓
risposta
```

Il modello riceve il materiale recuperato come contesto.

Il prompt RAG istruisce il modello a:

* utilizzare il contesto come fonte primaria;
* non inventare informazioni;
* dichiarare quando il contesto non è sufficiente.

---

# Query RAG personalizzata

È possibile separare la domanda posta all'utente dalla query utilizzata per il retrieval.

Esempio concettuale:

```ts
const response = await ai.chat(
  [
    {
      role: "user",
      content: "Spiegami questa configurazione."
    }
  ],
  {
    knowledgeQuery: "configurazione database PostgreSQL"
  }
);
```

Questo è utile quando la domanda dell'utente non è una buona query semantica.

---

# Streaming

Il modulo supporta lo streaming delle risposte.

Esempio:

```ts
const stream = ai.stream(
  "Spiegami il funzionamento del RAG."
);

for await (const chunk of stream) {
  process.stdout.write(chunk);
}
```

Questo è particolarmente utile nelle applicazioni Electron perché permette di aggiornare progressivamente l'interfaccia:

```text
"Il"
"Il RAG"
"Il RAG è"
"Il RAG è una"
...
```

---

# Vector Store

Il vector store è intenzionalmente astratto.

Il modulo non dovrebbe dipendere necessariamente da un particolare database vettoriale.

Interfaccia concettuale:

```ts
interface VectorStore {
  init(dimension: number): Promise<void>;

  add(documents: VectorDocument[]): Promise<void>;

  removeBySource(source: string): Promise<void>;

  search(
    vector: number[],
    topK: number
  ): Promise<SearchResult[]>;

  count(): Promise<number>;

  clear(): Promise<void>;

  close(): Promise<void>;
}
```

Questa separazione permette di sostituire il backend senza modificare il RAG.

---

# JavaScript Vector Store

Per applicazioni Electron IA-32 è disponibile un backend basato su JavaScript puro.

Il vantaggio principale è l'assenza di dipendenze native obbligatorie.

La ricerca viene effettuata confrontando l'embedding della query con gli embedding memorizzati.

Concettualmente:

```text
query embedding
       │
       ├── document 1 → similarity
       ├── document 2 → similarity
       ├── document 3 → similarity
       ├── ...
       └── document N → similarity
                    ↓
              ordinamento
                    ↓
                 top K
```

Per knowledge base relativamente piccole questo approccio è semplice e sufficientemente veloce.

---

# Perché non viene utilizzato obbligatoriamente un Vector Database?

Per una desktop application non è sempre necessario introdurre un servizio separato.

Una knowledge base di qualche migliaio di chunk può essere gestita localmente senza:

* server;
* Docker;
* database remoto;
* servizio cloud aggiuntivo.

Questo riduce drasticamente la complessità di distribuzione.

---

# Electron

Il modulo è progettato per essere utilizzato dal processo **Main** di Electron.

Esempio:

```ts
import { app } from "electron";
import path from "node:path";
import { AI } from "use-ai";

const ai = new AI({
  provider: {
    apiKey: process.env.AI_API_KEY!,
    baseURL: process.env.AI_BASE_URL!
  },

  model: process.env.AI_MODEL!,

  embeddingModel: process.env.AI_EMBEDDING_MODEL!,

  knowledgePath: path.join(
    app.getPath("userData"),
    "knowledge"
  ),

  dbPath: path.join(
    app.getPath("userData"),
    "ai",
    "knowledge"
  )
});
```

Il modulo **non deve importare `electron` direttamente**.

È l'applicazione Electron a fornire i percorsi appropriati.

---

# Perché utilizzare `app.getPath("userData")`

Non è consigliabile memorizzare dati modificabili dell'applicazione all'interno della directory di installazione.

È preferibile utilizzare:

```ts
app.getPath("userData")
```

che tipicamente produce una directory specifica dell'utente.

Una struttura possibile è:

```text
userData/
│
├── knowledge/
│   ├── manuale.md
│   └── documentazione.md
│
└── ai/
    └── knowledge/
```

---

# Electron e IPC

Le API AI dovrebbero idealmente essere utilizzate dal processo Main.

Il Renderer può comunicare tramite IPC:

```text
Renderer
   │
   │ IPC
   ↓
Main
   │
   ↓
AI Core
   │
   ├── Provider
   ├── Embeddings
   └── RAG
```

Questo è particolarmente importante per le API key.

---

# Sicurezza delle API key

**Non inserire API key nel Renderer.**

Da evitare:

```ts
// Renderer
const ai = new AI({
  provider: {
    apiKey: "sk-..."
  }
});
```

Meglio:

```text
Renderer
   ↓
IPC
   ↓
Main
   ↓
AI Core
   ↓
Provider
```

In questo modo la chiave rimane nel processo principale.

---

# Windows IA-32

Il progetto nasce anche dall'esigenza di supportare applicazioni Electron Windows **32-bit**.

In questo ambiente bisogna prestare particolare attenzione alle dipendenze native.

Il fatto che Windows sia a 64 bit non significa che un'applicazione IA-32 possa caricare una libreria nativa x64.

La regola è:

```text
Electron ia32
      ↓
native dependency ia32
```

e non:

```text
Electron ia32
      ↓
native dependency x64
```

Per questo il backend JavaScript del vector store è particolarmente utile: non richiede un binario nativo.

---

# Node.js

Il progetto è pensato per poter essere utilizzato anche con runtime basati su:

```text
Node 18
```

Questo è importante nel caso di Electron che incorpora una versione specifica di Node.js.

Non bisogna assumere che:

```text
Node installato sul sistema
```

e:

```text
Node incluso in Electron
```

siano necessariamente la stessa versione.

Per le dipendenze native è inoltre necessario considerare l'ABI di Electron.

---

# API

## `new AI(config)`

Crea un client AI.

Esempio:

```ts
const ai = new AI({
  provider: {
    apiKey: "...",
    baseURL: "https://api.openai.com/v1"
  },

  model: "gpt-5",

  embeddingModel: "text-embedding-3-small"
});
```

---

## `generate(prompt)`

Genera una risposta testuale.

```ts
const result = await ai.generate(
  "Scrivi una breve descrizione del prodotto."
);

console.log(result.text);
```

---

## `chat(messages)`

Invia una conversazione strutturata.

```ts
const result = await ai.chat([
  {
    role: "system",
    content: "Sei un assistente."
  },
  {
    role: "user",
    content: "Ciao!"
  }
]);
```

---

## `ask(question)`

Esegue una richiesta RAG.

```ts
const result = await ai.ask(
  "Quali sono le procedure descritte nel manuale?"
);
```

---

## `search(query)`

Esegue solamente il retrieval.

```ts
const results = await ai.search(
  "procedura di configurazione"
);
```

---

## `reindex()`

Ricostruisce completamente la knowledge base.

```ts
await ai.reindex();
```

Da utilizzare quando:

* cambiano le impostazioni degli embedding;
* viene cambiata la struttura dell'indice;
* si vuole forzare una ricostruzione completa.

---

## `index()`

Aggiorna la knowledge base incrementale.

```ts
await ai.index();
```

In condizioni normali è preferibile rispetto a `reindex()`.

---

## `stream(prompt)`

Restituisce uno stream della risposta.

```ts
for await (const chunk of ai.stream("Ciao")) {
  console.log(chunk);
}
```

---

## `close()`

Chiude le risorse utilizzate dal modulo.

```ts
await ai.close();
```

È particolarmente importante quando il backend utilizza risorse persistenti.

---

# Tipi principali

## `SearchResult`

```ts
interface SearchResult {
  id: number;
  text: string;
  source: string;
  chunkIndex: number;
  distance: number;
  score: number;
}
```

---

## `VectorDocument`

Rappresenta un chunk indicizzato:

```ts
interface VectorDocument {
  id: number;
  text: string;
  source: string;
  chunkIndex: number;
  embedding: number[];
}
```

---

## `ChatMessage`

```ts
interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
```

---

# Configurazione principale

Una configurazione completa può essere:

```ts
const ai = new AI({
  provider: {
    apiKey: process.env.AI_API_KEY!,
    baseURL: process.env.AI_BASE_URL!
  },

  embeddingProvider: {
    apiKey: process.env.AI_EMBEDDING_API_KEY!,
    baseURL: process.env.AI_EMBEDDING_BASE_URL!
  },

  model: process.env.AI_MODEL!,

  embeddingModel: process.env.AI_EMBEDDING_MODEL!,

  knowledgePath: "./knowledge",

  dbPath: "./.ai/knowledge",

  chunkSize: 1200,

  chunkOverlap: 150,

  embeddingBatchSize: 32,

  topK: 5,

  temperature: 0.2,

  maxTokens: 2048,

  autoIndex: true
});
```

---

# Variabili d'ambiente

Esempio `.env`:

```env
AI_API_KEY=
AI_BASE_URL=
AI_MODEL=

AI_EMBEDDING_API_KEY=
AI_EMBEDDING_BASE_URL=
AI_EMBEDDING_MODEL=
```

Per Together AI:

```env
AI_API_KEY=...
AI_BASE_URL=https://api.together.ai/v1
AI_MODEL=...
AI_EMBEDDING_MODEL=...
```

Per OpenAI:

```env
AI_API_KEY=...
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=...
AI_EMBEDDING_MODEL=...
```

Il nome delle variabili non identifica il provider: `AI_BASE_URL` determina l'endpoint utilizzato.

---

# Gestione degli errori

Il modulo espone errori specifici:

```ts
AICoreError
AIConfigurationError
AIProviderError
KnowledgeBaseError
```

È possibile gestirli così:

```ts
try {
  const result = await ai.ask(
    "Come funziona il sistema?"
  );

  console.log(result.text);

} catch (error) {

  if (error instanceof AIProviderError) {
    console.error("Errore del provider:", error);
  }

  else if (error instanceof KnowledgeBaseError) {
    console.error("Errore knowledge base:", error);
  }

  else {
    console.error(error);
  }
}
```

---

# Performance

Il costo principale del RAG è normalmente costituito da:

1. generazione degli embedding;
2. ricerca vettoriale;
3. generazione della risposta LLM.

L'indicizzazione è generalmente il passaggio più costoso perché richiede chiamate al modello di embedding.

Per questo il sistema utilizza:

* indicizzazione incrementale;
* batch embedding;
* riutilizzo degli embedding esistenti;
* ricerca solamente sui chunk indicizzati.

---

# Dimensionamento consigliato

Per una desktop application:

```text
< 1.000 chunk
```

La ricerca è praticamente trascurabile.

```text
1.000 – 20.000 chunk
```

La ricerca brute-force in JavaScript può essere una soluzione semplice e valida.

```text
20.000 – 100.000+ chunk
```

È opportuno valutare un backend vettoriale ottimizzato.

```text
100.000+ chunk
```

Potrebbe essere preferibile utilizzare un database/vector engine dedicato.

I valori sono indicativi e dipendono soprattutto dalla dimensione degli embedding e dall'hardware.

---

# Embedding e compatibilità

Gli embedding memorizzati nel vector store dipendono dal modello utilizzato.

Cambiare modello di embedding può rendere inutilizzabili gli embedding precedenti.

Esempio:

```text
Embedding model A
      ↓
vector dimension 768
```

non può essere semplicemente sostituito con:

```text
Embedding model B
      ↓
vector dimension 1024
```

senza ricostruire l'indice.

Per questo il vector store dovrebbe mantenere metadati relativi a:

* modello di embedding;
* dimensione del vettore;
* versione dello schema.

Quando uno di questi elementi cambia, è consigliabile eseguire:

```ts
await ai.reindex();
```

---

# Estendere il modulo

Il progetto è pensato per essere esteso.

## Nuovo provider

È possibile creare un provider che implementi le interfacce previste dal modulo.

Ad esempio:

```text
providers/
├── openai-compatible.ts
├── custom-provider.ts
└── index.ts
```

---

## Nuovo Vector Store

È possibile creare:

```text
vector-store/
├── interface.ts
├── js-vector-store.ts
├── sqlite-vector-store.ts
└── custom-vector-store.ts
```

senza modificare il resto del sistema RAG.

Questo è uno degli obiettivi principali dell'architettura.

---

# Principio architetturale

Il modulo cerca di mantenere separati:

```text
Provider
```

da:

```text
Embedding
```

e da:

```text
Storage
```

e da:

```text
RAG
```

In questo modo una modifica a un componente non deve necessariamente propagarsi agli altri.

Ad esempio:

```text
OpenAI
   ↓
RAG
   ↓
JS Vector Store
```

può diventare:

```text
Together
   ↓
RAG
   ↓
SQLite Vector Store
```

senza cambiare l'API utilizzata dall'applicazione.

---

# Limitazioni

Attualmente il progetto non è pensato come piattaforma RAG enterprise.

Non include necessariamente:

* OCR;
* parsing avanzato di PDF;
* parsing nativo di Word;
* crawling web;
* reranking avanzato;
* hybrid search BM25 + vector;
* knowledge graph;
* multi-user access;
* sincronizzazione cloud;
* autenticazione interna;
* controllo degli accessi ai documenti.

Queste funzionalità possono essere aggiunte in seguito.

---

# Considerazioni sulla sicurezza

La knowledge base locale può contenere informazioni sensibili.

L'applicazione dovrebbe quindi prestare attenzione a:

* permessi dei file;
* API key;
* log;
* contenuti inviati al provider AI;
* documenti indicizzati;
* backup del vector store.

In particolare, utilizzare un provider cloud significa che il contenuto recuperato dal RAG può essere inviato al relativo servizio AI.

È quindi opportuno verificare le policy del provider utilizzato prima di indicizzare dati riservati.

---

# Sviluppo

Installare le dipendenze:

```bash
npm install
```

Compilare:

```bash
npm run build
```

Pulire la build:

```bash
npm run clean
```

Ricostruire:

```bash
npm run rebuild
```

La directory compilata è:

```text
dist/
```

---

# Utilizzo come pacchetto locale

Durante lo sviluppo può essere utile collegare il modulo a un'app Electron:

```bash
npm link
```

oppure utilizzare un workspace npm/pnpm.

L'applicazione finale dovrebbe importare il modulo attraverso la sua API pubblica:

```ts
import { AI } from "use-ai";
```

e non importare direttamente file interni come:

```ts
import { ... } from "use-ai/src/rag/...";
```

Questo mantiene stabile l'API pubblica.

---

# Esempio completo

```ts
import path from "node:path";
import { AI } from "use-ai";

const ai = new AI({
  provider: {
    apiKey: process.env.AI_API_KEY!,
    baseURL: process.env.AI_BASE_URL!
  },

  model: process.env.AI_MODEL!,

  embeddingModel: process.env.AI_EMBEDDING_MODEL!,

  knowledgePath: path.resolve("./knowledge"),

  dbPath: path.resolve("./.ai/knowledge"),

  chunkSize: 1200,

  chunkOverlap: 150,

  embeddingBatchSize: 32,

  topK: 5,

  temperature: 0.2,

  autoIndex: true
});

// Aggiorna l'indice
await ai.index();

// Ricerca semantica
const results = await ai.search(
  "Come viene configurato il sistema?"
);

console.log(results);

// Domanda con RAG
const answer = await ai.ask(
  "Spiegami come viene configurato il sistema."
);

console.log(answer.text);

// Chat normale
const chat = await ai.chat([
  {
    role: "system",
    content: "Sei un assistente tecnico."
  },
  {
    role: "user",
    content: "Spiegami cos'è il RAG."
  }
]);

console.log(chat.text);

// Chiusura
await ai.close();
```

---

# Filosofia del progetto

Il progetto segue alcuni principi:

### 1. Provider agnostico

Il codice applicativo non deve dipendere da Together, OpenAI o da un altro servizio specifico.

### 2. Local-first

La knowledge base deve poter vivere localmente.

### 3. Nessun server obbligatorio

Una desktop application non dovrebbe richiedere necessariamente Docker, PostgreSQL, un vector database remoto o un servizio aggiuntivo.

### 4. Compatibilità Electron

Le dipendenze devono essere scelte tenendo conto del runtime effettivo di Electron.

### 5. Compatibilità IA-32

Quando possibile, le funzionalità fondamentali devono evitare dipendenze native che rendano impossibile la distribuzione x86.

### 6. Componenti sostituibili

Provider, vector store e RAG devono essere il più possibile indipendenti.

---

# Roadmap

Possibili evoluzioni:

* [ ] supporto PDF;
* [ ] supporto DOCX;
* [ ] supporto HTML;
* [ ] parsing ricorsivo delle directory;
* [ ] metadata filtering;
* [ ] similarity threshold;
* [ ] hybrid search;
* [ ] reranking;
* [ ] caching delle risposte;
* [ ] caching degli embedding;
* [ ] gestione delle versioni dei modelli;
* [ ] SQLite come backend opzionale;
* [ ] backend vector database esterni;
* [ ] ricerca full-text;
* [ ] API per citazioni delle fonti;
* [ ] gestione delle fonti nel prompt RAG;
* [ ] test automatici;
* [ ] benchmark IA-32;
* [ ] integrazione più stretta con Electron IPC.

---

# Licenza

Inserire qui la licenza scelta per il progetto.

Esempio:

```text
MIT License
```

Se il progetto viene distribuito come pacchetto npm pubblico, verificare anche le licenze delle dipendenze utilizzate.

---

# Stato del progetto

Il progetto è concepito come **core AI/RAG riutilizzabile** per applicazioni desktop e Node.js.

L'API pubblica dovrebbe rimanere volutamente semplice:

```ts
const ai = new AI(config);

await ai.index();

await ai.search(query);

await ai.ask(question);

await ai.chat(messages);

await ai.generate(prompt);

ai.stream(prompt);
```

L'obiettivo è permettere all'applicazione che utilizza il modulo di ignorare il più possibile la complessità interna relativa a:

```text
provider
embedding
chunking
indexing
retrieval
vector storage
RAG
```

e interagire con un'unica interfaccia AI.
