// Axios errors retain request headers, cookies and tokens. Never let those
// objects reach route logging or JSON responses.
export function upstreamError(error: unknown): Error {
  const source = error as { response?: { status?: number }; code?: string };
  const status = source?.response?.status;
  const message = status
    ? `Suno request failed (HTTP ${status}).${status === 401 || status === 403 ? ' Refresh SUNO_COOKIE.' : ''}`
    : 'Unable to reach Suno. The request timed out or the connection failed.';
  const safe = new Error(message) as Error & {
    response?: { status: number; statusText: string; data: { detail: string } };
    request?: boolean;
  };
  if (status) {
    safe.response = { status, statusText: message, data: { detail: message } };
  } else {
    safe.request = true;
  }
  return safe;
}
