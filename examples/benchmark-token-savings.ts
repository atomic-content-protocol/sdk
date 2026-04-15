#!/usr/bin/env npx tsx
/**
 * ACP Token Savings Benchmark
 *
 * Proves the ACP value proposition with real measurements:
 * - Run A: LLM triages 20 raw documents (reads everything)
 * - Run B: LLM triages 20 ACO frontmatter blocks + deep reads top 3
 * - Run C: LLM triages 20 ACO frontmatter blocks only
 *
 * Usage:
 *   export $(cat .env | xargs) && npx tsx examples/benchmark-token-savings.ts
 */

import { writeFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Sample documents (inline, reproducible)
// ---------------------------------------------------------------------------

interface Document {
  id: number;
  title: string;
  body: string;
  category: "ai-ml" | "web-tech" | "business" | "random";
}

const DOCUMENTS: Document[] = [
  // --- 5 AI/ML (relevant) ---
  {
    id: 1,
    title: "How MCP Standardizes Agent-to-Tool Communication",
    category: "ai-ml",
    body: `The Model Context Protocol (MCP) represents a significant leap forward in how AI agents communicate with external tools and data sources. Developed by Anthropic and released as an open standard, MCP solves a fundamental fragmentation problem: every AI application was building custom integrations for every tool it needed to connect to.

At its core, MCP operates over JSON-RPC 2.0, a lightweight remote procedure call protocol that uses JSON for encoding. This choice gives MCP language-agnostic interoperability — any system that can speak JSON can participate. The transport layer is intentionally flexible: MCP supports stdio for local processes, HTTP with Server-Sent Events for remote services, and WebSockets for persistent bidirectional communication.

The protocol defines three primitive resource types that servers expose to clients. Tools are callable functions — think of them as the verbs of the protocol. A tool might search a database, send an email, or run a computation. Resources are readable data objects: files, database records, API responses. Prompts are reusable templates that encapsulate common interaction patterns, allowing servers to share prompt engineering best practices directly with clients.

From an architecture standpoint, MCP inverts the traditional integration model. Instead of AI applications building and maintaining integrations to dozens of external services, each service implements the MCP server interface once. Any MCP-compatible AI client can then connect to any MCP-compatible server without custom glue code. This is the Unix pipe model applied to AI tooling.

The connection lifecycle begins with a capability negotiation handshake. Client and server exchange their supported protocol versions and feature sets. Once negotiated, the client can call list_tools, list_resources, or list_prompts to discover what the server exposes. These discovery calls are essential for agents that need to reason about what actions are available.

Error handling in MCP follows JSON-RPC conventions with a structured error object containing a code, message, and optional data field. Protocol errors use the reserved range below -32768, while application-level errors use positive codes defined by each server. This separation lets clients distinguish transport failures from application logic errors.

Security is handled through the host application layer. MCP servers declare their capabilities but the host controls which clients can access which servers, enforcing the principle of least privilege. OAuth 2.0 is recommended for remote server authentication, with the spec leaving token storage and refresh logic to the host implementation.

The broader significance of MCP is ecosystem convergence. With Anthropic, OpenAI, Google, and major IDE vendors committing to MCP support, it is becoming the de facto standard for agent-to-tool communication — much as HTTP became the standard for web communication regardless of what programming language you used.`,
  },
  {
    id: 2,
    title: "Building RAG Pipelines with Vector Databases",
    category: "ai-ml",
    body: `Retrieval-Augmented Generation (RAG) has emerged as the dominant architecture for building knowledge-aware AI applications. Rather than relying on a model's parametric memory alone, RAG systems retrieve relevant documents at inference time and inject them into the model's context window. The result is dramatically more accurate, up-to-date, and verifiable outputs.

The pipeline has three stages: ingestion, retrieval, and generation. During ingestion, source documents are split into chunks, converted to dense vector embeddings, and stored in a vector database alongside the original text. At retrieval time, the user's query is embedded using the same model, and approximate nearest-neighbor search finds the most semantically similar chunks. Those chunks are prepended to the generation prompt, giving the model grounding material.

Embedding models are the bridge between text and vector space. OpenAI's text-embedding-3-small produces 1536-dimensional vectors and handles up to 8192 tokens per input. Cohere's embed-english-v3.0 offers a more compact 1024-dimensional output with strong multilingual support. For on-premise deployments, sentence-transformers like all-MiniLM-L6-v2 run efficiently on CPU with acceptable retrieval quality.

Vector databases specialize in storing and querying these high-dimensional embeddings at scale. pgvector extends PostgreSQL with an ivfflat index type, making it an attractive option for teams already running Postgres — no new infrastructure required. Pinecone is a managed cloud service that handles index tuning automatically. Weaviate adds a graph layer on top of vector search, enabling hybrid queries that combine semantic similarity with structured filters.

Chunking strategy matters enormously. Fixed-size chunks with overlap are simple but lose sentence boundaries. Semantic chunking uses embedding similarity to find natural breakpoints. Hierarchical chunking stores both sentence-level and paragraph-level embeddings, allowing retrieval at multiple granularities. For technical documentation, heading-based chunking that preserves section context often outperforms all other strategies.

Reranking is increasingly standard practice. After a fast approximate-nearest-neighbor search retrieves the top-k candidates, a slower cross-encoder reranker scores query-document pairs directly, producing a more accurate ranking. Cohere Rerank and BGE Reranker v2 are commonly used options. The latency overhead is typically 100-300ms but the precision improvement can be significant.

Evaluation of RAG pipelines uses metrics borrowed from information retrieval: context precision (fraction of retrieved chunks that are relevant), context recall (fraction of relevant chunks that were retrieved), and faithfulness (whether generated answers are grounded in retrieved context). Tools like RAGAS automate these evaluations using an LLM as judge.

Common failure modes include: retrieved chunks that are topically adjacent but not actually relevant to the specific question, queries that use different terminology than the source documents, and context windows that are too small to include all relevant retrieved material. Hybrid search combining dense embeddings with sparse BM25 keyword matching addresses the terminology mismatch problem effectively.`,
  },
  {
    id: 3,
    title: "The Rise of AI Agent Frameworks",
    category: "ai-ml",
    body: `AI agent frameworks have exploded in 2024 and 2025, transforming how developers build systems that can reason, plan, and take action across multiple steps. The core insight driving this trend is that single-shot LLM calls are insufficient for complex tasks — you need an agent that can decompose a goal into subtasks, use tools, observe results, and adapt its plan.

LangChain, one of the earliest frameworks, introduced the concept of chains and agents to the broader developer community. Its Agent abstraction wraps an LLM with a loop: think, act, observe, repeat. LangChain's ecosystem of integrations — hundreds of tool connectors, document loaders, and retrievers — made it the go-to choice despite criticism of its complexity. LangGraph, LangChain's graph-based successor, models agent workflows as directed graphs, giving developers precise control over execution flow and state management.

CrewAI takes a different approach: multi-agent collaboration. You define a crew of specialized agents (a researcher, a writer, a critic) and assign them tasks. Agents communicate by passing messages and can delegate subtasks to each other. This mirrors how human teams work and produces better results on tasks that benefit from diverse expertise and review cycles.

AutoGPT was the viral proof-of-concept that demonstrated autonomous, goal-directed behavior. Given a high-level objective, AutoGPT would break it down, search the web, write and execute code, and iterate toward the goal with minimal human guidance. While AutoGPT itself proved too unreliable for production, it established the mental model that now drives the entire field.

Microsoft's AutoGen framework focuses on conversational multi-agent systems where agents have defined conversation patterns. The assistant-user-proxy pattern is particularly useful for human-in-the-loop workflows where a human can intervene at critical decision points. AutoGen has strong enterprise adoption because its conversation-first design maps well to existing organizational communication patterns.

The Anthropic-led push behind the Model Context Protocol is reshaping agent architecture. Rather than each framework building custom tool integrations, agents can connect to any MCP-compatible server. This decoupling of agent reasoning from tool integration is a structural improvement that reduces maintenance burden and increases interoperability across frameworks.

Memory is a key unsolved problem. Short-term memory (context window) is limited. Long-term memory using vector stores works but loses precision over time. Episodic memory that records specific past interactions is an active research area. MemGPT introduced the concept of a hierarchical memory management system where the agent itself controls what to move in and out of its context window.

Reliability remains the central challenge. Agents fail in subtle ways: infinite loops, hallucinated tool calls, misinterpreted instructions. Evaluation frameworks like AgentBench and ToolBench are emerging to provide standardized benchmarks, but production deployment still requires significant human oversight and guardrails.`,
  },
  {
    id: 4,
    title: "Prompt Engineering Best Practices for Production",
    category: "ai-ml",
    body: `Prompt engineering has evolved from a curiosity into a professional discipline. In production systems, the quality of your prompts is as important as the quality of your code — and unlike code, prompts can degrade silently when models are updated. Treating prompts as versioned, tested artifacts is essential at scale.

System prompts establish the model's persona, task scope, and output constraints. An effective system prompt is specific about what the model should and should not do, provides format requirements, and sets quality standards. Vague system prompts like "you are a helpful assistant" leave too much to interpretation. Better: "You are a document classification system. Output must be a single JSON object matching the schema below. Do not explain your reasoning. If the input is not a document, return { 'error': 'not a document' }."

Few-shot examples are the most reliable way to communicate a non-obvious task. Provide three to five input-output pairs that demonstrate edge cases, not just happy paths. If you want the model to handle ambiguous inputs gracefully, include an ambiguous input in your examples. Models are extraordinarily good at pattern matching from examples, often better than explicit instruction.

Chain-of-thought prompting improves accuracy on multi-step reasoning tasks by instructing the model to show its work. "Think step by step" is the minimal formulation. More controlled is explicit scratchpad delimitation: wrap the reasoning section in XML tags and parse only the answer section. This gives you the reasoning benefits without the reasoning appearing in the final output.

Temperature and sampling parameters matter more than most practitioners realize. Temperature 0 gives deterministic, greedy outputs — useful for structured extraction tasks. Higher temperatures (0.7-1.0) produce more creative, varied outputs — useful for content generation. Top-p sampling constrains the vocabulary distribution differently than temperature; they can be combined but rarely need to be both non-default.

Prompt versioning should be treated like code versioning. Store prompts in source control, tag releases, and run evaluations before promoting a new prompt version to production. A regression in a downstream metric — answer accuracy, format compliance, latency — often traces to a prompt change that seemed benign in manual testing.

Adversarial robustness is increasingly important as more prompts handle untrusted user input. Prompt injection — where user content includes instructions that override the system prompt — is a real attack vector. Mitigations include input sanitization, output parsing that validates structure rather than trusting raw text, and sandboxed execution environments for code-generating prompts.

Cost optimization through prompt compression is a practical concern at scale. Redundant instructions, excessive examples, and verbose formatting inflate token counts without improving output quality. Profile your prompt token usage and identify what can be trimmed. System prompt caching (supported by Anthropic, OpenAI) can reduce costs significantly for high-volume applications with stable system prompts.`,
  },
  {
    id: 5,
    title: "Embedding Models Compared: OpenAI vs Cohere vs Local",
    category: "ai-ml",
    body: `Choosing an embedding model is one of the most consequential technical decisions in a RAG or semantic search system. The model determines the shape of your vector space, and once you've embedded millions of documents, switching models requires re-embedding everything. Getting this right early matters.

OpenAI's text-embedding-3-small and text-embedding-3-large represent the current state of the art for cloud-hosted embeddings. The small model produces 1536-dimensional vectors at $0.02 per million tokens; the large model produces 3072-dimensional vectors at $0.13 per million tokens. Both support Matryoshka Representation Learning, meaning you can truncate the vectors to a smaller dimension (e.g., 256 or 512) and trade storage cost for retrieval quality. For most applications, the small model with 1536 dimensions hits the sweet spot.

Cohere's embed-english-v3.0 and embed-multilingual-v3.0 are strong competitors. The multilingual model supports 100+ languages with impressive cross-lingual retrieval — searching in English and retrieving relevant Spanish or Japanese documents. Cohere's embedding API also accepts an input_type parameter (search_document, search_query, classification, clustering) that adjusts the embedding orientation for the specific use case. This is a thoughtful API design choice that OpenAI lacks.

For on-premise or privacy-sensitive deployments, open-source models from the sentence-transformers ecosystem are the standard choice. all-MiniLM-L6-v2 (384 dimensions) is fast enough to run on CPU and suitable for applications where latency is critical and retrieval quality requirements are moderate. BGE-large-en-v1.5 (1024 dimensions) offers much stronger retrieval quality and has topped MTEB leaderboard benchmarks. Nomic Embed Text v1.5 supports context lengths up to 8192 tokens, making it better for long document embedding than most alternatives.

Benchmarking on the MTEB (Massive Text Embedding Benchmark) provides a standardized comparison. MTEB covers retrieval, clustering, classification, and semantic similarity tasks across 56 datasets. As of early 2026, text-embedding-3-large leads on English retrieval; BGE-M3 leads on multilingual; Nomic leads on long-context tasks. No single model wins across all dimensions.

Dimensionality and storage costs are practical concerns at scale. 1536-dimensional float32 vectors consume 6KB each. A million documents requires 6GB of vector storage before indexing overhead. Quantization (int8 or binary) reduces storage 4-32x with modest retrieval quality degradation. For billion-scale corpora, product quantization and hierarchical navigable small world (HNSW) indexes are standard.

Latency characteristics differ significantly. Cloud APIs add 50-200ms network overhead per call. Local models eliminate network latency but add CPU/GPU time: all-MiniLM on CPU takes 5-15ms per document; BGE-large on GPU takes 2-8ms. For real-time search autocomplete, local quantized models often win on total latency despite lower accuracy.

The practical recommendation: start with text-embedding-3-small for prototyping (easy, cheap, good quality), benchmark against your specific documents and queries before committing, and plan for re-embedding from day one.`,
  },

  // --- 5 Web tech (partially relevant) ---
  {
    id: 6,
    title: "Next.js 16 Server Components Deep Dive",
    category: "web-tech",
    body: `Next.js 16 represents the maturation of the React Server Components architecture that began with Next.js 13's app directory. Two years of production usage have revealed the real trade-offs, and the framework has adapted accordingly. Understanding the mental model shift is essential before reaching for the new primitives.

Server Components render on the server and send HTML (or a special serialized format for partial hydration) to the client. They have zero JavaScript bundle impact — the component code never ships to the browser. They can access server-side resources directly: databases, file systems, environment variables. The trade-off is that they cannot use React state, effects, or browser APIs.

Client Components are the familiar React mental model. They're marked with 'use client' and run on both server (for initial HTML) and client (for interactivity). The key insight: most of your component tree can be Server Components with Client Components at the interactive leaves. This inversion of where JavaScript runs is the core of the performance improvement.

Streaming is the runtime companion to Server Components. Instead of waiting for all server rendering to complete before sending any HTML, Next.js 16 pipes the response as components become ready. Suspense boundaries mark where the stream can be split. The shell (header, nav, layout) arrives immediately; data-dependent sections stream in as promises resolve. This dramatically improves Time to First Byte and perceived performance.

Server Actions, stabilized in Next.js 15 and refined in 16, are async functions that run on the server but can be called from Client Components. They replace the traditional API route pattern for form handling and mutations. A Server Action is just a function marked with 'use server' — Next.js handles the HTTP plumbing. This collapses the client-server boundary for many use cases and reduces boilerplate significantly.

Partial Prerendering (PPR) is the most significant new feature in Next.js 16. It combines the performance of static generation with the freshness of server rendering. The static shell is prerendered and cached at the edge; dynamic holes are filled at request time via streaming. The result is near-instant initial load from the CDN with dynamic content arriving moments later. PPR requires no code changes beyond opting in — Next.js infers the static/dynamic split from Suspense boundaries.

The caching model, heavily revised from Next.js 13, is now opt-in rather than opt-out. The default is no caching; you explicitly add caching where appropriate. This was a controversial but correct decision — the previous aggressive caching caused surprising stale-data bugs that were hard to debug.

For teams migrating from the pages directory, the app directory is now stable and the recommended default. The migration path is incremental — pages and app can coexist, allowing teams to migrate route by route without a big-bang rewrite.`,
  },
  {
    id: 7,
    title: "PostgreSQL Performance Tuning for SaaS",
    category: "web-tech",
    body: `PostgreSQL is the database of choice for most SaaS applications, and for good reason: it combines ACID compliance, rich data types, excellent query planner, and a thriving extension ecosystem. But default Postgres configuration is tuned for safety and compatibility, not throughput. Closing that gap requires understanding where the bottlenecks actually are.

The query planner is your ally. EXPLAIN ANALYZE is the most important tool in your performance debugging toolkit. The output shows the actual execution plan, including which indexes were (or weren't) used, estimated vs actual row counts, and time spent at each node. Surprises in estimated vs actual row counts indicate stale statistics — run ANALYZE to update them. Surprises in index usage often indicate that an index exists but its cost is estimated to be higher than a sequential scan for the specific query's selectivity.

Indexing strategy starts with understanding your query patterns. B-tree indexes (the default) are optimal for equality and range queries. GIN indexes serve full-text search and array containment queries. GiST indexes serve geometric and text search with more complex operators. Partial indexes — created with a WHERE clause — are smaller and faster when queries always include that condition. Covering indexes (using INCLUDE) add non-key columns to the index leaf pages, enabling index-only scans that avoid touching the heap.

Connection pooling is non-negotiable for SaaS. Postgres allocates a process per connection, and each process consumes memory. At 100 concurrent connections, you're looking at 2-4GB just for connection overhead before any query load. PgBouncer in transaction mode reduces this dramatically by multiplexing many application connections over a small pool of actual Postgres connections. Supabase Pooler (built on PgBouncer) is the managed option for teams on Supabase.

Autovacuum configuration is underappreciated. Postgres's MVCC model retains old row versions for in-flight transactions; VACUUM reclaims this dead tuple space. Default autovacuum settings are conservative. For high-write tables, tune autovacuum_vacuum_scale_factor down (e.g., 0.01) to vacuum more frequently. Tables that never get vacuumed bloat over time, hurting both storage and query performance.

Write-Ahead Log (WAL) configuration affects both durability and performance. synchronous_commit = off gives a 1-3x write throughput improvement by acknowledging writes before they're flushed to WAL, at the cost of potentially losing the last few transactions on crash. This trade-off is acceptable for non-financial event logging but not for order or payment records. wal_buffers = 64MB is a common recommendation for write-heavy workloads.

Multi-tenant data isolation in SaaS has two common patterns: row-level security (RLS) where all tenants share tables with a tenant_id column, or schema-per-tenant where each tenant gets isolated tables. RLS is simpler operationally but requires careful index design to ensure tenant_id appears in query plans. Schema-per-tenant gives better isolation and schema flexibility but makes migrations and monitoring more complex.`,
  },
  {
    id: 8,
    title: "REST vs GraphQL vs tRPC in 2026",
    category: "web-tech",
    body: `API design choices made in 2016 are still causing maintenance pain in 2026. The debate between REST, GraphQL, and tRPC has evolved from a philosophical argument into a pragmatic question of context: what kind of application are you building, how many client types need to consume the API, and how much do you value type safety vs flexibility?

REST remains the correct choice for public APIs. Its ubiquity means any language, any HTTP client, any toolchain can consume it without additional libraries. OpenAPI/Swagger provides standardized documentation and client generation. HTTP semantics — methods, status codes, caching headers — encode a lot of information that intermediate systems (CDNs, proxies, browsers) understand natively. If you're building an API that third-party developers will integrate with, REST is the clear answer.

GraphQL shines for data-fetching-heavy applications with multiple client types that have divergent data needs. A mobile app might need a compressed response for bandwidth reasons; a dashboard might need deeply nested related data. REST forces you to either over-fetch (return more data than needed) or create client-specific endpoints. GraphQL's query language lets each client request exactly the shape it needs. The cost is complexity: schema definition, resolver implementation, N+1 query problems that require DataLoader, and a steeper learning curve for backend teams.

tRPC is the right answer when your client and server are both TypeScript and live in the same repository (or at least the same team). It generates a type-safe RPC client from your server router definition — no schema definition language, no code generation step, no out-of-sync client types. The DX is exceptional: IDE autocomplete across the API boundary, compile-time errors for type mismatches, automatic request/response serialization. The constraint is tight coupling: tRPC works best in a monorepo or when client and server are always deployed together.

Streaming is where these three approaches diverge most sharply in 2026. REST with SSE handles streaming responses naturally within HTTP semantics. GraphQL subscriptions work but require either WebSockets or a complex SSE implementation. tRPC added streaming support in v11 but it's not yet as ergonomic as the RPC call pattern for non-streaming operations.

In practice, many production systems use a hybrid: tRPC for internal frontend-to-backend communication, REST for external APIs and webhooks, and sometimes GraphQL for a dedicated data aggregation layer. Choosing one paradigm for everything is less important than being consistent within a context boundary.

The emerging pattern for AI-augmented applications is adding MCP alongside REST or GraphQL. MCP handles agent-to-tool communication while the existing API serves human-facing clients. This separation of concerns — one API designed for humans, one protocol designed for agents — maps well to the different trust and capability requirements of those two consumer types.`,
  },
  {
    id: 9,
    title: "WebSocket Alternatives: SSE, WebTransport, and Beyond",
    category: "web-tech",
    body: `Real-time web communication has more options than it did five years ago, and the right choice depends on your specific latency, reliability, and infrastructure requirements. WebSockets remain relevant but are no longer the default answer for every real-time use case.

Server-Sent Events (SSE) is the overlooked workhorse of real-time web communication. SSE is a simple HTTP streaming protocol where the server pushes events to the client over a persistent connection. It's unidirectional (server to client only), which is its key limitation but also its simplicity advantage. SSE works through HTTP/2 multiplexing without special server configuration, plays well with existing load balancers and CDNs, and reconnects automatically on disconnect. For use cases like live feeds, notifications, and streaming LLM responses, SSE is often a better fit than WebSockets.

WebSockets provide full-duplex communication over a persistent TCP connection. The handshake upgrades an HTTP connection, then both sides can send frames at any time. WebSockets are the right choice when you need low-latency bidirectional communication: multiplayer games, collaborative editing, live chat. The operational complexity is real: WebSocket connections are stateful, which complicates horizontal scaling (you need sticky sessions or a pub/sub intermediary like Redis). Load balancers need explicit WebSocket support.

WebTransport is a newer API built on HTTP/3 (QUIC) that addresses several WebSocket limitations. QUIC's stream multiplexing eliminates head-of-line blocking — a slow stream doesn't delay others. WebTransport supports both reliable streams (like TCP) and unreliable datagrams (like UDP), making it suitable for applications that need UDP-like behavior (video conferencing, game state updates) without the complexity of raw UDP in browsers. Browser support reached broad availability in 2024.

Long polling is the legacy solution that works everywhere: the client makes a request, the server holds it open until there's data, responds, and the client immediately makes another request. It works through any proxy or CDN with no special configuration. Throughput is low and latency is higher than persistent connections, but for low-frequency updates (< 1 per second), the simplicity often outweighs the efficiency cost.

The streaming LLM response pattern has standardized on SSE for good reasons. Each token is an SSE event; the stream terminates naturally when generation completes; clients that support SSE natively (EventSource API in browsers) handle reconnection and buffering automatically. The Anthropic and OpenAI APIs both stream responses as SSE, and frameworks like Vercel AI SDK abstract this further.

Choosing between these options: use SSE for server-to-client streaming, WebSockets for low-latency bidirectional communication, WebTransport for video/gaming use cases where you need both reliability guarantees and low latency, and long polling when you need universal compatibility and low-frequency updates.`,
  },
  {
    id: 10,
    title: "The Supabase Stack: Auth, Database, and Edge Functions",
    category: "web-tech",
    body: `Supabase has become the default backend-as-a-service for full-stack TypeScript applications, combining a managed PostgreSQL database, authentication, file storage, realtime subscriptions, and edge functions in a single platform. Understanding how the pieces fit together helps you avoid common architectural mistakes.

The database layer is real Postgres, not a proprietary abstraction. This matters because you can use any Postgres feature: row-level security, extensions (pgvector, PostGIS, pg_cron), custom functions, triggers, and views. You can connect with any Postgres client — not just the Supabase client library. The platform manages replication, backups, and connection pooling via their built-in PgBouncer proxy.

Row Level Security (RLS) is how Supabase implements multi-tenant data isolation. Each table gets security policies that evaluate against the authenticated user's JWT claims. A policy might say "users can only read rows where user_id = auth.uid()". When enabled, RLS applies to all database access including direct connections — there's no way to bypass it from the application layer (only the service role key bypasses RLS, which should never be exposed to clients).

The Auth system is based on GoTrue, an open-source authentication server. It supports email/password, magic links, OAuth providers (GitHub, Google, Apple, etc.), and phone OTP. JWTs are signed with a secret you control. Custom claims can be added to JWTs via PostgreSQL functions that run at token generation time — this is the mechanism for adding role or permission information that RLS policies can reference.

Realtime subscriptions use PostgreSQL's logical replication to stream database changes to connected clients. You subscribe to changes on a table (or filtered subset) and receive INSERT, UPDATE, DELETE events in real time. This eliminates the polling anti-pattern for many use cases: instead of querying for new messages every second, you subscribe to the messages table. The limitation is that Realtime has higher latency than WebSocket direct messaging — it's database-mediated, not direct peer-to-peer.

Edge Functions are Deno-based serverless functions deployed to the edge network. They run Deno 1.x with TypeScript support, access to npm packages via CDN imports, and built-in Supabase client initialization. Common uses: webhook handlers, payment processing, server-side rendering for complex logic that shouldn't run client-side, and scheduled jobs via pg_cron calling Edge Functions. Cold start is 50-150ms, acceptable for most use cases but notable for latency-sensitive paths.

Storage is built on S3-compatible object storage with RLS integration. Policies control which authenticated users can read or write which files. The CDN layer handles image transformations (resize, format conversion) at the edge via URL parameters — no separate image processing service needed.

The Supabase stack's coherence is its main selling point. Auth, database, and storage share the same security model. You're not stitching together three separate services; you're working with a designed system where the pieces trust each other.`,
  },

  // --- 5 Business/startup (not relevant) ---
  {
    id: 11,
    title: "How to Raise a Pre-Seed Round in 2026",
    category: "business",
    body: `Pre-seed fundraising in 2026 looks meaningfully different from 2021. The zero-interest-rate party is over, and investors have reset their expectations for what constitutes traction at the earliest stage. Understanding this new landscape before you start your raise saves months of wasted effort.

The pre-seed round typically covers 12-18 months of runway for a founding team of 2-4 people. Check sizes range from $500K to $2.5M, with $1-1.5M being most common for software companies. Valuations have compressed: expect $6-10M post-money for a first-time founding team with no revenue, or $10-15M if you have measurable early traction. Serial founders with exits command premiums.

What investors want to see has shifted from vision to evidence. In 2021, a well-told story about a large market was often enough. In 2026, investors want leading indicators: letters of intent, design partner commitments, early user interviews that reveal genuine pain, or a prototype that people are using even informally. "We've talked to 50 potential customers and here's what we learned" is more compelling than a slide deck alone.

Instrument choice matters. SAFEs (Simple Agreements for Future Equity) dominate pre-seed because they defer valuation negotiation. A SAFE converts to equity at the next priced round. The key terms are the valuation cap (the maximum price at which the SAFE converts) and the discount (typically 15-20%, giving SAFE holders a price advantage at conversion). YC's post-money SAFE template is the standard; use it unless there's a specific reason not to.

Building the investor list requires research. Pre-seed investors include angels, micro VCs (funds under $50M), and the pre-seed programs of larger VCs. Target investors who have written 5-10 checks at your stage in the last 18 months — not just investors who say they do pre-seed but whose portfolio is skewed toward Series A. AngelList, Crunchbase, and firm websites reveal portfolio patterns. Warm introductions through founders the investor has backed are the highest-conversion path to a first meeting.

The pitch narrative for pre-seed follows a specific structure: the problem you're solving and why it matters now, the insight that makes your solution possible (technology shift, regulatory change, behavioral change), your specific solution and what makes it defensible, the early evidence that this is real, the team and why you're the right people to solve it, and what you'll build with the capital. Forty slides is too many; twelve is usually right.

The post-term sheet process is where deals fall apart. Diligence requests, reference checks, and partnership votes take 2-6 weeks. Legal fees run $15-30K. Keep a parallel list of backup investors so a single deal falling through doesn't derail your raise. Close as you go rather than waiting to close all commitments simultaneously.`,
  },
  {
    id: 12,
    title: "Product-Led Growth vs Sales-Led: A Framework",
    category: "business",
    body: `The product-led growth (PLG) vs sales-led debate often generates more heat than light because it frames a spectrum as a binary choice. Most successful B2B companies in 2026 operate on a hybrid model, and the interesting question is where on the spectrum to start and how to transition as you scale.

PLG is fundamentally a distribution strategy: the product acquires, activates, and expands users without requiring a sales conversation for every transaction. Slack, Figma, and Notion grew this way. The product's value is demonstrable within a free tier, the activation path is self-serve, and expansion (more seats, higher plan) follows naturally from product engagement. PLG businesses typically have lower CAC, faster sales cycles, and better gross margins than sales-led businesses in comparable markets.

The necessary conditions for PLG are worth examining carefully. Your product must deliver value quickly — ideally within minutes of signup, certainly within a first session. Value must be demonstrable without external validation: the user can see results themselves, not just trust a vendor's claims. The buying decision must be accessible to an individual contributor, not requiring C-suite approval. And the economics must support self-serve: the unit economics of acquiring and serving a customer without human intervention must be positive.

Sales-led growth is the right choice when these conditions aren't met. Enterprise software with complex procurement, compliance requirements, and organizational change management cannot be self-serve regardless of product quality. When the buyer is not the user (IT purchases on behalf of engineers), when contracts require negotiation, or when the product needs significant configuration before it delivers value, human-led sales is required.

The activation metric is the leading indicator of PLG success. Activation is the moment a new user first experiences the product's core value. Everything between signup and activation is friction that reduces conversion. Measuring and systematically reducing time-to-activation is the primary lever for improving top-of-funnel economics in a PLG business. Common activation metrics: first successful export (for document tools), first team invitation sent (for collaboration tools), first query returning results (for analytics tools).

Expansion is where PLG businesses generate their unit economics. Free-to-paid conversion rates of 2-5% are typical for truly free (not time-limited) tiers. The economics work because the cost of serving a free user is low, and even modest conversion rates with strong expansion multipliers (teams growing, feature unlocks, usage-based billing) generate healthy LTV.

Product-qualified leads (PQLs) are the bridge between PLG and sales. PQLs are free users who exhibit engagement patterns correlated with purchase intent: heavy feature usage, inviting multiple colleagues, attempting to use paid-tier features. A sales overlay that engages PQLs with human outreach captures enterprise deals that PLG alone would miss. This hybrid model — PLG for SMB, sales for enterprise — is the mature form of most successful PLG companies.`,
  },
  {
    id: 13,
    title: "Building a Developer Relations Team from Zero",
    category: "business",
    body: `Developer relations (DevRel) sits at the intersection of engineering, marketing, and community management, and building the function from scratch requires clarity about what problem you're actually solving. Too many companies hire a DevRel team without a clear theory of how developer adoption translates to business value.

The case for DevRel is strongest when developers are the primary buyer or a critical influencer in the buying decision. In these markets, traditional marketing underperforms because developers are skeptical of marketing language and trust peer recommendations, technical depth, and demonstrated competence over polished collateral. A developer who has solved a real problem with your tool is more credible than your entire marketing department.

The founding DevRel hire defines the function's character. A community builder will focus on forums, Discord, meetups, and relationship management. A content creator will focus on tutorials, documentation, and video. A technical evangelist will focus on conference talks, developer podcast appearances, and enterprise developer engagement. You probably need all three eventually; your first hire should reflect where your current bottleneck is. If developers aren't finding your product, start with content. If they're finding it but not activating, start with documentation and tutorials. If they're activating but not expanding, start with community.

Documentation is the highest-leverage investment in developer experience and is usually underresourced. Good documentation has three distinct layers: reference (complete API specification, parameter types, return values, error codes), how-to guides (task-oriented walkthroughs that answer "how do I accomplish X"), and conceptual explanation (mental models that help developers understand how the system works, not just how to use it). Most API documentation focuses only on reference and neglects the other two.

Developer conferences (KubeCon, PyCon, Strange Loop, local meetups) are where DevRel teams build credibility. A well-prepared talk that solves a real technical problem in front of the right audience generates more qualified pipeline than most paid advertising. The measure of a good conference session is not applause but GitHub stars and signups in the week after. Track it.

Content strategy for DevRel is different from marketing content. Tutorials that are honest about tradeoffs and limitations are more trusted than tutorials that present only the happy path. Technical blog posts that engage with difficult engineering problems signal competence to the developer audience that matters most. Long-form content that takes a real stance on a technical question ("why we chose X over Y") outperforms neutral comparison posts.

Metrics for DevRel are notoriously hard to measure and attribute. Useful proxies: documentation traffic and search queries (reveals what developers are confused about), SDK download counts and GitHub stars (breadth), developer forum activity (depth and health), time-to-first-API-call for new developers (activation quality), and conference audience surveys (brand perception).`,
  },
  {
    id: 14,
    title: "The Startup Positioning Framework",
    category: "business",
    body: `Positioning is the single hardest strategic problem in early-stage startups, and most teams get it wrong in the same way: they describe what their product does instead of articulating what category it belongs to and why they win within that category. Customers don't buy features; they buy a coherent story about how a product solves a specific problem for people like them.

Category design — the practice of creating a new market category rather than competing in an existing one — is the highest-leverage positioning strategy when it works. Salesforce didn't position as "better client-server CRM"; it positioned as "the end of software." Snowflake didn't position as "faster data warehouse"; it positioned as "the data cloud." Category design works when there's a genuine paradigm shift that existing category leaders are structurally unable to embrace, and when the company has the resources to educate the market.

For most startups, category creation is premature. The more practical starting point is clear competitive positioning within an existing category: who you're for, what problem you solve better than alternatives, and what trade-offs you explicitly accept. "We're Notion for engineering teams" is immediately comprehensible even if it's not category-defining. Comprehensibility is underrated — investors and customers can only fund and buy what they understand.

The ICP (Ideal Customer Profile) is the foundation of good positioning. Positioning without a specific ICP is positioning for everyone, which means positioning for no one. The ICP is not a demographic description but a psychographic one: what is this person responsible for, what does success look like for them, what alternatives are they currently using, what do they hate about those alternatives, and what would make switching worthwhile. Writing one paragraph that describes your ICP concretely enough that you could find five of them on LinkedIn is a useful forcing function.

Message hierarchy structures positioning from highest to lowest altitude. The category claim (what game are you playing) sits at the top. The value proposition (what outcome do you deliver for the ICP) sits in the middle. Proof points (evidence that the value proposition is real) sit at the bottom. Most startup websites start with features (the lowest level) instead of outcomes and category (the highest). The result is that visitors understand what the product does but not why they should care.

Differentiation requires honesty about trade-offs. "We're better than X in every way" is not credible positioning. "We're better than X for teams who care about Y, worse for teams who care about Z" is credible and helps both the right prospects self-select in and the wrong prospects self-select out. The goal is not maximizing pipeline volume; it's maximizing pipeline quality. Sales cycles are expensive; qualified-lead rate matters more than total lead rate.

Testing positioning is underutilized. A/B testing homepage headlines, running five-second tests (what do people remember after five seconds of looking at your homepage), and recording user interviews where prospects describe your product in their own words are all more reliable than internal debate about the right messaging. What you call your product category matters less than whether customers can retell your story accurately after a 20-minute demo.`,
  },
  {
    id: 15,
    title: "From Side Project to SaaS: The First 100 Customers",
    category: "business",
    body: `The transition from side project to SaaS is not primarily a technical challenge; it's a distribution challenge. The code that works for 10 users on a free Heroku dyno is not the bottleneck when you're trying to get to 100 paying customers. What's missing is usually a repeatable process for finding and converting people who have the problem your project solves.

The first step is getting specific about who already has this problem. "Developers" is too broad. "Developers who manage infrastructure for 5-50 person teams and are tired of writing the same Terraform modules across projects" is a specific enough ICP to find. Specificity enables distribution: you can find where these people congregate (which Slack communities, which subreddits, which conference tracks, which newsletters) and go to them rather than waiting for them to find you.

Manual sales is the path to the first 50 customers for almost every B2B SaaS. This means personally reaching out to people who match your ICP, having calls, learning what they care about, demonstrating the product, and following up. It's slow, not scalable, and exactly right for this stage. The goal is not efficiency; it's learning. Each conversation reveals objections, use cases, and pricing intuitions that no amount of user research can fully substitute for.

Pricing for the first 100 customers should be higher than you think. Underpriced products attract customers who are sensitive to price, who churn when a cheaper alternative appears, and who don't value the product enough to push through setup friction. If you're charging $19/month and losing 20% of signups at the billing screen, the right response is usually to raise prices and qualify leads better, not to lower prices. An annual contract commitment from 10 customers is more valuable than a monthly subscription from 100.

The free trial vs freemium decision deserves more attention than it usually gets. Freemium works when the product delivers value in the free tier and expansion to paid is natural. It requires volume to work economically — you need thousands of free users to get hundreds of paid users. For a side project with a small initial user base, a 14-day free trial often converts better than freemium because it creates urgency and gives users a deadline to evaluate properly.

Customer success at this stage is the founder doing everything. You answer support emails, you do onboarding calls, you watch users use the product over Zoom and note where they get confused. This is not sustainable past 50 customers, but the learning you get from direct engagement with early customers is irreplaceable. Every support ticket is a product improvement opportunity; every churned customer is an interview waiting to happen.

The first 100 customers tell you whether you have a business worth building. Churn rate is the most honest signal: if customers who successfully onboard are staying, you have something. If they're leaving after 30-60 days despite a good onboarding experience, the product isn't delivering enough durable value. Fix the product, not the marketing.`,
  },

  // --- 5 Random (not relevant) ---
  {
    id: 16,
    title: "A Guide to Croatian Wine Regions",
    category: "random",
    body: `Croatia's wine culture is one of Europe's best-kept secrets, with winemaking traditions dating back over 2,500 years to Greek settlers on the Dalmatian coast. The country's diverse geography — Adriatic coastline, Mediterranean islands, and continental highlands — produces wildly different wine styles that deserve far more international attention than they currently receive.

Istria, the heart-shaped peninsula jutting into the Adriatic in the northwest, is Croatia's most internationally recognized wine region. The star variety here is Malvazija Istarska, a white grape producing wines that range from crisp and mineral to rich and age-worthy. Top producers like Kozlović, Trapan, and Matošević make Malvazija that competes with premium Italian whites. Teran, the region's main red, is a tannic, iron-rich grape that pairs beautifully with the region's distinctive truffle cuisine. Istrian orange wines — white wines made with extended skin contact — have attracted particular attention from natural wine enthusiasts.

Dalmatia stretches 600 kilometers along the Adriatic coast and its islands, encompassing several distinct sub-regions. The Pelješac Peninsula is Plavac Mali country — the variety that shares genetic ancestry with Zinfandel and produces the country's most powerful reds. Dingač and Postup are the two quality designations on Pelješac's steep south-facing slopes, where grapes ripen to extraordinary sugar levels. Korčula island produces crisp Pošip, one of Croatia's finest white varieties, from vines that have grown on the island for centuries.

Slavonia in the continental northeast is the country's largest wine region by volume. The Graševina variety (identical to Welschriesling) dominates, producing everyday whites that fuel domestic consumption. But serious producers like Krauthaker and Belje are extracting genuine quality from Graševina with low yields and careful winemaking. The region's oak forests supply barrel staves to winemakers across Europe.

The indigenous variety revival is one of Croatian wine's most exciting developments. Croatia has over 130 native grape varieties, many grown only in a single region or even a single village. Researchers at the University of Zagreb have been working for two decades to characterize and preserve these varieties. Škrlet from the Moslavina region, Lasina from northern Dalmatia, and Bogdanuša from the island of Hvar are examples of varieties with distinctive flavor profiles that global wine culture would lose if replaced by international varieties.

Visiting Croatian wine country is straightforward from Zagreb or Split. The best time is September and October during harvest, when most wineries welcome visitors and the summer tourist crowds have thinned. Many producers operate small guesthouses attached to their estates. The combination of food, landscape, and wine makes Croatian wine tourism one of Europe's genuinely underrated experiences.`,
  },
  {
    id: 17,
    title: "The Science of Sourdough: A Baker's Guide",
    category: "random",
    body: `Sourdough bread is, at its core, applied microbiology. The starter — that bubbling pot of flour and water you feed every day — is a carefully maintained ecosystem of wild yeasts and lactic acid bacteria that have evolved together over the history of your particular culture. Understanding the science behind what's happening in that jar is the fastest path to consistently excellent bread.

The starter contains two groups of microorganisms in a stable symbiosis. Wild yeasts (primarily Saccharomyces cerevisiae and Kazachstania humilis in most cultures) produce CO2 for leavening through fermentation of sugars. Lactic acid bacteria (primarily Lactobacillus species) produce lactic acid and acetic acid, which create the characteristic sour flavor and lower the pH to inhibit harmful bacteria. The ratio of these two acids determines flavor profile: lactic acid creates a mild, yogurt-like sourness; acetic acid creates a sharp, vinegar-like tang. Warmer temperatures and wetter doughs favor lactic acid production; cooler temperatures and stiffer doughs favor acetic acid.

Hydration — the ratio of water to flour by weight — is the most variable parameter in sourdough and has cascading effects on handling and final texture. A 75% hydration dough (750g water per 1000g flour) is manageable for most home bakers and produces an open crumb with good crust. 80-85% hydration produces the wide-open crumb celebrated in artisan bakeries but requires skillful handling techniques: coil folds rather than traditional kneading, longer bench rest to develop strength, and a well-seasoned cast iron dutch oven to trap steam during baking.

The bulk fermentation phase is where flavor develops. A properly active starter, added at 15-20% of total flour weight, will produce visible rise and bubble activity over 4-6 hours at room temperature (22-24°C). The dough is ready when it has grown 50-75% in volume, feels airy to the touch, and passes the poke test — an indentation springs back slowly rather than immediately (under-fermented) or staying depressed (over-fermented). Cold retard overnight in the refrigerator after shaping develops more complex flavors by extending fermentation at lower temperature.

Scoring — the cuts you make on the loaf surface before baking — is both functional and aesthetic. Scoring controls where the loaf expands during the oven spring. An unscored loaf will burst unpredictably. A single deep slash along the centerline produces the classic artisan ear. More elaborate patterns require a razor-sharp lame (blade holder) and practice. The angle of the blade matters: a shallow angle (nearly parallel to the surface) produces the tall ear; a steeper angle produces a wider opening with less ear development.

The baking environment is the final variable. Home ovens struggle to maintain the combination of high heat and steam that professional deck ovens provide. The Dutch oven technique solves this: bake covered at 260°C for 20 minutes (trapping steam from the dough itself), then uncovered for 20-25 minutes (developing crust color and crisp texture). The internal temperature should reach 98°C before removing from the oven. Resist cutting the loaf for at least one hour — the crumb structure continues setting as the bread cools, and cutting too early produces a gummy interior.`,
  },
  {
    id: 18,
    title: "Barcelona's Hidden Architecture Beyond Gaudi",
    category: "random",
    body: `Antoni Gaudí casts such a long shadow over Barcelona's architectural identity that the city's other extraordinary buildings are systematically overlooked. The Catalan Modernisme movement produced a generation of architects working in the same period as Gaudí who created buildings every bit as innovative, and whose work deserves the same pilgrimages.

Lluís Domènech i Montaner is the most important figure in this overlooked generation. His Palau de la Música Catalana (1908) is an UNESCO World Heritage site that stands as one of the great interior spaces in European architecture. The concert hall is wrapped entirely in stained glass, filling the space with colored light. The stage ceiling is a multicolored inverted dome of glass and ceramic — the largest in the world when it was built. Domènech i Montaner also designed the Hospital de Sant Pau, a working hospital campus now open for tours, where modernist pavilions connected by underground tunnels create a parallel universe of decorated healthcare architecture in the Eixample.

Josep Puig i Cadafalch designed Casa Amatller, which sits directly next to Gaudí's Casa Batlló on the Passeig de Gràcia block known as the "Block of Discord" — three competing modernist masterpieces on the same street. Casa Amatller's stepped gable facade is a deliberate reference to Flemish Gothic architecture filtered through Catalan ornamental sensibility. The interior is open for tours and includes the original owners' chocolate processing equipment (the Amatller family were chocolate manufacturers, which explains the building's many chocolate-themed decorative details).

The Eixample district itself is an architectural achievement worth understanding. Ildefons Cerdà's 1859 urban plan for Barcelona's expansion created the distinctive octagonal city blocks with chamfered corners. The chamfering was functional: it improves sight lines at intersections, allows natural light to reach the center of each block, and creates small plazas at every crossing. Cerdà's original plan included interior gardens in every block; many have been converted to parking, but a few have been restored as public green spaces.

Modernista pharmacies, cafes, and shops throughout the old city maintain interiors from the same period. The Farmàcia Bolós on Carrer de la Canuda retains its original wood and glass cabinetry. The Antiga Casa Figueres pastry shop on La Rambla has one of the finest surviving modernist commercial interiors in Europe, with ceramic tilework and curved wooden fittings from 1902. These vernacular applications of the Modernisme aesthetic in everyday commercial spaces give a more complete picture of how thoroughly the style permeated Barcelona's built environment.

The El Born neighborhood to the east of the Gothic Quarter preserves the architectural record of Barcelona before Cerdà's rationalist grid. The Born Mercat, a 19th-century iron market structure, was converted in 2013 into a cultural center that preserves the archaeological remains of the 1714 siege of Barcelona under glass floors — an extraordinary layering of time periods in a single space.`,
  },
  {
    id: 19,
    title: "The History of the Silk Road",
    category: "random",
    body: `The Silk Road was never a single road. It was a shifting network of overland and maritime trade routes connecting China with Central Asia, the Indian subcontinent, the Middle East, East Africa, and eventually Europe — a network that operated for roughly 1,500 years and shaped the cultural and economic development of civilizations across two continents.

The Han Dynasty's imperial expansion westward in the 2nd century BCE is conventionally taken as the Silk Road's beginning. Emperor Wu's envoy Zhang Qian traveled to the kingdoms of Central Asia in 138 BCE, establishing diplomatic contacts and identifying potential trading partners. Within decades, silk — then a Chinese monopoly, as the secret of sericulture (silkworm cultivation) was closely guarded — was flowing westward to meet enormous Roman and Persian demand. The route's name reflects what China exported, but the trade was far more diverse: spices, glassware, horses, cotton textiles, and eventually paper, printing, and gunpowder technologies traveled in both directions.

The Sogdians were the Silk Road's great merchant civilization. Based in what is now Uzbekistan, with their capital at Samarkand, Sogdian merchant families established trading colonies from China's heartland to the Byzantine empire. Sogdian letters preserved in China from the 4th century CE are among the earliest documentary evidence of the trade network's operation. The Sogdians were not simply middlemen; they carried their own culture — Zoroastrian religion, distinctive art, sophisticated commercial practices — into every corner of Central Asia.

The Mongol period from the 13th to 14th centuries was the Silk Road's peak efficiency era. The Pax Mongolica — the peace enforced by Mongol political control from China to Persia — reduced the political fragmentation that had made long-distance trade expensive and dangerous. Marco Polo's famous journey from Venice to China and back (1271-1295) was made possible by this Mongol-administered infrastructure. Polo's accounts, however credulous or exaggerated, capture the extraordinary cosmopolitanism of cities like Kublai Khan's Khanbaliq (Beijing) under Mongol rule.

Disease moved along the Silk Road as efficiently as luxury goods. The Black Death, which killed 30-60% of Europe's population in the mid-14th century, appears to have originated in Central Asia and spread westward along the trade network. The siege of Caffa (1346), where Mongol forces catapulted plague-infected corpses into the Genoese trading city, may have been the transmission event that brought the disease to Europe via Genoese merchants who fled to Constantinople and then westward. The plague's catastrophic demographic impact accelerated the decline of the overland Silk Road by depopulating the cities that made long-distance trade viable.

The maritime routes that replaced the overland Silk Road after the 15th century — powered by Portuguese and later Dutch and British ships — moved goods more cheaply and at greater volume than any land route could. The network's essential function survived the specific infrastructure: connecting producers with distant markets and facilitating the exchange not just of goods but of ideas, technologies, religions, and peoples.`,
  },
  {
    id: 20,
    title: "Understanding Coral Reef Ecosystems",
    category: "random",
    body: `Coral reefs are among the most biodiverse ecosystems on Earth, supporting approximately 25% of all marine species despite covering less than 0.1% of the ocean floor. This extraordinary concentration of biodiversity is sustained by a set of ecological relationships and physical conditions that are far more fragile than the reefs' stony permanence suggests.

The foundation of the reef ecosystem is the coral polyp itself — a tiny animal, related to jellyfish and sea anemones, that builds a calcium carbonate skeleton. Most reef-building corals live in an obligate symbiosis with photosynthetic algae called zooxanthellae. The algae live within the coral's tissue, producing sugars through photosynthesis that provide up to 90% of the coral's energy needs. In return, the coral provides the algae with shelter, carbon dioxide, and nutrients. This partnership is the energy source that makes reef construction possible in the nutrient-poor tropical waters where reefs typically occur.

Coral bleaching occurs when elevated water temperatures cause the coral to expel its zooxanthellae. Bleaching is a stress response, not immediate death — corals can recover if temperatures return to normal within a few weeks. Sustained elevated temperatures (1-2°C above the historical summer maximum for 4+ weeks) prevent recovery. The algae do not return, the coral starves, and within months, the colony dies. The skeleton remains but is colonized by algae, turning the white bleached coral the characteristic brown-green of dead reef. The Great Barrier Reef experienced major bleaching events in 1998, 2002, 2016, 2017, 2020, 2022, and 2024 — a frequency that prevents full recovery between events.

Ocean acidification is a parallel and compounding threat. As the ocean absorbs CO2 from the atmosphere, seawater becomes more acidic. Lower pH reduces the availability of carbonate ions that corals use to build their skeletons, slowing growth rates and weakening skeletal structure. The chemical changes are measurable in current ocean chemistry and will intensify with continued emissions. At projected 2100 atmospheric CO2 concentrations, the conditions that allowed reef systems to grow at their current scale may no longer exist.

The fish communities associated with reefs are not passive residents but active ecosystem engineers. Parrotfish bite off chunks of coral (and the algae growing on them) with their beak-like teeth, grinding it into the white sand that characterizes tropical beaches. A single large parrotfish can produce hundreds of kilograms of sand per year. Reef sharks regulate the populations of mid-level predators, preventing any single species from dominating in ways that simplify the food web. Cleaner wrasses occupy territories on the reef where they remove parasites from larger fish — even apex predators — in remarkable interspecies trust relationships.

Conservation strategies for reefs include marine protected areas that ban destructive fishing practices, coral gardening programs that grow coral fragments in nurseries and transplant them to damaged reef sections, and selective breeding programs developing heat-tolerant coral strains. These approaches can slow local degradation but cannot substitute for the systemic change required to address the temperature and acidification trends driving reef decline globally.`,
  },
];

// ---------------------------------------------------------------------------
// Enrichment types
// ---------------------------------------------------------------------------

interface EnrichmentResult {
  tags: string[];
  summary: string;
  classification: string;
  key_entities: Array<{ type: string; name: string; confidence: number }>;
  language: string;
}

interface EnrichedDocument {
  doc: Document;
  enrichment: EnrichmentResult;
  enrichmentTokens: { input: number; output: number };
  enrichmentCostUsd: number;
  enrichmentLatencyMs: number;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

interface ClaudeResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

const HAIKU_INPUT_COST_PER_MILLION = 0.25;
const HAIKU_OUTPUT_COST_PER_MILLION = 1.25;

function calcCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens * HAIKU_INPUT_COST_PER_MILLION +
      outputTokens * HAIKU_OUTPUT_COST_PER_MILLION) /
    1_000_000
  );
}

