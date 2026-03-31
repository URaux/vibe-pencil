---
name: vitest
description: Vitest testing patterns and conventions
category: testing
source: local
tags: [testing, vitest, unit-tests]
scope: [build]
priority: 80
---

# Vitest Test Patterns

- Name tests: "it should [behavior] when [condition]"
- Arrange-Act-Assert structure in every test
- Mock only what crosses a boundary (I/O, external APIs)
- Keep tests independent; no shared mutable state
- Test behavior, not implementation details
