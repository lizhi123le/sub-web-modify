// Cloudflare Pages Functions - Version API
// 直接返回后端版本信息

async function onRequest(request) {
  var backendApi = "https://url.v1.mk";
  var backendVersionUrl = backendApi + "/version";

  var version = "unknown";

  try {
    var response = await fetch(backendVersionUrl);
    if (response.ok) {
      version = await response.text();
    }
  } catch (e) {
    version = "Error: " + e.message;
  }

  return new Response(version, {
    headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
}

export { onRequest };