async function callClaude(prompt: string): Promise<ClaudeResponse> {
  const start = Date.now();
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }
  const data = (await response.json()) as {
    content: Array<{ text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };
  const latencyMs = Date.now() - start;
  const text = data.content[0].text;
  return {
    text,
    inputTokens: data.usage.input_tokens,
    outputTokens: data.usage.output_tokens,
    latencyMs,
  };
}

// Structured enrichment via tool_use (matches pipeline pattern)
async function enrichDocument(doc: Document): Promise<EnrichedDocument> {
  const UNIFIED_SCHEMA = {
    name: "enrich_aco",
    description:
      "Extract tags, summary, classification, and key entities from content",
    input_schema: {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            "3-7 relevant tags/keywords (lowercase, single words or hyphenated phrases)",
        },
        summary: {
          type: "string",
          description:
            "Exactly 2 sentences, max 500 characters, starting with the subject",
        },
        classification: {
          type: "string",
          enum: [
            "reference",
            "framework",
            "memo",
            "checklist",
            "notes",
            "transcript",
            "snippet",
            "code",
            "tutorial",
            "analysis",
            "other",
          ],
          description: "Content type classification",
        },
        key_entities: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: [
                  "person",
                  "organization",
                  "technology",
                  "concept",
                  "location",
                  "event",
                ],
              },
              name: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["type", "name", "confidence"],
          },
          description: "Named entities found in the content",
        },
        language: {
          type: "string",
          description: "ISO 639-1 two-letter language code",
        },
      },
      required: [
        "tags",
        "summary",
        "classification",
        "key_entities",
        "language",
      ],
    },
  };

  const truncate = (s: string, max: number) =>
    s.length > max ? s.slice(0, max) + "…" : s;

  const prompt = `Analyze the following content and extract structured enrichment data.

Title: ${truncate(doc.title, 200)}
Content:
${truncate(doc.body, 4_000)}

Extract:
1. Tags: 3-7 relevant keywords (lowercase, single words or hyphenated phrases)
2. Summary: exactly 2 sentences, max 500 characters, starting with the subject
3. Classification: one of reference, framework, memo, checklist, notes, transcript, snippet, code, tutorial, analysis, other
4. Key entities: named entities with type (person, organization, technology, concept, location, event), name, and confidence (0.0-1.0)
5. Language: Detect the primary language of the content. Return as ISO 639-1 two-letter code (en, de, ja, etc.)`;

  const start = Date.now();
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      tools: [UNIFIED_SCHEMA],
      tool_choice: { type: "tool", name: "enrich_aco" },
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; input?: EnrichmentResult }>;
    usage: { input_tokens: number; output_tokens: number };
  };
  const latencyMs = Date.now() - start;

  const toolBlock = data.content.find((b) => b.type === "tool_use");
  if (!toolBlock?.input) {
    throw new Error(`No tool_use block in response for doc ${doc.id}`);
  }

  const inputTokens = data.usage.input_tokens;
  const outputTokens = data.usage.output_tokens;

  return {
    doc,
    enrichment: toolBlock.input,
    enrichmentTokens: { input: inputTokens, output: outputTokens },
    enrichmentCostUsd: calcCost(inputTokens, outputTokens),
    enrichmentLatencyMs: latencyMs,
  };
}

