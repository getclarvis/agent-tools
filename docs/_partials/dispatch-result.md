`callTool` / `dispatch` **never throw** for tool-level problems — they always resolve to a
`DispatchResult`:

```ts
interface DispatchResult {
  isError: boolean;
  content: ContentPart[]; // TextPart { type: "text"; text } | ImagePart { type: "image"; data; mimeType }
  meta?: Record<string, unknown>; // structured sidecar for a client (never shown to the model)
}
```

- **On success** (`isError: false`), `content` carries the tool's output as an array of parts. Most
  tools return a single text part, bounded to `maxOutputBytes`; `read_image` returns a single image
  part. For `bash`, the text part is a JSON object `{ exit_code, stdout, stderr, signal, timed_out }`
  — a non-zero exit is still a success. `contentText(content)` concatenates the text parts into a
  string.
- **`meta`** is present only when a tool has structured data for a client to render out-of-band. The
  editing tools set `meta.diff` to a real unified diff of the change: `edit_file`, `multi_edit`,
  `write_file` (overwrite only), and `replace` (on apply). The `content` text stays the short prose
  summary; the diff never reaches the model. Absent when there is nothing to diff (a brand-new
  `write_file`, or an overwrite whose prior content is binary/unreadable).
- **On failure** (`isError: true`), `content` is a single text part holding a JSON
  [error envelope](/reference/error-codes). An unknown tool name — or a mutating tool while
  `readOnly` is set — comes back as `isError` with code `not_found`.
