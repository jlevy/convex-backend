# Tracking doc for Convex Limits and Best Practices Brief

**Last Updated**: 2026-01-10

**Related**:

- [research-convex-limits-best-practices.md](research-convex-limits-best-practices.md) —
  The main document these suggestions apply to

* * *

## Document Overview

The `research-convex-limits-best-practices.md` document has grown significantly in scope
and size (2400+ lines).
This document captures structural observations and suggestions for improving its
organization, accessibility, and maintainability.

* * *

* * *

## Coverage Expansion TODOs

The following areas need to be added or expanded to make this a comprehensive “Convex
Platform Limits” document.
Each TODO includes the priority and estimated scope.

### High Priority (Significant Gaps)

- [x] **DONE: Integrate Backend Limits Implementation Doc** (Priority: High) ✅

  - Merged content from `research-convex-backend-limits-implementation.md` into main
    document

  - **Integration Status** (completed 2026-01-10):

    | Section | Status | Location in Main Doc |
    | --- | --- | --- |
    | Executive Summary | ✅ Covered | Different focus but overlaps |
    | Research Methodology | ✅ Covered | Appendix B |
    | Transaction Read/Write Limits | ✅ Covered | Core Limits Reference §1 |
    | Document Structure Limits | ✅ Covered | Core Limits Reference §2 |
    | Execution Time/Memory Limits | ✅ Covered | Core Limits Reference §3 |
    | Index and Schema Limits | ✅ Covered | Core Limits Reference §5 |
    | Concurrency/Scheduling Limits | ✅ Covered | Core Limits Reference §3 |
    | OCC Configuration | ✅ Covered | Pitfall 5 section |
    | Environment Variable Limits | ✅ Covered | Core Limits Reference §6 |
    | Knobs System Architecture | ✅ Integrated | Configuration System Architecture |
    | Comparative Analysis | ✅ Integrated | Configuration System Architecture |
    | Self-Hosted Best Practices | ✅ Integrated | Appendix E |
    | Appendix A: Knobs Reference | ✅ Integrated | Appendix C |
    | Appendix B: Hard-Coded Limits | ✅ Integrated | Appendix D |

  - All content integrated:

    - [x] Configuration System Architecture (knobs system explanation)

    - [x] Complete Knobs Reference (now Appendix C)

    - [x] Hard-Coded Limits Reference (now Appendix D)

    - [x] Self-hosted deployment configuration guidance (now Appendix E)

    - [x] Comparative Analysis (41 configurable vs 22 hard-coded)

  - The implementation doc has been deleted (all content now in main document)

- [x] **DONE: File Storage Limits Section** (Priority: High) ✅

  - Added as Section 8 in Core Limits Reference

  - Covers: concurrent uploads (4), parallel upload parts (8), max file size (2 TB
    theoretical), multipart buffer (200 MiB)

  - Includes URL/access patterns, storage quotas reference, key constraints

- [x] **DONE: HTTP Actions Section** (Priority: High) ✅

  - Added as Section 9 in Core Limits Reference

  - Covers: body limits (20 MiB request/response), timeout behavior, concurrency

  - Includes request/response handling, error messages, CORS notes

- [x] **DONE: Cron Jobs Section** (Priority: High) ✅

  - Added as Section 10 in Core Limits Reference

  - Covers: log retention (5 logs), log truncation (1,000 chars), execution behavior

  - Includes cron syntax reference, best practices

- [x] **DONE: Durable Workflows Section** (Priority: High) ✅

  - Added as Section 11 in Core Limits Reference

  - Covers: journal limit (8 MiB), step data (1 MiB), step count guidelines (~50 max)

  - Includes workflow patterns, memory considerations, key constraints

  - Cross-references `research-convex-durable-workflows-architecture.md`

### Medium Priority (Partial Coverage)

- [ ] **TODO: Real-time Subscriptions Section** (Priority: Medium)

  - Subscription count limits per client

  - Reactivity and invalidation behavior

  - Query dependency tracking limits

  - WebSocket connection limits

- [ ] **TODO: External API Calls from Actions** (Priority: Medium)

  - `fetch()` timeout defaults and configuration

  - Connection pooling behavior

  - DNS resolution limits

  - `MAX_CONCURRENT_ACTION_OPS`: 8 concurrent external operations (knobs.rs:944-945)

