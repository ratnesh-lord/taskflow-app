/**
 * The app's handle on Google authorization on Android (android/…/TaskflowGoogleModule.kt).
 * In a browser, or a build without the module, `googleNative` is null.
 */
import { requireOptionalNativeModule } from 'expo';

export type NativeGrant = { accessToken: string | null; grantedScopes: string[] };

type Native = {
  authorize(scopes: string[], interactive: boolean): Promise<NativeGrant | null>;
  clearToken(token: string): Promise<void>;
};

export const googleNative = requireOptionalNativeModule<Native>('TaskflowGoogle');
