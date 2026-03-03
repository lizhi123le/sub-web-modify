// Cloudflare Pages Functions - Sub API Proxy (优化版)
// 绑定要求：KV 命名空间绑定为 SUB_CACHE（可选），环境变量 BACKEND_API_URL（可选），KEEP_KV_FOR_DEBUG（可选）

const DEFAULT_BACKEND = "https://url.v1.mk";

// --- Module-scope short local cache to reduce KV calls across requests ---
const moduleLocalCache = new Map();

// Helper: determine if env.SUB_CACHE is a KV binding
function isKVBinding(obj) {
  return obj && typeof obj.get === "function" && typeof obj.put === "function";
}

// --- Utilities (base64, random, parsing, obfuscation) ---
function generateRandomStr(len) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < len; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

function generateRandomUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c == "x" ? r : (r & 3) | 8;
    return v.toString(16);
  });
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function utf8ToBase64(str) {
  try {
    return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  } catch (e) {
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
}

function base64ToUtf8Safe(b64) {
  try {
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64);
    try {
      return decodeURIComponent(escape(binary));
    } catch (e) {
      return binary;
    }
  } catch (e) {
    return b64;
  }
}

function urlSafeBase64Encode(input) {
  return utf8ToBase64(input);
}

function urlSafeBase64Decode(input) {
  try {
    return base64ToUtf8Safe(input);
  } catch (e) {
    return input;
  }
}

function parseData(data) {
  if (data.includes("proxies:")) return { format: "yaml", data: data };
  try {
    const decoded = urlSafeBase64Decode(data.trim());
    if (decoded && (decoded.includes("://") || decoded.includes("proxies:"))) return { format: "base64", data: decoded };
  } catch (e) {}
  return { format: "unknown", data: data };
}

// --- IPv6 normalization and host extraction helpers ---
// Normalize server string: remove surrounding brackets (including encoded %5B/%5D) and return bare host
function normalizeServer(server) {
  if (!server) return server;
  try {
    server = decodeURIComponent(server);
  } catch (e) {}
  if (server.startsWith('[') && server.endsWith(']')) return server.slice(1, -1);
  if (/^%5B/i.test(server) && /%5D$/i.test(server)) {
    return server.replace(/^%5B/i, '').replace(/%5D$/i, '');
  }
  return server;
}

// Helper: from an array of capture groups, return first non-empty (compat for non-named groups)
function firstNonEmpty(...groups) {
  for (const g of groups) {
    if (typeof g === "string" && g.length > 0) return g;
  }
  return null;
}

// --- Obfuscation helpers (keeps same semantics as previous implementation) ---
function replaceInUri(link, replacements, isRecovery) {
  if (link.startsWith("ss://")) return replaceSS(link, replacements, isRecovery);
  if (link.startsWith("ssr://")) return replaceSSR(link, replacements, isRecovery);
  if (link.startsWith("vmess://")) return replaceVmess(link, replacements, isRecovery);
  if (link.startsWith("trojan://") || link.startsWith("vless://")) return replaceTrojan(link, replacements, isRecovery);
  if (link.startsWith("hysteria://")) return replaceHysteria(link, replacements, isRecovery);
  if (link.startsWith("hysteria2://")) return replaceHysteria2(link, replacements, isRecovery);
  if (link.startsWith("socks://") || link.startsWith("socks5://")) return replaceSocks(link, replacements, isRecovery);
  return link;
}

function replaceSS(link, replacements, isRecovery) {
  const randomPassword = generateRandomStr(12);
  const randomDomain = randomPassword + ".com";
  let tempLink = link.slice(5).split("#")[0];
  if (tempLink.includes("@")) {
    const match = tempLink.match(/(\S+?)@((?:\[[\da-fA-F:]+\])|(?:[\da-fA-F:]+)|(?:[\d.]+)|(?:[\w\.-]+)):/);
    if (!match) return link;
    const base64Data = match[1];
    const serverRaw = match[2];
    try {
      const decoded = urlSafeBase64Decode(base64Data);
      const parts = decoded.split(":");
      if (parts.length < 2) return link;
      const encryption = parts[0];
      const password = parts.slice(1).join(":");
      const server = normalizeServer(serverRaw);
      replacements[randomDomain] = server;
      replacements[randomPassword] = password;
      const newStr = urlSafeBase64Encode(encryption + ":" + randomPassword);
      return link.replace(base64Data, newStr).replace(serverRaw, randomDomain);
    } catch (e) { return link; }
  }
  return link;
}