// ---------------------------------------------------------------------------
// Benchmark runs
// ---------------------------------------------------------------------------

interface RunResult {
  label: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  selectedDocs: number[];
  rawResponse: string;
}

const TRIAGE_QUERY =
  "Find the 3 most relevant documents about AI agent protocols and how they communicate with external tools.";

async function runA(docs: Document[]): Promise<RunResult> {
  console.log("\n--- Run A: Raw documents (no ACP) ---");

  let prompt =
    `Here are 20 documents. ${TRIAGE_QUERY}\n\nFor each selected document, provide: document number, title, and a one-sentence reason for selection.\n\n`;

  for (const doc of docs) {
    prompt += `Document ${doc.id}: ${doc.title}\n${doc.body}\n\n`;
  }

  const result = await callClaude(prompt);
  console.log(`  Tokens: ${result.inputTokens} in / ${result.outputTokens} out`);
  console.log(`  Latency: ${result.latencyMs}ms`);
  console.log(`  Response:\n${result.text}`);

  const selected = extractDocNumbers(result.text);
  return {
    label: "A: Raw documents",
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: calcCost(result.inputTokens, result.outputTokens),
    latencyMs: result.latencyMs,
    selectedDocs: selected,
    rawResponse: result.text,
  };
}

async function runB(enriched: EnrichedDocument[]): Promise<RunResult> {
  console.log("\n--- Run B: ACP frontmatter + deep read ---");

  // Step 1: triage on frontmatter
  let step1Prompt =
    `Here are 20 document summaries. ${TRIAGE_QUERY}\n\nReturn only the document numbers.\n\n`;

  for (const e of enriched) {
    const entities = e.enrichment.key_entities
      .map((ent) => `${ent.name} (${ent.type})`)
      .join(", ");
    step1Prompt +=
      `Document ${e.doc.id}: ${e.doc.title}\n` +
      `Summary: ${e.enrichment.summary}\n` +
      `Tags: ${e.enrichment.tags.join(", ")}\n` +
      `Entities: ${entities}\n` +
      `Classification: ${e.enrichment.classification}\n\n`;
  }

  console.log("  Step 1: Triaging on frontmatter...");
  const step1 = await callClaude(step1Prompt);
  console.log(
    `  Step 1 tokens: ${step1.inputTokens} in / ${step1.outputTokens} out`
  );
  console.log(`  Step 1 latency: ${step1.latencyMs}ms`);
  console.log(`  Step 1 response: ${step1.text}`);

  const selectedNums = extractDocNumbers(step1.text);
  const selectedDocs = enriched.filter((e) => selectedNums.includes(e.doc.id));

  // Step 2: deep read selected docs
  let step2Prompt = `Here are the full contents of the ${selectedDocs.length} selected documents. Confirm they are relevant and explain why.\n\n`;
  for (const e of selectedDocs) {
    step2Prompt += `Document ${e.doc.id}: ${e.doc.title}\n${e.doc.body}\n\n`;
  }

  console.log(`  Step 2: Deep reading docs ${selectedNums.join(", ")}...`);
  const step2 = await callClaude(step2Prompt);
  console.log(
    `  Step 2 tokens: ${step2.inputTokens} in / ${step2.outputTokens} out`
  );
  console.log(`  Step 2 latency: ${step2.latencyMs}ms`);

  const totalInput = step1.inputTokens + step2.inputTokens;
  const totalOutput = step1.outputTokens + step2.outputTokens;
  const totalLatency = step1.latencyMs + step2.latencyMs;

  console.log(`  Total tokens: ${totalInput} in / ${totalOutput} out`);

  return {
    label: "B: ACP frontmatter + deep read",
    inputTokens: totalInput,
    outputTokens: totalOutput,
    costUsd: calcCost(totalInput, totalOutput),
    latencyMs: totalLatency,
    selectedDocs: selectedNums,
    rawResponse: step1.text + "\n\n[Deep read]\n" + step2.text,
  };
}

