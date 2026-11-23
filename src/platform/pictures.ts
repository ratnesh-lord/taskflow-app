/**
 * Task photos: picked from the phone's (or computer's) pictures, cropped
 * square, shrunk to 512 pixels and uploaded to the account's private
 * Storage folder. Shown through short-lived signed addresses, which only
 * the owner can get.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';

import { picturePath } from '@/core/appearance';
import { base64ToBytes } from '@/core/base64';

import { getSupabase } from './supabase';

const BUCKET = 'attachments';
const SIZE = 512;
const LINK_SECONDS = 24 * 60 * 60;

/** Lets the person pick a photo and uploads it; returns its storage path, or null if they cancelled. */
export async function pickAndUploadPicture(userId: string, taskId: string): Promise<string | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
  if (picked.canceled || !picked.assets?.length) return null;
  const asset = picked.assets[0];
  const context = ImageManipulator.manipulate(asset.uri);
  if ((asset.width ?? SIZE + 1) > SIZE) context.resize({ width: SIZE });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
  if (!saved.base64) throw new Error('The photo could not be prepared.');
  const unique = Math.random().toString(36).slice(2, 10);
  const path = picturePath(userId, taskId, unique, 'jpg');
  const { error } = await getSupabase().storage.from(BUCKET).upload(path, base64ToBytes(saved.base64), { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(`The photo could not be uploaded. Adding a photo needs a connection. (${error.message})`);
  return path;
}

const links = new Map<string, { url: string; until: number }>();

/** A cached address still good for at least a minute. */
function cachedLink(path: string | null): string | null {
  const entry = path ? links.get(path) : undefined;
  return entry && entry.until > Date.now() + 60_000 ? entry.url : null;
}

/** A short-lived address for a task photo, or null while it loads or when offline. */
export function usePictureUrl(path: string | null): string | null {
  const fresh = cachedLink(path);
  const [loaded, setLoaded] = useState<{ path: string; url: string } | null>(null);
  useEffect(() => {
    if (!path || fresh) return;
    let live = true;
    void getSupabase().storage.from(BUCKET).createSignedUrl(path, LINK_SECONDS).then(({ data }) => {
      if (!data?.signedUrl) return;
      links.set(path, { url: data.signedUrl, until: Date.now() + LINK_SECONDS * 1000 });
      if (live) setLoaded({ path, url: data.signedUrl });
    });
    return () => {
      live = false;
    };
  }, [path, fresh]);
  if (!path) return null;
  return fresh ?? (loaded?.path === path ? loaded.url : null);
}