function replaceVmess(link, replacements, isRecovery) {
  let tempLink = link.replace("vmess://", "");
  try {
    const decoded = urlSafeBase64Decode(tempLink);
    const jsonData = JSON.parse(decoded);
    const serverRaw = jsonData.add;
    const server = normalizeServer(serverRaw);
    const uuid = jsonData.id;
    const randomDomain = generateRandomStr(10) + ".com";
    const randomUUID = generateRandomUUID();
    replacements[randomDomain] = server;
    replacements[randomUUID] = uuid;
    jsonData.add = randomDomain;
    jsonData.id = randomUUID;
    return "vmess://" + utf8ToBase64(JSON.stringify(jsonData));
  } catch (e) {
    return link;
  }
}

function replaceTrojan(link, replacements, isRecovery) {
  // capture: proto, uuid, host (host may be [ipv6] or ipv6 or ipv4 or hostname)
  const re = /(vless|trojan):\/\/(.*?)@((?:\[[\da-fA-F:]+\])|(?:[\da-fA-F:]+)|(?:[\d.]+)|(?:[\w\.-]+)):/;
  const match = link.match(re);
  if (!match) return link;
  const proto = match[1];
  const uuid = match[2];
  const rawHost = match[3]; // may include brackets
  const server = normalizeServer(rawHost);

  if (isRecovery) {
    const original = replacements[server];
    return original ? link.replace(rawHost, original) : link;
  } else {
    const randomDomain = generateRandomStr(10) + ".com";
    const randomUUID = generateRandomUUID();
    replacements[randomDomain] = server;
    replacements[randomUUID] = uuid;
    return link.replace(uuid, randomUUID).replace(rawHost, randomDomain);
  }
}