- [ ] **TODO: Schema/Migration Limits** (Priority: Medium)

  - Schema change frequency limits

  - Migration behavior and timeouts

  - Table rename/delete semantics

  - Index backfill limits: `INDEX_BACKFILL_CHUNK_SIZE` = 1024 (knobs.rs:446-447)

- [ ] **TODO: Backup/Export Limits** (Priority: Medium)

  - Export frequency limits

  - Snapshot/export size limits

  - Import limits: `MAX_IMPORT_AGE` = 7 days (knobs.rs:1406-1407)

  - `EXPORT_WORKER_PAGE_SIZE` = 1000 (knobs.rs:1473-1474)

### Lower Priority (Nice to Have)

- [ ] **TODO: Deployment Limits** (Priority: Low)

  - Number of deployments per project

  - Preview deployment limits

  - Team member limits by plan

  - Project limits

- [ ] **TODO: Component Limits** (Priority: Low)

  - Component installation limits

  - Component resource sharing

  - Inter-component communication limits

- [ ] **TODO: Rate Limiting** (Priority: Low)

  - API rate limits if applicable

  - Function call rate limits by plan

  - Dashboard/CLI rate limits

- [ ] **TODO: Authentication Limits** (Priority: Low)

  - Auth cache size: 1000 (`AUTH_CACHE_SIZE` in knobs.rs:1370)

  - Token validation limits

  - Session limits

### Documentation Quality

- [x] **DONE: Add Architectural Overview Section** (Priority: High) ✅

  - High-level overview of the Convex platform architecture and how components fit
    together

  - Brief description of each major subsystem (database, functions, storage, scheduling,
    etc.)

  - How limits apply to each architectural component

  - Brief overview of common challenges developers face

  - References to detailed sections later in the document for each component

  - **Added**: Platform Architecture diagram, "Where Limits Apply" table, "Common
    Challenges by Component" subsection

- [ ] **TODO: Add Interactive Examples** (Priority: Low)

  - Code snippets that can be copy-pasted

  - Before/after comparisons

  - Anti-pattern examples

## Structural Concerns

### 1. Document Structure and Organization

**Approach**: Keep as a single comprehensive document. Document size is acceptable as long
as it is well-structured, logical, and organized. Navigational aids (TOC, anchors) will be
handled separately at the rendering layer.

**Key structural priority**: Add Architectural Overview Section (Priority: High)

- Provide a mental model of the Convex platform before diving into limits

- Explain how components fit together (client → backend → database)

- Map each architectural component to its limit categories

- Brief overview of common challenges to orient readers

- This is NOT a user manual—it's a landscape view helping readers understand where
  different limits apply

### 2. Research Methodology Section Placement

**Current State**: Research methodology is near the top (lines 154-195), taking up prime
real estate before core content.

**Suggestion**: Move to an appendix.
Most readers want limits and best practices, not methodology.
Methodology is valuable for credibility but doesn’t need to be upfront.

### 3. Duplicate Information Across Tables and Prose

**Current State**: Many limits appear both in prose explanations and in summary tables
at the end. For example, transaction read limits appear in:

- Section 1: Transaction Read/Write Limits (prose)

- Quick Reference Tables: Limit Quick Reference (table)

**Concerns**:

- Updates require changes in multiple places

- Potential for inconsistency

- Increased document length

**Suggestions**:

1. **Single Source of Truth** (Priority: High)

   - Keep detailed tables as the authoritative reference

   - Prose sections should reference tables rather than repeat values

   - Example: “The transaction read limit (see Quick Reference Table) constrains …”

2. **Consolidate Related Sections**

   - Merge “Quick Reference Tables” with their corresponding sections

   - Or clearly mark quick reference as “summary only, see section X for details”

### 4. Pitfalls Section Organization

**Current State**: 10 pitfalls are listed sequentially (Pitfall 1 through Pitfall 10),
but they span different domains (database, concurrency, execution, storage).

**Suggestion**: Reorganize pitfalls by category:

