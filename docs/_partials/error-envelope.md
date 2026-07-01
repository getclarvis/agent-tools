Every failure — for every tool — is serialized as a single JSON object:

```json
{ "error": "<code>", "message": "<human-readable description>" }
```

Some codes add fields (for example, a failing `multi_edit` reports the failing edit index in its
`message`). The `error` value is one of the stable [error codes](/reference/error-codes); parse it,
don't match on `message` text.
