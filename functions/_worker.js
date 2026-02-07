// Cloudflare Pages Functions - Version API

async function onRequest(request) {
  var backendApi = "https://url.v1.mk";
  var backendVersionUrl = backendApi + "/version";

  return new Response(JSON.stringify({
    test: "version route is working",
    backend: backendApi,
    url: backendVersionUrl,
    timestamp: new Date().toISOString()
  }), {
    headers: { "Content-Type": "application/json" }
  });
}

export { onRequest };