```markdown
### Database Pitfalls
- Pitfall 1: Exceeding 8 MiB Read Limit with `.collect()`
- Pitfall 2: Large Documents Causing Read Limit Issues
- Pitfall 4: Post-Index Filtering Instead of Composite Indexes

### Execution Pitfalls
- Pitfall 7: Pagination Loops in Queries and Mutations
- Pitfall 9: Dangling Promises in Actions
- Pitfall 10: Nested Same-Runtime Action Calls

### Concurrency Pitfalls
- Pitfall 5: Optimistic Concurrency Control (OCC) Conflicts
- Pitfall 8: Bucket Timestamp Keys to Avoid Monotonic Writes

### Aggregation Pitfalls
- Pitfall 3: Counting and Aggregating Over Large Datasets

### Operations Pitfalls
- Pitfall 6: Storage and Bandwidth Overages
```

### 5. Best Practices Checklist Density

**Current State**: The best practices checklist (17 items) is dense and lacks visual
hierarchy.

**Suggestions**:

1. **Add Priority Indicators**

   - Mark critical practices vs.
     nice-to-have

   - Example: “🔴 Critical”, “🟡 Recommended”, “🟢 Good Practice”

2. **Add “Why” Context**

   - Brief explanation of consequence if not followed

   - Example: "Never use `.collect()` on unbounded tables → *Can cause transaction
     failures at scale*"

3. **Create Tiered List**

   - “Must Do” (will cause failures if ignored)

   - “Should Do” (best practice, prevents problems)

   - “Consider” (optimization, depends on use case)

### 6. Version and Verification Information

**Current State**: Document includes verification status (✅) and source code line
references scattered throughout.

**Suggestion**: Add a dedicated “Verification Log” appendix:

```markdown
## Appendix: Verification Log

| Limit | Last Verified | Source Code | Doc Reference | Notes |
|-------|---------------|-------------|---------------|-------|
| Transaction read size | 2026-01-09 | knobs.rs:355 | docs.convex.dev/... | Discrepancy noted |
```

This centralizes verification tracking and makes updates easier.

### 7. Missing Document Metadata

**Suggestions**:

1. **Add Intended Audience**

   - Primary: Developers building on Convex

   - Secondary: Self-hosted operators

   - Tertiary: Convex contributors understanding limits

2. **Add Prerequisites**

   - Assumes familiarity with Convex basics

   - Assumes understanding of TypeScript/JavaScript

   - Links to introductory docs

3. **Add Reading Order Guidance**

   - “If you’re new, start with Executive Summary and Quick Reference”

   - “If you hit an error, check Common Error Messages table”

   - “If self-hosting, see Appendix B for configuration”

* * *

## Content Organization Suggestions

### Proposed Document Structure

If keeping as a single document, reorganize sections for better flow:

```
1. Executive Summary (keep short)
2. Architectural Overview (NEW)
   2.1 Platform Architecture - How Convex components fit together
   2.2 Limit Categories by Component - Where limits apply
   2.3 Common Challenges Overview - What developers typically encounter
3. Core Limits Reference
   3.1 Database Layer
       - Transaction Limits (read/write)
       - Document Limits (size, structure)
       - Index and Schema Limits
   3.2 Function Execution
       - Execution Limits (timeouts, memory)
       - Concurrency Limits
       - Function Composition Rules
   3.3 Storage and External
       - File Storage Limits
       - HTTP Actions
       - External API Calls
   3.4 Scheduling and Background
       - Scheduled Functions
       - Cron Jobs
       - Durable Workflows
   3.5 Real-time and Subscriptions
4. Common Pitfalls (grouped by category)
5. Best Practices Checklist
6. Decision Matrices and Quick Reference Tables
7. Appendices
   A. Self-Hosted Configuration Reference (knobs, env vars)
   B. Hard-Coded Limits Reference (source code locations)
   C. Source Code Verification Log
   D. Areas for Convex Improvement (feedback)
   E. Research Methodology
```

### Content to Add

Per the TODOs already added to the main document:

| Section | Priority | Estimated Lines | Complexity |
| --- | --- | --- | --- |
| **Architectural Overview** | High | 150-200 | Medium |
| **Integrate Backend Limits Implementation Doc** | High | 200-300 | Medium |
| File Storage Limits | High | 50-100 | Medium |
| HTTP Actions | High | 50-75 | Medium |
| Cron Jobs | High | 50-75 | Medium |
| Durable Workflows | High | 100-150 | High |
| Real-time Subscriptions | Medium | 50-75 | Medium |
| External API Calls | Medium | 30-50 | Low |
| Schema/Migration | Medium | 50-75 | Medium |
| Backup/Export | Medium | 50-75 | Medium |

