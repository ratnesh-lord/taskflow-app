/**
 * Saving an export and opening a backup on the phone: the export is written
 * to the app's cache folder and handed to Android's share sheet (save to
 * Files or Drive, send by email…); a backup is chosen with the system file
 * picker. The web version is files.web.ts.
 */
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export async function saveTextFile(name: string, text: string): Promise<'shared' | 'saved'> {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  await file.write(text);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Save the TaskFlow backup' });
  return 'shared';
}

/** The chosen file's text, or null if the person cancelled. */
export async function pickTextFile(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.length) return null;
  return new File(result.assets[0].uri).text();
}
