export function raffleSnippet(input: {
  questionId: string;
  seedReveal: string;
  seedCommit: string;
  blockHash: string;
  submissionIds: string[];
}): string {
  return [
    `// Verify raffle for ${JSON.stringify(input.questionId)}`,
    `const seed = ${JSON.stringify(input.seedReveal)};`,
    `const seedCommit = ${JSON.stringify(input.seedCommit)};`,
    `const blockHash = ${JSON.stringify(input.blockHash)};`,
    `const questionId = ${JSON.stringify(input.questionId)};`,
    `const ids = ${JSON.stringify([...input.submissionIds].sort())}.sort();`,
    `const sha256hex = async (value) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((b) => b.toString(16).padStart(2, "0")).join("");`,
    `(async () => {`,
    `  const digest = await sha256hex(seed + blockHash + questionId);`,
    `  const index = Number(BigInt("0x" + digest) % BigInt(ids.length));`,
    `  const result = { commit_ok: (await sha256hex(seed)) === seedCommit, index, winner: ids[index], entrants: ids.length };`,
    `  console.log(result);`,
    `  return result;`,
    `})()`,
  ].join("\n");
}
