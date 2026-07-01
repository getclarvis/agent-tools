`callTool` / `dispatch` **never throw** for tool-level problems — they always resolve to a
`DispatchResult`:

```ts
interface DispatchResult {
  isError: boolean;
  text: string;
}
```

- **On success** (`isError: false`), `text` is the tool's output, already bounded to
  `maxOutputBytes`. It is plain text for every tool **except `bash`**, whose success `text` is a JSON
  object `{ exit_code, stdout, stderr, signal, timed_out }` — a non-zero exit is still a success.
- **On failure** (`isError: true`), `text` is a JSON [error envelope](/reference/error-codes). An
  unknown tool name — or a mutating tool while `readOnly` is set — comes back as `isError` with code
  `not_found`.
