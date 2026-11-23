import { authHeaders } from './session';

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`Request failed: ${status}`);
  }
}

interface Parser<T> {
  parse(value: unknown): T;
}

export async function apiGet<T>(path: string, schema: Parser<T>): Promise<T> {
  const response = await fetch(path, { headers: authHeaders(), cache: 'no-store' });
  if (!response.ok) throw new ApiError(response.status);
  return schema.parse(await response.json());
}

export async function apiPost<T>(path: string, schema: Parser<T>, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new ApiError(response.status);
  return schema.parse(await response.json());
}
