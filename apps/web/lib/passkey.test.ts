import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";

const mocks = vi.hoisted(() => {
  let challengeIndex = 0;
  return {
    nextChallenge: () => `challenge-${++challengeIndex}`,
    verifyRegistrationResponse: vi.fn(),
    verifyAuthenticationResponse: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: vi.fn(async () => ({ challenge: mocks.nextChallenge() })),
  generateAuthenticationOptions: vi.fn(async () => ({ challenge: mocks.nextChallenge() })),
  verifyRegistrationResponse: mocks.verifyRegistrationResponse,
  verifyAuthenticationResponse: mocks.verifyAuthenticationResponse,
}));

vi.stubEnv("A_EYE_DB_PATH", ":memory:");
afterAll(() => vi.unstubAllEnvs());

const store = await import("./store");
const passkey = await import("./passkey");
const req = new Request("https://a-eye.test");

const registrationResponse = (id: string, challenge: string) =>
  ({ id, challenge, response: { transports: ["internal"] } } as unknown as RegistrationResponseJSON);
const authenticationResponse = (id: string, challenge: string) =>
  ({ id, challenge } as unknown as AuthenticationResponseJSON);

const questionInput = (question: string) => ({
  lat: 37.8716,
  lng: -122.2536,
  radius_m: 150,
  question,
  options: ["Yes", "No"],
  allow_free_text: false,
  prize_usd: 1,
  min_responses: 1,
  max_responses: 2,
  closes_in_minutes: 10,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  mocks.verifyRegistrationResponse.mockImplementation(
    async ({ response, expectedChallenge }: { response: { id: string; challenge: string }; expectedChallenge: (value: string) => boolean | Promise<boolean> }) => {
      const verified = await expectedChallenge(response.challenge);
      return verified
        ? {
            verified: true,
            registrationInfo: {
              credential: { id: response.id, publicKey: Uint8Array.from([1, 2, 3]), counter: 0, transports: ["internal"] },
            },
          }
        : { verified: false };
    },
  );
  mocks.verifyAuthenticationResponse.mockImplementation(
    async ({ response, expectedChallenge }: { response: { challenge: string }; expectedChallenge: (value: string) => boolean | Promise<boolean> }) => {
      const verified = await expectedChallenge(response.challenge);
      return verified ? { verified: true, authenticationInfo: { newCounter: 8 } } : { verified: false };
    },
  );
});

describe("passkey ceremonies", () => {
  it("registers a passkey for the current observer", async () => {
    const observer = store.getOrCreateObserver(undefined);
    const options = await passkey.registrationOptions(req, observer.id, observer.display_name);
    const created = await passkey.verifyRegistration(req, observer.id, registrationResponse("credential-register", options.challenge));
    expect(created).toMatchObject({ id: "credential-register", observer_id: observer.id, counter: 0 });
    expect(JSON.parse(created.transports!)).toEqual(["internal"]);
  });

  it("consumes a registration challenge only once", async () => {
    const observer = store.getOrCreateObserver(undefined);
    const options = await passkey.registrationOptions(req, observer.id, observer.display_name);
    await passkey.verifyRegistration(req, observer.id, registrationResponse("credential-once", options.challenge));
    await expect(passkey.verifyRegistration(req, observer.id, registrationResponse("credential-again", options.challenge))).rejects.toThrow();
  });

  it("rejects an expired registration challenge", async () => {
    const observer = store.getOrCreateObserver(undefined);
    const options = await passkey.registrationOptions(req, observer.id, observer.display_name);
    vi.advanceTimersByTime(5 * 60_000 + 1);
    await expect(passkey.verifyRegistration(req, observer.id, registrationResponse("credential-expired", options.challenge))).rejects.toThrow();
  });

  it("rejects a registration challenge bound to another observer", async () => {
    const owner = store.getOrCreateObserver(undefined);
    const other = store.getOrCreateObserver(undefined);
    const options = await passkey.registrationOptions(req, owner.id, owner.display_name);
    await expect(passkey.verifyRegistration(req, other.id, registrationResponse("credential-bound", options.challenge))).rejects.toThrow();
  });

  it("rejects a credential id already registered", async () => {
    const first = store.getOrCreateObserver(undefined);
    const second = store.getOrCreateObserver(undefined);
    const firstOptions = await passkey.registrationOptions(req, first.id, first.display_name);
    await passkey.verifyRegistration(req, first.id, registrationResponse("credential-duplicate", firstOptions.challenge));
    const secondOptions = await passkey.registrationOptions(req, second.id, second.display_name);
    await expect(passkey.verifyRegistration(req, second.id, registrationResponse("credential-duplicate", secondOptions.challenge))).rejects.toThrow(
      /already saved/,
    );
  });

  it("logs in the credential owner and updates its counter", async () => {
    const observer = store.getOrCreateObserver(undefined);
    store.savePasskey({ id: "credential-login", observer_id: observer.id, public_key: Buffer.from([7, 8]).toString("base64url"), counter: 3 });
    const options = await passkey.loginOptions(req);
    const loggedIn = await passkey.verifyLogin(req, authenticationResponse("credential-login", options.challenge));
    expect(loggedIn.observer_id).toBe(observer.id);
    expect(store.getPasskey("credential-login")).toMatchObject({ counter: 8, last_used_at: expect.any(String) });
  });

  it("rejects an unknown login credential", async () => {
    await passkey.loginOptions(req);
    await expect(passkey.verifyLogin(req, authenticationResponse("unknown", "anything"))).rejects.toThrow(/not found/);
  });

  it("rejects wallet confirmation from a different observer's credential", async () => {
    const owner = store.getOrCreateObserver(undefined);
    const other = store.getOrCreateObserver(undefined);
    store.savePasskey({ id: "credential-owner", observer_id: owner.id, public_key: "AA", counter: 0 });
    store.savePasskey({ id: "credential-other", observer_id: other.id, public_key: "AA", counter: 0 });
    const options = await passkey.walletConfirmationOptions(req, owner.id);
    await expect(passkey.verifyWalletConfirmation(req, owner.id, authenticationResponse("credential-other", options.challenge))).rejects.toThrow(
      /another account/,
    );
  });
});

