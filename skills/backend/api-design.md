# REST API Conventions

- Resource-based URLs: nouns not verbs (/users not /getUsers)
- Use appropriate HTTP methods (GET/POST/PUT/PATCH/DELETE)
- Return consistent error shapes: { error: string, code?: string }
- Paginate list endpoints; never return unbounded arrays
- Validate all request bodies before processing
