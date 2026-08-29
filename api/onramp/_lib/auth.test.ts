import { createPrivateKey, createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { requirePrivySession } from "./auth";

function encodeBase64Url(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function createJwt(
  payload: Record<string, unknown>,
  privateKeyPem: string,
  header: Record<string, unknown> = { alg: "ES256", typ: "JWT", kid: "kid-1" },
) {
  const encodedHeader = encodeBase64Url(JSON.stringify(header));
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signer = createSign("SHA256");
  signer.update(`${encodedHeader}.${encodedPayload}`);
  signer.end();
  const signature = signer.sign({
    key: createPrivateKey(privateKeyPem),
    dsaEncoding: "ieee-p1363",
  });

  return `${encodedHeader}.${encodedPayload}.${encodeBase64Url(signature)}`;
}

describe("requirePrivySession", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.PRIVY_JWKS_URL;
    delete process.env.PRIVY_VERIFICATION_KEY;
  });

  it("verifies a valid Privy bearer token against JWKS", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const publicJwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
    process.env.PRIVY_JWKS_URL = "https://privy.example/jwks.json";

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          keys: [{ ...publicJwk, use: "sig", alg: "ES256", kid: "kid-1" }],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    const accessToken = createJwt(
      {
        sub: "did:privy:user:123",
        iss: "https://auth.privy.io",
        aud: "privy-app-id",
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    );

    await expect(
      requirePrivySession(
        { headers: { authorization: `Bearer ${accessToken}` } },
        "privy-app-id",
      ),
    ).resolves.toMatchObject({
      accessToken,
      privyUserId: "did:privy:user:123",
    });
  });

  it("rejects tokens with an invalid signature", async () => {
    const validPair = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const attackerPair = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const publicJwk = validPair.publicKey.export({ format: "jwk" }) as JsonWebKey;
    process.env.PRIVY_JWKS_URL = "https://privy.example/jwks.json";

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          keys: [{ ...publicJwk, use: "sig", alg: "ES256", kid: "kid-1" }],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    const accessToken = createJwt(
      {
        sub: "did:privy:user:123",
        iss: "privy.io",
        aud: "privy-app-id",
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      attackerPair.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    );

    await expect(
      requirePrivySession(
        { headers: { authorization: `Bearer ${accessToken}` } },
        "privy-app-id",
      ),
    ).rejects.toThrowError(
      expect.objectContaining({
        statusCode: 401,
        code: "UNAUTHORIZED",
      }),
    );
  });

  it("rejects expired tokens even when the signature is valid", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const publicJwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
    process.env.PRIVY_JWKS_URL = "https://privy.example/jwks.json";

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          keys: [{ ...publicJwk, use: "sig", alg: "ES256", kid: "kid-1" }],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    const accessToken = createJwt(
      {
        sub: "did:privy:user:123",
        iss: "https://auth.privy.io",
        aud: "privy-app-id",
        exp: Math.floor(Date.now() / 1000) - 60,
      },
      privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    );

    await expect(
      requirePrivySession(
        { headers: { authorization: `Bearer ${accessToken}` } },
        "privy-app-id",
      ),
    ).rejects.toThrowError(
      expect.objectContaining({
        statusCode: 401,
        code: "UNAUTHORIZED",
      }),
    );
  });

  /**
   * An unknown kid triggers one forced JWKS refetch — a genuine rotation needs
   * exactly one. Unthrottled, every attacker-minted kid bought an outbound
   * request to Privy: an unauthenticated lever on our JWKS access.
   */
  it("throttles the forced refresh an unknown kid triggers", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const publicJwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
    process.env.PRIVY_JWKS_URL = "https://privy.example/jwks-throttle.json";

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        new Response(
          JSON.stringify({
            keys: [{ ...publicJwk, use: "sig", alg: "ES256", kid: "kid-1" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const rogueToken = () =>
      createJwt(
        {
          sub: "did:privy:user:123",
          iss: "https://auth.privy.io",
          aud: "privy-app-id",
          exp: Math.floor(Date.now() / 1000) + 60,
        },
        privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
        { alg: "ES256", typ: "JWT", kid: "kid-unknown" },
      );

    await expect(
      requirePrivySession(
        { headers: { authorization: `Bearer ${rogueToken()}` } },
        "privy-app-id",
      ),
    ).rejects.toThrowError(expect.objectContaining({ statusCode: 401 }));
    // Initial cache load plus the one forced refresh.
    const outboundAfterFirst = fetchSpy.mock.calls.length;

    await expect(
      requirePrivySession(
        { headers: { authorization: `Bearer ${rogueToken()}` } },
        "privy-app-id",
      ),
    ).rejects.toThrowError(expect.objectContaining({ statusCode: 401 }));

    // The second unknown kid inside the cooldown buys no outbound request.
    expect(fetchSpy.mock.calls.length).toBe(outboundAfterFirst);
  });

  it("rejects tokens for a different app audience", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const publicJwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
    process.env.PRIVY_JWKS_URL = "https://privy.example/jwks.json";

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          keys: [{ ...publicJwk, use: "sig", alg: "ES256", kid: "kid-1" }],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    const accessToken = createJwt(
      {
        sub: "did:privy:user:123",
        iss: "privy.io",
        aud: "some-other-app",
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    );

    await expect(
      requirePrivySession(
        { headers: { authorization: `Bearer ${accessToken}` } },
        "privy-app-id",
      ),
    ).rejects.toThrowError(
      expect.objectContaining({
        statusCode: 401,
        code: "UNAUTHORIZED",
      }),
    );
  });
});
