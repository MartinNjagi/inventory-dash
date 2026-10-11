import { Client, Account, Functions, Storage, ID, OAuthProvider, ExecutionMethod } from 'appwrite';

const env = import.meta.env;
const client = new Client().setEndpoint(env.VITE_APPWRITE_ENDPOINT).setProject(env.VITE_APPWRITE_PROJECT_ID);
export const account = new Account(client);
const functions = new Functions(client);
const storage = new Storage(client);

// Token flow (not createOAuth2Session): Appwrite redirects back with ?userId&secret, and we exchange
// them for a session ourselves. This avoids third-party-cookie problems when the site and the
// Appwrite API are on different domains.
export function loginWithGoogle() {
  account.createOAuth2Token({
    provider: OAuthProvider.Google,
    success: window.location.origin + '/',
    failure: window.location.origin + '/?login=failed',
  });
}
export const completeLogin = (userId, secret) => account.createSession({ userId, secret });
export const logout = () => account.deleteSession({ sessionId: 'current' });

// Thumbnails come from Appwrite's preview endpoint (resized + webp) to protect the 5 GB/month bandwidth cap.
export const imageUrl = (fileId, width = 400) =>
  fileId
    ? `${env.VITE_APPWRITE_ENDPOINT}/storage/buckets/${env.VITE_APPWRITE_BUCKET_ID}/files/${fileId}/preview` +
      `?project=${env.VITE_APPWRITE_PROJECT_ID}&width=${width}&quality=70&output=webp`
    : null;

// All backend calls go through createExecution so Appwrite attaches the signed-in user's identity.
export async function api(method, path, body) {
  const ex = await functions.createExecution({
    functionId: env.VITE_APPWRITE_FUNCTION_ID,
    xpath: path,
    method: ExecutionMethod[method],
    body: body ? JSON.stringify(body) : undefined,
    async: false,
    headers: { 'content-type': 'application/json' },
  });
  let data = {};
  try { data = JSON.parse(ex.responseBody); } catch { /* empty body */ }
  if (ex.responseStatusCode >= 400) {
    throw Object.assign(new Error(data.error || `Request failed (${ex.responseStatusCode})`), {
      status: ex.responseStatusCode,
      data,
    });
  }
  return data;
}

// ---- Admin image handling ----
// Shrinks to max 800px WebP (~50-100 KB) before upload so the 2 GB storage / 5 GB bandwidth caps last.
export async function shrinkImage(file, max = 800) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', 0.82));
  if (!blob) throw new Error('Could not process that image');
  return new File([blob], 'item.webp', { type: 'image/webp' });
}

// Needs the bucket's create/delete permission set to the "admin" label (see setup notes).
export async function uploadImage(file) {
  const small = await shrinkImage(file);
  const res = await storage.createFile({ bucketId: env.VITE_APPWRITE_BUCKET_ID, fileId: ID.unique(), file: small });
  return res.$id;
}
export const deleteImage = (fileId) =>
  storage.deleteFile({ bucketId: env.VITE_APPWRITE_BUCKET_ID, fileId }).catch(() => {}); // best effort
