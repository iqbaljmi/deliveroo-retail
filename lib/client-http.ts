export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  if (response.status === 401 && typeof window !== 'undefined') window.location.replace('/login');
  const text = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    const detail = response.status === 401
      ? 'Refresh the page and sign in again.'
      : response.status >= 500
        ? 'The local server failed. Restart the app server and retry.'
        : 'The server did not return a valid JSON response.';
    throw new Error(`${url.split('?')[0]} returned HTTP ${response.status}. ${detail}`);
  }
  if (!response.ok) {
    const error = data && typeof data === 'object' && 'error' in data ? data.error : null;
    throw new Error(typeof error === 'string' ? error : `HTTP ${response.status}`);
  }
  if (!data || typeof data !== 'object') throw new Error('The server returned an invalid response. Please retry.');
  return data as T;
}
