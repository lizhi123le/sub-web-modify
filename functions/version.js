// Cloudflare Pages Functions - Version API

export async function onRequest(context) {
  const BACKEND_API_URL = context.env.BACKEND_API_URL || "https://url.v1.mk";
  
  try {
    const response = await fetch(`${BACKEND_API_URL}/version`, { 
      signal: AbortSignal.timeout(5000) 
    });
    
    if (response.ok) {
      const version = await response.text();
      return new Response(version, {
        status: 200,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    } else {
      return new Response(JSON.stringify({ 
        error: 'Backend error', 
        message: `HTTP ${response.status}`,
        backend: BACKEND_API_URL 
      }), {
        status: response.status,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
  } catch (e) {
    return new Response(JSON.stringify({ 
      error: 'Backend unavailable', 
      message: e.message,
      backend: BACKEND_API_URL 
    }), {
      status: 503,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
}
