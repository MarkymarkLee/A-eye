import { describe, expect, it } from "vitest";
import { claudeCodeCommand, claudeCodeLocalCommand, cursorInstallLink, npxConfig, NPX_COMMAND, vscodeInstallLink, windsurfConfig } from "./connect-links";

const ORIGIN = "https://a-eye-1zsv.onrender.com";

describe("connect links", () => {
  it("encodes a Cursor install link whose config decodes to the hosted server", () => {
    const url = new URL(cursorInstallLink(ORIGIN));
    expect(url.protocol).toBe("cursor:");
    expect(url.host + url.pathname).toBe("anysphere.cursor-deeplink/mcp/install");
    expect(url.searchParams.get("name")).toBe("a-eye");
    const config = JSON.parse(Buffer.from(url.searchParams.get("config")!, "base64").toString("utf8"));
    expect(config).toEqual({ url: `${ORIGIN}/mcp` });
  });

  it("encodes a VS Code install link as url-encoded JSON", () => {
    const link = vscodeInstallLink(ORIGIN);
    expect(link.startsWith("vscode:mcp/install?")).toBe(true);
    const config = JSON.parse(decodeURIComponent(link.slice("vscode:mcp/install?".length)));
    expect(config).toEqual({ name: "a-eye", type: "http", url: `${ORIGIN}/mcp` });
  });

  it("builds the Claude Code command and JSON configs", () => {
    expect(claudeCodeCommand(`${ORIGIN}/`)).toBe(`claude mcp add --transport http a-eye ${ORIGIN}/mcp`);
    expect(JSON.parse(npxConfig())).toEqual({ mcpServers: { "a-eye": { command: "npx", args: ["-y", "a-eye-mcp"] } } });
    expect(NPX_COMMAND).toBe("npx -y a-eye-mcp");
    expect(claudeCodeLocalCommand()).toBe("claude mcp add a-eye -- npx -y a-eye-mcp");
    expect(JSON.parse(windsurfConfig(ORIGIN))).toEqual({ mcpServers: { "a-eye": { serverUrl: `${ORIGIN}/mcp` } } });
  });
});