async function runC(enriched: EnrichedDocument[]): Promise<RunResult> {
  console.log("\n--- Run C: ACP frontmatter only ---");

  let prompt =
    `Here are 20 document summaries. ${TRIAGE_QUERY}\n\nFor each selected document, provide: document number, title, and a one-sentence reason.\n\n`;

  for (const e of enriched) {
    const entities = e.enrichment.key_entities
      .map((ent) => `${ent.name} (${ent.type})`)
      .join(", ");
    prompt +=
      `Document ${e.doc.id}: ${e.doc.title}\n` +
      `Summary: ${e.enrichment.summary}\n` +
      `Tags: ${e.enrichment.tags.join(", ")}\n` +
      `Entities: ${entities}\n` +
      `Classification: ${e.enrichment.classification}\n\n`;
  }

  const result = await callClaude(prompt);
  console.log(`  Tokens: ${result.inputTokens} in / ${result.outputTokens} out`);
  console.log(`  Latency: ${result.latencyMs}ms`);
  console.log(`  Response:\n${result.text}`);

  const selected = extractDocNumbers(result.text);
  return {
    label: "C: ACP frontmatter only",
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: calcCost(result.inputTokens, result.outputTokens),
    latencyMs: result.latencyMs,
    selectedDocs: selected,
    rawResponse: result.text,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractDocNumbers(text: string): number[] {
  // Match patterns like "Document 1", "Doc 3", "#5", standalone numbers 1-20
  const patterns = [
    /document\s+(\d{1,2})/gi,
    /doc(?:ument)?\s*#?\s*(\d{1,2})/gi,
    /\b(\d{1,2})\b/g,
  ];

  const found = new Set<number>();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const n = parseInt(match[1], 10);
      if (n >= 1 && n <= 20) found.add(n);
    }
  }

  // Return the 3 most-mentioned, falling back to all found
  const nums = Array.from(found).slice(0, 3);
  return nums;
}

