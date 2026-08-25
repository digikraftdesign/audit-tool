export class ApiError extends Error {
  payload: unknown;
  constructor(message: string, payload?: unknown) {
    super(message);
    this.payload = payload;
  }
}

async function parse(res: Response): Promise<Record<string, unknown>> {
  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new ApiError(
      `The server returned an unexpected response (HTTP ${res.status}).`,
    );
  }
  if (!res.ok || !data.ok) {
    throw new ApiError(
      typeof data.error === 'string'
        ? data.error
        : `Request failed (HTTP ${res.status})`,
      data,
    );
  }
  return data;
}

export async function apiGet(
  path: string,
  query?: Record<string, string>,
): Promise<Record<string, unknown>> {
  const url = new URL(path, window.location.origin);
  if (query) {
    Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  });
  return parse(res);
}

export async function apiPost(
  path: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    credentials: 'same-origin',
    body: JSON.stringify(body ?? {}),
  });
  return parse(res);
}

export async function apiUpload(file: File): Promise<Record<string, unknown>> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
    body: form,
  });
  return parse(res);
}

export async function login(passcode: string) {
  return apiPost('/api/login', { passcode });
}

export async function createAudit(body: Record<string, unknown>) {
  return apiPost('/api/audits', body);
}

export async function getAudit(id: string, token: string) {
  return apiGet(`/api/audits/${encodeURIComponent(id)}`, { token });
}

export async function runStep(id: string, token: string, step: string) {
  return apiPost(`/api/audits/${encodeURIComponent(id)}/step`, {
    token,
    step,
  });
}

export async function setParameterScore(
  id: string,
  token: string,
  parameter: string,
  score: number | null,
) {
  return apiPost(`/api/audits/${encodeURIComponent(id)}/score`, {
    token,
    parameter,
    score,
  });
}

export async function closeAudit(
  id: string,
  token: string,
  body: Record<string, unknown>,
) {
  return apiPost(`/api/audits/${encodeURIComponent(id)}/close`, {
    token,
    ...body,
  });
}

export async function fetchRecent() {
  return apiGet('/api/recent');
}
