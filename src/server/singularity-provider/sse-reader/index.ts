const extractData = (block: string): string | undefined => {
  const data = block
    .split('\n')
    .filter((line) => !line.startsWith(':'))
    .filter((line) => line === 'data' || line.startsWith('data:'))
    .map((line) => {
      const value = line.slice(5);
      return value.startsWith(' ') ? value.slice(1) : value;
    });

  return data.length > 0 ? data.join('\n') : undefined;
};

export async function* readSseData(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replaceAll('\r\n', '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = extractData(block);
        if (data !== undefined) {
          yield data;
        }
        boundary = buffer.indexOf('\n\n');
      }

      if (done) {
        const data = extractData(buffer);
        if (data !== undefined) {
          yield data;
        }
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