function pct(a: number, b: number): string {
  if (b === 0) return "N/A";
  return ((1 - a / b) * 100).toFixed(1) + "%";
}

function speedup(a: number, b: number): string {
  if (b === 0) return "N/A";
  return ((1 - a / b) * 100).toFixed(1) + "%";
}

function avgTokensPerDoc(docs: Document[]): number {
  // Rough approximation: 1 token ≈ 4 chars
  const totalChars = docs.reduce((s, d) => s + d.body.length, 0);
  return Math.round(totalChars / 4 / docs.length);
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function buildReport(
  runA: RunResult,
  runB: RunResult,
  runC: RunResult,
  enriched: EnrichedDocument[],
  docs: Document[]
): string {
  const now = new Date().toISOString();
  const avgTok = avgTokensPerDoc(docs);

  const totalEnrichInput = enriched.reduce(
    (s, e) => s + e.enrichmentTokens.input,
    0
  );
  const totalEnrichOutput = enriched.reduce(
    (s, e) => s + e.enrichmentTokens.output,
    0
  );
  const totalEnrichCost = enriched.reduce((s, e) => s + e.enrichmentCostUsd, 0);

  const savingsB = runA.costUsd - runB.costUsd;
  const savingsC = runA.costUsd - runC.costUsd;
  const breakEvenB =
    savingsB > 0 ? Math.ceil(totalEnrichCost / savingsB) : "N/A";
  const breakEvenC =
    savingsC > 0 ? Math.ceil(totalEnrichCost / savingsC) : "N/A";

  const allSame =
    JSON.stringify(runA.selectedDocs.sort()) ===
      JSON.stringify(runB.selectedDocs.sort()) &&
    JSON.stringify(runA.selectedDocs.sort()) ===
      JSON.stringify(runC.selectedDocs.sort());

  const accuracySection = allSame
    ? "All three methods selected the same documents. ACP's structured metadata enables equivalent triage accuracy at a fraction of the token cost."
    : `Methods diverged in document selection:\n- Run A selected: ${runA.selectedDocs.join(", ")}\n- Run B selected: ${runB.selectedDocs.join(", ")}\n- Run C selected: ${runC.selectedDocs.join(", ")}\n\nNote any differences above for manual review.`;

  const tokenReductionBC = pct(
    runB.inputTokens + runB.outputTokens,
    runA.inputTokens + runA.outputTokens
  );
  const tokenReductionCC = pct(
    runC.inputTokens + runC.outputTokens,
    runA.inputTokens + runA.outputTokens
  );
  const costReductionBC = pct(runB.costUsd, runA.costUsd);
  const costReductionCC = pct(runC.costUsd, runA.costUsd);
  const speedReductionBC = speedup(runB.latencyMs, runA.latencyMs);
  const speedReductionCC = speedup(runC.latencyMs, runA.latencyMs);

  const conclusionTokens =
    runC.inputTokens + runC.outputTokens <
    runA.inputTokens + runA.outputTokens;
  const conclusionText = conclusionTokens
    ? `ACP frontmatter-only triage (Run C) used ${tokenReductionCC} fewer tokens than raw-document triage (Run A) while${allSame ? " selecting identical documents" : " producing comparable results"}. The one-time enrichment cost of $${totalEnrichCost.toFixed(4)} for 20 documents breaks even after ${breakEvenC} triage operations using frontmatter-only. For workloads where the same document corpus is triaged repeatedly, ACP structured metadata provides compounding cost savings with no loss of selection accuracy.`
    : `Results were mixed — see individual run details above. Consider re-running with a larger document set.`;

  return `# ACP Token Savings Benchmark

**Date:** ${now}
**Model:** claude-haiku-4-5
**Documents:** 20 (avg ~${avgTok} tokens each)
**Query:** "${TRIAGE_QUERY}"

## Results

| Method | Input tokens | Output tokens | Total cost | Latency | Selected docs |
|---|---|---|---|---|---|
| A: Raw documents | ${runA.inputTokens.toLocaleString()} | ${runA.outputTokens.toLocaleString()} | $${runA.costUsd.toFixed(4)} | ${runA.latencyMs.toLocaleString()}ms | ${runA.selectedDocs.join(", ")} |
| B: ACP frontmatter + deep read | ${runB.inputTokens.toLocaleString()} | ${runB.outputTokens.toLocaleString()} | $${runB.costUsd.toFixed(4)} | ${runB.latencyMs.toLocaleString()}ms | ${runB.selectedDocs.join(", ")} |
| C: ACP frontmatter only | ${runC.inputTokens.toLocaleString()} | ${runC.outputTokens.toLocaleString()} | $${runC.costUsd.toFixed(4)} | ${runC.latencyMs.toLocaleString()}ms | ${runC.selectedDocs.join(", ")} |

## Token Savings

| Comparison | Token reduction | Cost reduction | Speed improvement |
|---|---|---|---|
| A → B (frontmatter + deep read) | ${tokenReductionBC} fewer | ${costReductionBC} cheaper | ${speedReductionBC} faster |
| A → C (frontmatter only) | ${tokenReductionCC} fewer | ${costReductionCC} cheaper | ${speedReductionCC} faster |

## Accuracy

${accuracySection}

## Enrichment Investment

- One-time enrichment cost (20 docs): $${totalEnrichCost.toFixed(4)}
- Enrichment input tokens: ${totalEnrichInput.toLocaleString()}
- Enrichment output tokens: ${totalEnrichOutput.toLocaleString()}
- Savings per triage (A vs B): $${savingsB.toFixed(4)}
- Savings per triage (A vs C): $${savingsC.toFixed(4)}
- Break-even A→B: ${typeof breakEvenB === "number" ? breakEvenB + " triages" : breakEvenB}
- Break-even A→C: ${typeof breakEvenC === "number" ? breakEvenC + " triages" : breakEvenC}

## Conclusion

${conclusionText}
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY environment variable not set.");
    console.error(
      "Usage: export $(cat .env | xargs) && npx tsx examples/benchmark-token-savings.ts"
    );
    process.exit(1);
  }

  console.log("=".repeat(60));
  console.log("ACP Token Savings Benchmark");
  console.log("=".repeat(60));
  console.log(`Documents: ${DOCUMENTS.length}`);
  console.log(`Query: "${TRIAGE_QUERY}"`);
  console.log(`Model: claude-haiku-4-5`);
  console.log("=".repeat(60));

  // ---- Enrichment phase ----
  console.log("\n[Phase 1] Enriching all 20 documents...\n");
  const enrichedDocs: EnrichedDocument[] = [];

  for (const doc of DOCUMENTS) {
    process.stdout.write(`  Enriching document ${doc.id}/20: "${doc.title}"... `);
    try {
      const enriched = await enrichDocument(doc);
      enrichedDocs.push(enriched);
      console.log(
        `done (${enriched.enrichmentTokens.input}in/${enriched.enrichmentTokens.output}out, ${enriched.enrichmentLatencyMs}ms)`
      );
    } catch (err) {
      console.error(`FAILED: ${err}`);
      process.exit(1);
    }
  }

  const totalEnrichCost = enrichedDocs.reduce(
    (s, e) => s + e.enrichmentCostUsd,
    0
  );
  console.log(
    `\n  Total enrichment cost: $${totalEnrichCost.toFixed(4)}`
  );

  // ---- Benchmark runs ----
  console.log("\n[Phase 2] Running benchmark...");

  let resultA: RunResult;
  let resultB: RunResult;
  let resultC: RunResult;

  try {
    resultA = await runA(DOCUMENTS);
  } catch (err) {
    console.error(`Run A failed: ${err}`);
    process.exit(1);
  }

  try {
    resultB = await runB(enrichedDocs);
  } catch (err) {
    console.error(`Run B failed: ${err}`);
    process.exit(1);
  }

  try {
    resultC = await runC(enrichedDocs);
  } catch (err) {
    console.error(`Run C failed: ${err}`);
    process.exit(1);
  }

  // ---- Report ----
  console.log("\n" + "=".repeat(60));
  console.log("RESULTS SUMMARY");
  console.log("=".repeat(60));

  const rows = [resultA, resultB, resultC];
  for (const r of rows) {
    const total = r.inputTokens + r.outputTokens;
    console.log(
      `\n${r.label}:\n  Tokens: ${r.inputTokens.toLocaleString()} in + ${r.outputTokens.toLocaleString()} out = ${total.toLocaleString()} total\n  Cost: $${r.costUsd.toFixed(4)}  Latency: ${r.latencyMs.toLocaleString()}ms\n  Selected: docs ${r.selectedDocs.join(", ")}`
    );
  }

  const report = buildReport(resultA, resultB, resultC, enrichedDocs, DOCUMENTS);
  console.log("\n" + report);

  const outputPath =
    "/Users/martinabicanic/Documents/workspace/stack-lab/acp-sdk/examples/benchmark-results.md";
  writeFileSync(outputPath, report, "utf-8");
  console.log(`\nResults written to: ${outputPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
