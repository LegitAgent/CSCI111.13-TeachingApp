export async function readApiResponse<T>(response: Response, fallback: string): Promise<T> {
  const unavailable = `${fallback} (HTTP ${response.status}). Please try again.`
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(unavailable)
  let data: unknown
  try { data = await response.json() } catch { throw new Error(unavailable) }
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
      ? data.error : unavailable
    throw new Error(message)
  }
  return data as T
}
