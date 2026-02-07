// Cloudflare Pages Functions - Version API Test

async function onRequest(request) {
  return new Response(JSON.stringify({
    message: "Version API is working",
    timestamp: new Date().toISOString(),
    backend: "https://url.v1.mk"
  }), {
    headers: { "Content-Type": "application/json" }
  });
}

export { onRequest };
