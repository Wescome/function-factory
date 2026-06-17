export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/health') {
      return Response.json({ ok: true })
    }
    if (url.pathname === '/evaluate' && request.method === 'POST') {
      return Response.json({ permitted: true })
    }
    return new Response('Not Found', { status: 404 })
  },
}