**Note on Integration**: The `research-convex-backend-limits-implementation.md` document
contains valuable content that should be merged:

- Knobs system architecture explanation

- Complete environment variable reference (Appendix A)

- Hard-coded limits reference with Rust code (Appendix B)

- Comparative analysis (41 configurable vs 22 hard-coded)

- Self-hosted configuration guidance

After integration, the implementation doc can be deprecated or archived.

### Appendix Organization Principles

Use appendices sensibly for:

1. **Very specific code locations** - Rust source file references, line numbers

2. **Technical tables** - Complete knobs references, hard-coded constants with types

3. **Self-hosted configuration** - Environment variable reference for operators

4. **Verification logs** - Source code verification tracking

Keep in main body:

- Conceptual explanations and rationale

- Best practices and patterns

- Workarounds and pitfalls

- Decision matrices for common scenarios

**Goal**: Main body should be readable by developers; appendices provide precision for
operators and contributors who need exact technical details.

* * *

## Maintenance Suggestions

### 1. Establish Update Cadence

- Review limits against Convex docs quarterly

- Re-verify source code references after major Convex releases

- Track Convex changelogs for limit changes

### 2. Create Limit Change Tracking

When limits change:

1. Update the relevant section

2. Update Quick Reference table

3. Add note to changelog (consider adding changelog section)

4. Update verification log

### 3. Community Contribution

If this document becomes public-facing:

- Add contribution guidelines

- Create issue template for reporting discrepancies

- Tag sections with confidence level (verified, unverified, anecdotal)

* * *

## Implementation Priority

### Phase 1: Foundation (2-3 hours)

1. ✅ Add TODO comments for missing sections (DONE)

2. ✅ Update title to reflect broader scope (DONE)

3. ✅ Add Architectural Overview section (platform architecture, component map, common
   challenges) (DONE)

4. ✅ Move research methodology to appendix as "Writing and Maintenance Process" (DONE)

### Phase 2: Content Expansion (4-8 hours)

1. ✅ Integrate Backend Limits Implementation Doc (knobs reference, hard-coded limits) (DONE)

2. ✅ Add File Storage Limits section (DONE - Section 8)

3. ✅ Add HTTP Actions section (DONE - Section 9)

4. ✅ Add Cron Jobs section (DONE - Section 10)

5. ✅ Add Durable Workflows section (DONE - Section 11)

### Phase 3: Structural Improvements (2-4 hours)

1. Reorganize limits by component (database, execution, storage, scheduling)

2. Reorganize pitfalls by category

3. Add priority indicators to best practices

4. Consolidate duplicate information between prose and tables

### Phase 4: Polish (2-3 hours)

1. Add verification log appendix

2. Add document metadata (audience, prerequisites)

3. Review for consistency and clarity

4. Add remaining medium/low priority sections (subscriptions, external API, etc.)

* * *

## Decision Required

Before proceeding with structural changes, decide:

1. **Single Document vs.
   Split?**

   - Single document is easier to search

   - Split documents are easier to navigate

   - Recommendation: Keep single document with better navigation for now

2. **Target Audience Priority?**

   - If primarily for internal reference: Keep technical depth

   - If for external developers: Add more context and examples

   - Recommendation: Optimize for developers building on Convex

3. **Integration with Official Docs?**

   - Should this supplement or duplicate official Convex docs?

   - Recommendation: Position as “extended reference with source code verification” that
     complements rather than replaces official docs

* * *

## Summary

The Convex limits document is comprehensive and valuable but would benefit from:

1. **Better navigation** (TOC, anchors)

2. **Quick reference summary** for common cases

3. **Category-based organization** of pitfalls

4. **Expanded coverage** of missing platform areas (file storage, HTTP actions, cron,
   workflows)

5. **Reduced duplication** between prose and tables

6. **Clearer maintenance process** for keeping information current

The TODOs added to the main document provide a roadmap for content expansion.
This companion document provides the structural perspective for how to organize that
content effectively.
