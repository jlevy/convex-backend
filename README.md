# Convex Backend — Enhanced Documentation Fork

> [!NOTE] 
> 
> **This is a fork of [get-convex/convex-backend](https://github.com/get-convex/convex-backend)**
> 
> This is my ([@jlevy](https://github.com/jlevy)) fork for that I use for maintaining additional documentation
> assembled by Claude and other LLMs.
>
> The Convex code is identical but it's far more effective to locate docs next to the code so agentd like Claude can test and fact check docs against source. In fact, I think this is how docs should be written: by agents, for agents, automatically built to align with the code.

The original Convex repository contains the open-source reactive database for web apps.
This fork adds comprehensive research documentation and best practices guides that have
proven useful to keep close to the source code for reference during development.

---

## Why This Fork Exists

When building applications on Convex, I found it valuable to have detailed technical
documentation close to the actual backend source code. This includes:

- **Verified limits** cross-referenced against source code (not just official docs)
- **Undocumented behaviors** discovered through production experience
- **Best practices** synthesized from community knowledge and testing
- **Workflow architecture analysis** for building efficient durable workflows

These docs were assembled with help from Claude and other LLMs, then verified against
the Convex source code and official documentation.

---

## Documentation Index

### Core Research Documents

| Document | Description |
|----------|-------------|
| [**Convex Limits & Best Practices**](docs/general/research/current/research-convex-limits-best-practices.md) | Comprehensive 2200+ line guide covering all Convex platform limits, pitfalls, and workarounds |
| [**Durable Workflows Architecture**](docs/project/research/current/research-convex-durable-workflows-architecture.md) | Deep technical analysis of workflow/workpool components and overhead optimization |
| [**Limits Tracking**](docs/general/research/current/research-convex-limits-best-practices-tracking.md) | Document maintenance and expansion roadmap |

### Development Guidelines

| Document | Description |
|----------|-------------|
| [**Docs Overview**](docs/docs-overview.md) | How the documentation is organized |
| [**Convex Rules**](docs/general/agent-rules/convex-rules.md) | Coding rules for Convex development |
| [**TypeScript Rules**](docs/general/agent-rules/typescript-rules.md) | TypeScript best practices |
| [**Testing Guidelines**](docs/general/agent-guidelines/typescript-testing-guidelines.md) | Testing patterns for TypeScript/Convex |

### Experiments

| Document | Description |
|----------|-------------|
| [**Workflow Testing Harness**](docs/experiments/workflow-testing/README.md) | Test infrastructure for measuring workflow overhead |

---

## Research Document Summaries

### Convex Limits & Best Practices

[**→ Full Document**](docs/general/research/current/research-convex-limits-best-practices.md)

This comprehensive research brief covers all Convex platform limits with source code
verification. Key topics include:

**Core Limits Reference:**
- **Transaction limits**: 8 MiB read/write (docs) vs 16 MiB (source code default)
- **Document limits**: 1 MiB max size, 1024 fields, 16 levels nesting, 8192 array elements
- **Concurrency**: 16 default concurrent queries/mutations/actions (256+ on Professional)
- **Execution time**: 1s for queries/mutations, 10 min for actions
- **Memory**: 64 MB (Convex runtime) or 512 MB (Node.js runtime)
- **Indexes**: Up to 64 per table (32 documented), 16 fields per index
- **Logging**: 256 log lines per function (undocumented, silently truncates)

**Common Pitfalls & Workarounds:**
1. Exceeding 8 MiB read limit with `.collect()` → Use `.take()` or `.paginate()`
2. Large documents causing limit issues → Separate into detail tables
3. Counting large datasets → Use Convex Aggregate Component
4. Post-index filtering → Use composite indexes
5. OCC conflicts → Consolidate writes, use namespacing
6. Storage overages → Implement archival policies
7. Pagination loops in queries → Move to actions
8. Monotonic timestamp keys → Bucket timestamps
9. Dangling promises in actions → Always await async calls
10. Nested same-runtime action calls → Use helper functions

**Quick Reference Tables:**
- Complete limit values with source code locations
- Error message → solution mapping
- Decision matrix for common patterns

### Durable Workflows Architecture

[**→ Full Document**](docs/project/research/current/research-convex-durable-workflows-architecture.md)

Deep technical analysis of `@convex-dev/workflow` and `@convex-dev/workpool`:

**Key Findings:**
- **Per-step overhead**: 100-500ms from workpool coordination
- **5 scheduler hops per step**: Each step requires 5 ctx.scheduler round-trips
- **Journal replay**: O(N) cost—entire journal loaded on each continuation
- **Inter-iteration gap**: 1.2-1.5s typical, up to 6s with scheduler fallback

**Overhead Breakdown (from production measurement):**
| Category | % of Total |
|----------|------------|
| Raw LLM API time | 21% |
| Infrastructure overhead | 79% |

**Best Practices:**
- Minimize step count—batch operations into fewer steps
- Use parallel steps with `Promise.all()` when possible
- Store large data in DB, not journal (1 MiB soft limit, 8 MiB hard limit)
- Use workflows only when durability is required
- For < 10 min operations, consider direct action calls

**When to Use What:**
| Need | Solution |
|------|----------|
| Durability across restarts | Workflow |
| Operations > 10 minutes | Workflow |
| Rate limiting external APIs | Workpool directly |
| Simple async fire-and-forget | `ctx.scheduler` |
| High-frequency, low-latency | Direct function calls |

---

## Using This Fork

This fork stays synced with the upstream `get-convex/convex-backend` repository.
The additional documentation lives in `docs/` and doesn't modify the core Convex code.

To sync with upstream:
```bash
git fetch upstream
git merge upstream/main
```

---

## Original Convex Documentation

The sections below are from the original Convex repository:

### What is Convex?

[Convex](https://convex.dev) is the open-source reactive database designed to make life
easy for web app developers, whether human or LLM. Fetch data and perform business logic
with strong consistency by writing pure TypeScript.

Convex provides a database, a place to write your server functions, and client libraries.
It makes it easy to build and scale dynamic live-updating apps.
[Read the docs to learn more](https://docs.convex.dev/understanding/).

### Getting Started

Visit the [Convex documentation](https://docs.convex.dev/) to learn more and follow
getting started guides.

The easiest way to build with Convex is through the
[cloud platform](https://www.convex.dev/plans), which includes a generous free tier.

### Self Hosting

The self-hosted product includes most features of the cloud product, including the
dashboard and CLI. Check out the [self-hosting guide](./self-hosted/README.md) for
detailed instructions.

Community support for self-hosting is available in the `#self-hosted` channel on
[Discord](https://discord.gg/convex).

### Building from Source

See [BUILD.md](./BUILD.md).

### Community & Support

- Join the [Discord community](https://discord.gg/convex) for help and discussions
- Report issues through [GitHub Issues](https://github.com/get-convex/convex-backend/issues)

---

## Repository Layout

**Original Convex code:**
- `crates/` — Rust backend code
- `npm-packages/` — TypeScript packages (runtime, CLI, etc.)
- `self-hosted/` — Self-hosting guides and Docker configuration

**Enhanced documentation (this fork):**
- `docs/general/research/` — Cross-project research documents
- `docs/project/research/` — Project-specific research
- `docs/general/agent-rules/` — Development rules and guidelines
- `docs/general/agent-guidelines/` — Testing and coding guidelines
- `docs/experiments/` — Testing harnesses and experiments

---

## License

This fork maintains the same license as the original Convex repository.
The additional documentation is provided as-is for reference purposes.

---

<p align="center">
  <a href="https://github.com/get-convex/convex-backend">Original Repository</a> •
  <a href="https://docs.convex.dev/">Convex Docs</a> •
  <a href="https://discord.gg/convex">Discord</a>
</p>
