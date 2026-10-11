/** Install links and client configs for connecting an MCP client to A-eye's hosted /mcp endpoint. */
export const MCP_SERVER_NAME = "a-eye";
export const NPM_PACKAGE = "a-eye-mcp";
export const MCPB_DOWNLOAD_PATH = "/downloads/a-eye.mcpb";
export const REPO_URL = "https://github.com/PeytonLi/A-eye";
export const NPX_COMMAND = `npx -y ${NPM_PACKAGE}`;

export function mcpUrl(origin: string) {
  return `${origin.replace(/\/$/, "")}/mcp`;
}

/** https://cursor.com/docs/mcp/install-links: config is base64(JSON) of one server entry. */
export function cursorInstallLink(origin: string) {
  const config = Buffer.from(JSON.stringify({ url: mcpUrl(origin) })).toString("base64");
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${MCP_SERVER_NAME}&config=${encodeURIComponent(config)}`;
}

/** https://code.visualstudio.com/api/extension-guides/ai/mcp: vscode:mcp/install?{url-encoded JSON}. */
export function vscodeInstallLink(origin: string) {
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: MCP_SERVER_NAME, type: "http", url: mcpUrl(origin) }))}`;
}

export function claudeCodeCommand(origin: string) {
  return `claude mcp add --transport http ${MCP_SERVER_NAME} ${mcpUrl(origin)}`;
}

export function claudeCodeLocalCommand() {
  return `claude mcp add ${MCP_SERVER_NAME} -- ${NPX_COMMAND}`;
}

/** Local stdio entry for the npm package; the same JSON works in claude_desktop_config.json and Cursor's mcp.json. */
export function npxConfig() {
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { command: "npx", args: ["-y", NPM_PACKAGE] } } }, null, 2);
}

/** Windsurf's mcp_config.json uses serverUrl for Streamable HTTP servers. */
export function windsurfConfig(origin: string) {
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { serverUrl: mcpUrl(origin) } } }, null, 2);
}
