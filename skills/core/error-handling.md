# Error Handling

- Validate inputs at boundaries; fail fast with clear messages
- No silent catches - always log or surface errors
- Use typed errors (custom Error subclasses) for recoverable cases
- Propagate errors upward; don't swallow them mid-stack
- User-facing errors must be human-readable
