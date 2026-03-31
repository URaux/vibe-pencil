---
name: api-design
description: REST API conventions and backend design patterns
category: backend
source: local
tags: [api, rest, backend]
scope: [node, build]
priority: 80
---

# REST API Conventions

- Resource-based URLs: nouns not verbs (/users not /getUsers)
- Use appropriate HTTP methods (GET/POST/PUT/PATCH/DELETE)
- Return consistent error shapes: { error: string, code?: string }
- Paginate list endpoints; never return unbounded arrays
- Validate all request bodies before processing
