// Cloudflare Pages Functions - Sub API Proxy
export async function onRequest(request) {
  var url = new URL(request.url);
  var backendUrl = "https://url.v1.mk";
  var backendPath = url.pathname + url.search;
  
  var response = await fetch(backendUrl + backendPath, {
    method: request.method,
    headers: {
      "User-Agent": "Sub-Web-Modify/1.0"
    }
  });
  
  var responseHeaders = new Headers();
  for (var pair of response.headers.entries()) {
    responseHeaders.set(pair[0], pair[1]);
  }
  responseHeaders.set("Access-Control-Allow-Origin", "*");
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders
  });
}
