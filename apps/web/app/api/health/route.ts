import { AUSD, X402_NETWORK } from "@a-eye/shared";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    ok: true,
    service: "a-eye",
    network: X402_NETWORK,
    asset: AUSD.address,
    commit: process.env.RENDER_GIT_COMMIT ?? null,
  });
}