function replaceSSR(link, replacements, isRecovery) {
  try {
    let data = link.slice(6).replace("\r", "").split("#")[0];
    let decoded = urlSafeBase64Decode(data);
    const match = decoded.match(/((?:\[[\da-fA-F:]+\])|(?:[\da-fA-F:]+)|(?:[\w\.-]+)):(\d+?):(\S+?):(\S+?):(\S+?):(\S+)\//);
    if (!match) return link;
    const serverRaw = match[1];
    const server = normalizeServer(serverRaw);
    const port = match[2];
    const proto = match[3];
    const method = match[4];
    const obfs = match[5];
    const passwordEncoded = match[6];

    if (isRecovery) {
      const originalServer = replacements[server];
      const originalPass = replacements[urlSafeBase64Decode(passwordEncoded)];
      if (!originalServer || !originalPass) return link;
      const recovered = decoded.replace(serverRaw, originalServer).replace(passwordEncoded, urlSafeBase64Encode(originalPass));
      return "ssr://" + urlSafeBase64Encode(recovered);
    } else {
      const randomDomain = generateRandomStr(12) + ".com";
      const randomPass = generateRandomStr(12);
      replacements[randomDomain] = server;
      replacements[randomPass] = urlSafeBase64Decode(passwordEncoded);
      const replaced = decoded.replace(serverRaw, randomDomain).replace(passwordEncoded, urlSafeBase64Encode(randomPass));
      return "ssr://" + urlSafeBase64Encode(replaced);
    }
  } catch (e) { return link; }
}

function replaceSocks(link, replacements, isRecovery) {
  try {
    let temp = link.replace(/^socks5?:\/\//, "");
    const hashSplit = temp.split("#");
    const hashPart = hashSplit.length > 1 ? "#" + hashSplit[1] : "";
    temp = hashSplit[0];
    const atIndex = temp.indexOf("@");
    const fakeIP = `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
    const randomPass = generateRandomStr(12);

    if (atIndex !== -1) {
      const authBase64 = temp.slice(0, atIndex);
      const serverPort = temp.slice(atIndex + 1);
      const auth = atob(authBase64);
      const [user, pass] = auth.split(":");
      const serverMatch = serverPort.match(/^(((?:\[[\da-fA-F:]+\])|(?:[\da-fA-F:]+)|(?:[\d.]+)|(?:[\w\.-]+))):(\d+)$/);
      if (!serverMatch) return link;
      const serverRaw = serverMatch[1];
      const server = normalizeServer(serverRaw);
      const port = serverMatch[3];
      replacements[fakeIP] = server;
      if (pass) replacements[randomPass] = pass;
      return `socks://${utf8ToBase64(user + ":" + randomPass)}@${fakeIP}:${port}${hashPart}`;
    } else {
      const serverMatch = temp.match(/^(((?:\[[\da-fA-F:]+\])|(?:[\da-fA-F:]+)|(?:[\d.]+)|(?:[\w\.-]+))):(\d+)$/);
      if (!serverMatch) return link;
      const serverRaw = serverMatch[1];
      const server = normalizeServer(serverRaw);
      const port = serverMatch[3];
      replacements[fakeIP] = server;
      return `socks://${fakeIP}:${port}${hashPart}`;
    }
  } catch (e) { return link; }
}

function replaceHysteria(link, replacements, isRecovery) {
  const re = /hysteria:\/\/(((?:\[[\da-fA-F:]+\])|(?:[\da-fA-F:]+)|(?:[\d.]+)|(?:[\w\.-]+))):/;
  const match = link.match(re);
  if (!match) return link;
  const rawHost = match[1];
  const server = normalizeServer(rawHost);

  if (isRecovery) {
    const original = replacements[server];
    return original ? link.replace(rawHost, original) : link;
  } else {
    const randomDomain = generateRandomStr(12) + ".com";
    replacements[randomDomain] = server;
    return link.replace(rawHost, randomDomain);
  }
}

function replaceHysteria2(link, replacements, isRecovery) {
  const re = /(hysteria2):\/\/(.*)@(((?:\[[\da-fA-F:]+\])|(?:[\da-fA-F:]+)|(?:[\d.]+)|(?:[\w\.-]+))):/;
  const match = link.match(re);
  if (!match) return link;
  const uuid = match[2];
  const rawHost = match[3];
  const server = normalizeServer(rawHost);

  if (isRecovery) {
    const original = replacements[server];
    return original ? link.replace(rawHost, original) : link;
  } else {
    const randomDomain = generateRandomStr(10) + ".com";
    const randomUUID = generateRandomUUID();
    replacements[randomDomain] = server;
    replacements[randomUUID] = uuid;
    return link.replace(uuid, randomUUID).replace(rawHost, randomDomain);
  }
}

function replaceYAMLContent(content, replacements) {
  let result = content;
  const serverRegex = /server:\s*(((?:\[[\da-fA-F:]+\])|(?:[\da-fA-F:]+)|(?:[\d.]+)|(?:[\w\.-]+)))/gu;
  result = result.replace(serverRegex, (match, p1) => {
    const serverRaw = p1;
    const normalized = normalizeServer(serverRaw);
    if (normalized && (normalized.includes(".") || normalized.includes(":"))) {
       const randomDomain = generateRandomStr(12) + ".com";
       replacements[randomDomain] = normalized;
       return `server: ${randomDomain}`;
    }
    return match;
  });
  const uuidRegex = /uuid:\s*(\S+)/g;
  result = result.replace(uuidRegex, (match, uuid) => {
    const randomUUID = generateRandomUUID();
    replacements[randomUUID] = uuid;
    return `uuid: ${randomUUID}`;
  });
  const passRegex = /password:\s*(\S+)/g;
  result = result.replace(passRegex, (match, pass) => {
    const randomPass = generateRandomStr(12);
    replacements[randomPass] = pass;
    return `password: ${randomPass}`;
  });
  return result;
}

// --- Module-scope KV helpers that use moduleLocalCache as short-term cache ---
async function cachePut(env, key, value, headers) {
  if (isKVBinding(env.SUB_CACHE)) {
    try {
      await env.SUB_CACHE.put(key, value);
      if (headers) await env.SUB_CACHE.put(key + "_headers", JSON.stringify(headers));
    } catch (e) {
      console.error("KV put error", e);
      moduleLocalCache.set(key, value);
      if (headers) moduleLocalCache.set(key + "_headers", JSON.stringify(headers));
    }
  } else {
    moduleLocalCache.set(key, value);
    if (headers) moduleLocalCache.set(key + "_headers", JSON.stringify(headers));
  }
}

async function cacheGet(env, key) {
  if (moduleLocalCache.has(key)) return moduleLocalCache.get(key);
  if (isKVBinding(env.SUB_CACHE)) {
    try {
      const v = await env.SUB_CACHE.get(key);
      if (v !== null) {
        moduleLocalCache.set(key, v);
        return v;
      }
    } catch (e) {
      console.error("KV get error", e);
      return null;
    }
  }
  return null;
}

async function cacheDelete(env, key) {
  if (isKVBinding(env.SUB_CACHE)) {
    try {
      await env.SUB_CACHE.delete(key);
    } catch (e) {
      console.error("KV delete error", e);
    }
    try {
      await env.SUB_CACHE.delete(key + "_headers");
    } catch (e) {}
  }
  moduleLocalCache.delete(key);
  moduleLocalCache.delete(key + "_headers");
}

// --- Request handlers ---
async function handleSubRequest(request, url, backend, env) {
  const targetUrl = (function getFullUrl(requestUrl) {
    const u = new URL(requestUrl);
    const search = u.search;
    if (!search) return u.searchParams.get('url');
    const reserved = [
      'target=', 'config=', 'emoji=', 'list=', 'udp=', 'tfo=', 'scv=', 'fdn=',
      'sort=', 'dev=', 'bd=', 'insert=', 'exclude=', 'append_info=', 'expand=',
      'new_name=', 'rename=', 'filename=', 'path=', 'prefix=', 'suffix=', 'ver=',
      'xudp=', 'doh=', 'rule=', 'script=', 'node=', 'group=', 'filter='
    ];
    let searchStr = search.substring(1);
    let urlStart = -1;
    const urlKeys = ['url=', 'sub='];
    for (const k of urlKeys) {
      let idx = searchStr.indexOf(k);
      if (idx !== -1 && (idx === 0 || searchStr[idx - 1] === '&')) {
        urlStart = idx + k.length;
        break;
      }
    }
    if (urlStart === -1) return u.searchParams.get('url');
    let remaining = searchStr.substring(urlStart);
    let bestCut = remaining.length;
    for (const r of reserved) {
      let rIdx = remaining.indexOf('&' + r);
      if (rIdx !== -1 && rIdx < bestCut) bestCut = rIdx;
    }
    let finalUrl = remaining.substring(0, bestCut);
    const stdUrl = u.searchParams.get('url');
    if (stdUrl && stdUrl.includes('://') && stdUrl.length > finalUrl.length) return stdUrl;
    try { return decodeURIComponent(finalUrl); } catch (e) { return finalUrl; }
  })(request.url);

  if (!targetUrl) {
    const backendBase = backend.replace(/(https?:\/\/[^/]+).*$/, "$1");
    const backendUrl = `${backendBase}/sub${url.search}`;
    try {
      const response = await fetch(backendUrl, {
        method: "GET",
        headers: { "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0" }
      });
      const text = await response.text();
      return new Response(text, {
        status: response.status,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" }
      });
    } catch (e) {
      return new Response("Error: " + e.message, { status: 500 });
    }
  }

  const host = url.origin;
  const subInternalDir = "sub/internal";
  const replacements = {};
  const replacedURIs = [];
  const keys = [];

  const urlParts = targetUrl.split("|").filter((p) => p.trim() !== "");

  for (const part of urlParts) {
    const key = generateRandomStr(16);
    let plaintextData = "";
    let responseHeaders = {};

    if (part.startsWith("http://") || part.startsWith("https://")) {
      try {
        const resp = await fetch(part, {
          headers: { "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0" }
        });
        if (resp.ok) {
          plaintextData = await resp.text();
          responseHeaders = Object.fromEntries(resp.headers);
        } else {
          console.error("remote fetch not ok", part, resp.status);
          continue;
        }
      } catch (e) {
        console.error("Fetch failed:", part, e && e.message ? e.message : e);
        continue;
      }
    } else {
      plaintextData = part;
    }

    if (plaintextData) {
      const parsed = parseData(plaintextData);
      let obfuscatedData = plaintextData;

      if (parsed.format === "base64") {
        const links = parsed.data.split(/\r?\n/).filter(l => l.trim());
        const newLinks = [];
        for (const link of links) {
          const nl = replaceInUri(link, replacements, false);
          newLinks.push(nl || link);
        }
        obfuscatedData = utf8ToBase64(newLinks.join("\r\n"));
      } else if (parsed.format === "yaml") {
        obfuscatedData = replaceYAMLContent(plaintextData, replacements);
      }

      await cachePut(env, key, obfuscatedData, responseHeaders);
      keys.push(key);
      replacedURIs.push(`${host}/${subInternalDir}/${key}`);
    }
  }

  if (replacedURIs.length === 0) {
    return new Response("No valid nodes found", { status: 400 });
  }

  const newUrl = replacedURIs.join("|");
  const incomingParams = new URL(request.url).searchParams;
  const originalParams = new URLSearchParams();
  const whitelist = [
    'target', 'config', 'emoji', 'list', 'udp', 'tfo', 'scv', 'fdn',
    'sort', 'dev', 'bd', 'insert', 'exclude', 'append_info', 'expand',
    'new_name', 'rename', 'filename', 'path', 'prefix', 'suffix', 'ver',
    'xudp', 'doh', 'rule', 'script', 'node', 'group', 'filter'
  ];
  for (const [k, v] of incomingParams.entries()) {
    if (whitelist.includes(k)) originalParams.set(k, v);
  }
  originalParams.set("url", newUrl);

  const backendBase = backend.replace(/(https?:\/\/[^/]+).*$/, "$1");
  const backendUrl = `${backendBase}/sub?${originalParams.toString()}`;

  const KEEP_KV_FOR_DEBUG = (env.KEEP_KV_FOR_DEBUG === "true" || env.KEEP_KV_FOR_DEBUG === true);

  try {
    const response = await fetch(backendUrl, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      }
    });

    let content = await response.text();

    if (Object.keys(replacements).length > 0) {
      const recoveryRegex = new RegExp(Object.keys(replacements).map(escapeRegExp).join("|"), "g");
      const target = url.searchParams.get("target");
      try {
        const decoded = urlSafeBase64Decode(content);
        if (decoded && (decoded.includes("://") || decoded.includes("proxies:") || decoded.includes("port:"))) {
          const recovered = decoded.replace(recoveryRegex, (m) => replacements[m] || m);
          content = (target === "base64") ? utf8ToBase64(recovered) : recovered;
        } else {
          content = content.replace(recoveryRegex, (m) => replacements[m] || m);
        }
      } catch (e) {
        content = content.replace(recoveryRegex, (m) => replacements[m] || m);
      }
    }

    const responseHeaders = new Headers();
    responseHeaders.set("Content-Type", "text/plain; charset=utf-8");
    responseHeaders.set("Access-Control-Allow-Origin", "*");

    return new Response(content, {
      status: response.status,
      headers: responseHeaders
    });
  } catch (e) {
    return new Response("Error: " + e.message, { status: 500 });
  } finally {
    if (!KEEP_KV_FOR_DEBUG) {
      for (const k of keys) {
        try {
          await cacheDelete(env, k);
        } catch (err) {
          console.error("cleanup error for key", k, err);
        }
      }
    } else {
      for (const k of keys) {
        moduleLocalCache.delete(k);
        moduleLocalCache.delete(k + "_headers");
      }
    }
  }
}

