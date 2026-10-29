export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new ApiError('登录可能已过期，请重新打开管理后台登录。', 401);
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new ApiError(data.error || '请求失败，请稍后重试。', response.status);
  return data;
}
