---
name: react-patterns
description: React component patterns and hooks best practices
category: frontend
source: local
tags: [react, components, hooks]
scope: [node, build]
priority: 80
---

# React Patterns

- Prefer functional components with hooks
- Keep components small and focused; extract custom hooks for logic
- Co-locate state with the component that owns it
- Use React.memo / useMemo / useCallback sparingly and only when measured
- Prop types should be explicit interfaces, never `any`
