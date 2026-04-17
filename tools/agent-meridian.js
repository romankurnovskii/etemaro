import { config } from "../config.js";

export function getAgentMeridianBase() {
  return String(config.api.url || "https://api.agentmeridian.xyz/api").replace(/\/+$/, "");
}

export function getAgentMeridianHeaders({ json = false } = {}) {
  const headers = {};
  if (json) headers["Content-Type"] = "application/json";
  if (config.api.publicApiKey) headers["x-api-key"] = config.api.publicApiKey;
  return headers;
}

export function getAgentIdForRequests() {
  return config.hiveMind.agentId || "agent-local";
}

export async function agentMeridianJson(pathname, options = {}) {
  const res = await fetch(`${getAgentMeridianBase()}${pathname}`, options);
  const text = await res.text().catch(() => "");
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!res.ok) {
    throw new Error(payload?.error || `${pathname} ${res.status}`);
  }
  return payload;
}
