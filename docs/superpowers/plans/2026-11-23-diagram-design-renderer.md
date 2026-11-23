# diagram-design Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current card renderer with a deterministic diagram-design Architecture-styled SVG→PNG renderer.

**Architecture:** Keep the existing model JSON and daily workflow unchanged. Render a 960-wide logical editorial SVG, overlay sharp text, and export 2x PNG. Follow diagram-design tokens, three tiers, orthogonal connectors, and one focal treatment.

**Tech Stack:** TypeScript, sharp, existing tsx scripts, pnpm workspaces.

---

### Task 1: Regression contract

**Files:**
- Modify: `scripts/test-daily.mjs`

- [ ] **Step 1: Write failing renderer assertions**

Add imports for exported SVG helpers from `server/src/ai/architecture.ts`. Assert minimal sample output has logical width 960, height 600, one focal node, three tier bands, orthogonal `H`/`V` connector path segments, and no `filter:`/drop-shadow.

- [ ] **Step 2: Run and verify RED**

Run isolated `test-daily.mjs` with fixture paths and font. Expected failure: helper export missing or old dimensions.

### Task 2: Editorial renderer

**Files:**
- Modify: `server/src/ai/architecture.ts`

- [ ] **Step 1: Replace layout with deterministic three-tier renderer**

Implement token constants, 4px grid, title block, tier bands, node boxes, focal treatment, and orthogonal edge routing. Export `buildArchitectureSVG(repo, analysis)` returning logical SVG plus dimensions.

- [ ] **Step 2: Export 2x PNG**

Keep text overlay loading and font caching. Render SVG with density 192 and export PNG. Throw existing `DIAGRAM_TEXT_OVERFLOW` when text cannot fit at 12px.

- [ ] **Step 3: Run and verify GREEN**

Run renderer-focused `test-daily.mjs`; architecture metadata assertions pass.

### Task 3: Complex layout coverage

**Files:**
- Modify: `scripts/test-daily.mjs`

- [ ] **Step 1: Add nine-node overflow test**

Construct nine nodes across all tiers and multiple edges. Assert logical height exceeds 600, PNG width is 1920, PNG height equals twice logical height, and both stay within content API maxima.

### Task 4: Full validation and documentation

**Files:**
- Modify: `README.md`
- Modify: `server/src/ai/blog-format.ts`
- Modify: `server/src/ai/daily.ts`

- [ ] **Step 1: Update workflow metadata**

Change workflow version to `qualified-candidates-flexible-png-v12` and diagram engine wording to diagram-design Architecture 规范.

- [ ] **Step 2: Update README renderer description**

Replace Archify description with diagram-design-derived deterministic renderer and 1920×1200 minimum output.

- [ ] **Step 3: Run build and focused regressions**

Run `pnpm build`; isolated `test-daily.mjs`; `test-daily-provider.mjs`; `test-research-policy.mjs`. Expected: build exit 0, 69+ daily checks pass, provider 9 checks pass, research policy checks pass.

### Task 5: Review and deploy

- [ ] **Step 1: Review diff and commit**

Inspect `git diff --check`, status, and full diff. Commit with `feat(daily): adopt diagram-design architecture style`.

- [ ] **Step 2: Push branch/main and deploy**

Push `main`, create timestamped source/build/version backup under `/root/cyberblog-cms-backups/`, sync build to production app, restart `cyber-cms.service`, verify service health and API version/status.

- [ ] **Step 3: Verify production smoke**

Use production health/API endpoint and generate a renderer-only smoke PNG via a temporary process outside source tree; confirm metadata 1920×1200 or expanded dimensions. Remove temporary artifact.
