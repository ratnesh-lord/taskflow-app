/**
 * Saving an export and opening a backup in the browser: a normal download,
 * and the browser's file chooser.
 */
export async function saveTextFile(name: string, text: string): Promise<'shared' | 'saved'> {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
}

/** The chosen file's text, or null if the person closed the chooser. */
export function pickTextFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(null);
      file.text().then(resolve, () => resolve(null));
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}

/** Any file the person picks in the browser's chooser; null if they closed it. */
export function pickAnyFile(): Promise<{ name: string; mimeType: string | null; size: number | null; bytes: () => Promise<ArrayBuffer> } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      resolve(file ? { name: file.name, mimeType: file.type || null, size: file.size, bytes: () => file.arrayBuffer() } : null);
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}