describe("guest account linking", () => {
  it("moves non-conflicting answers and push subscriptions but keeps duplicate-question answers", () => {
    const account = store.createObserver();
    const guest = store.createObserver();
    const q1 = store.createQuestion(questionInput("Is the library open?"));
    const q2 = store.createQuestion(questionInput("Is the cafe busy?"));
    const add = (questionId: string, observerId: string, imageSha: number) =>
      store.addSubmission({
        question_id: questionId,
        observer_id: observerId,
        option_index: 0,
        image: { bytes: Uint8Array.from([0xff, 0xd8, imageSha]), type: "image/jpeg" },
        lat: 37.8716,
        lng: -122.2536,
        accuracy_m: 5,
        distance_m: 0,
        captured_at: new Date().toISOString(),
      });
    // Two answers from the guest move, except the question already answered by the account.
    return Promise.all([add(q1, guest.id, 21), add(q2, guest.id, 22), add(q1, account.id, 23)]).then(() => {
      store.savePushSubscription({ observerId: guest.id, endpoint: "https://push.services.mozilla.com/guest", p256dh: "k", auth: "a" });
      expect(store.linkGuestToAccount(guest.id, account.id)).toEqual({ moved: 1, kept: 1 });
      expect(store.observerEntries(account.id).map((entry) => entry.question_id)).toContain(q2);
      expect(store.observerEntries(guest.id).map((entry) => entry.question_id)).toEqual([q1]);
      expect(store.pushSubscriptionsFor(account.id).map((sub) => sub.endpoint)).toContain("https://push.services.mozilla.com/guest");
    });
  });

  it("does not merge a guest that already owns a passkey", () => {
    const account = store.createObserver();
    const guest = store.createObserver();
    store.savePasskey({ id: "guest-account-passkey", observer_id: guest.id, public_key: "AA", counter: 0 });
    store.savePushSubscription({ observerId: guest.id, endpoint: "https://push.services.mozilla.com/passkey-guest", p256dh: "k", auth: "a" });
    expect(store.linkGuestToAccount(guest.id, account.id)).toEqual({ moved: 0, kept: 0 });
    expect(store.pushSubscriptionsFor(guest.id)).toHaveLength(1);
  });

  it("makes a moved winning answer visible in the passkey owner's prizes", async () => {
    const account = store.createObserver();
    const guest = store.createObserver();
    const questionId = store.createQuestion(
      questionInput("Does the cafe have outdoor seats?"),
      "agent",
      { payer: "0x0000000000000000000000000000000000000001", tx: "paid-tx" },
    );
    const submission = await store.addSubmission({
      question_id: questionId,
      observer_id: guest.id,
      option_index: 0,
      image: { bytes: Uint8Array.from([0xff, 0xd8, 31]), type: "image/jpeg" },
      lat: 37.8716,
      lng: -122.2536,
      accuracy_m: 5,
      distance_m: 0,
      captured_at: new Date().toISOString(),
    });
    if (!submission.ok) throw new Error("Test answer should be accepted.");
    store.db()
      .prepare(
        `insert into raffles (question_id, seed_reveal, entropy_block_hash, winner_submission_id)
         values (?, 'seed', 'entropy', ?)`,
      )
      .run(questionId, submission.submission_id);
    store.db().prepare("update questions set status = 'settled', closed_at = ? where id = ?").run(new Date().toISOString(), questionId);
    store.db()
      .prepare(
        `insert into treasury_transfers (question_id, kind, to_address, amount_units, state, updated_at)
         values (?, 'payout', null, '110000', 'pending', ?)`,
      )
      .run(questionId, new Date().toISOString());

    store.linkGuestToAccount(guest.id, account.id);
    expect(store.observerPrizes(account.id)).toMatchObject([{ question_id: questionId, rail: "ausd", status: "needs_wallet" }]);
  });
});
