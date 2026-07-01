export type WarnSink = (message: string) => void;

const defaultSink: WarnSink = (message) => {
  process.stderr.write(message);
};

let sink: WarnSink = defaultSink;

export function warn(message: string): void {
  sink(message);
}

export function setWarnSink(fn: WarnSink | null): void {
  sink = fn ?? defaultSink;
}