async function handleVersionRequest(backend) {
  try {
    const response = await fetch(`${backend}/version`, { signal: AbortSignal.timeout(5000) });
    const text = await response.text();
    return new Response(text, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Backend unavailable", message: e.message }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
}

// --- Pages Functions entry point ---
export async function onRequest(context) {
  const request = context.request;
  const env = context.env;
  const url = new URL(request.url);

  const BACKEND = env.BACKEND_API_URL || DEFAULT_BACKEND;

  if (url.pathname.includes("/sub/internal/") || url.pathname.includes("/internal/")) {
    const pathSegments = url.pathname.split("/").filter(s => s);
    const key = pathSegments[pathSegments.length - 1];

    let content = moduleLocalCache.get(key);
    let headersJson = moduleLocalCache.get(key + "_headers");

    if (!content && isKVBinding(env.SUB_CACHE)) {
      try {
        content = await env.SUB_CACHE.get(key);
        headersJson = await env.SUB_CACHE.get(key + "_headers");
      } catch (e) {
        console.error("KV read error in internal endpoint", e);
      }
    }

    if (!content) return new Response("Not Found", { status: 404 });

    const headers = new Headers(headersJson ? JSON.parse(headersJson) : { "Content-Type": "text/plain; charset=utf-8" });
    headers.set("Access-Control-Allow-Origin", "*");
    return new Response(content, { headers });
  }

  if (url.pathname === "/sub" || url.pathname.startsWith("/sub")) {
    return await handleSubRequest(request, url, BACKEND, env);
  }

  if (url.pathname === "/version") {
    return await handleVersionRequest(BACKEND);
  }

  return await context.next();
}
