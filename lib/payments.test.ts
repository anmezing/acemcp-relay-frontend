import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeWechatPaymentOrder,
  createWechatNativeOrder,
  PaymentOrderRejectedError,
  paymentAvailability,
  verifyAlipayNotification,
  verifyWechatNotification,
  yuanToFen,
} from "./payments";

const PAYMENT_ENV = [
  "PAYMENT_NOTIFY_BASE_URL",
  "BETTER_AUTH_URL",
  "ALIPAY_APP_ID",
  "ALIPAY_PRIVATE_KEY",
  "ALIPAY_PUBLIC_KEY",
  "ALIPAY_KEY_TYPE",
  "ALIPAY_SELLER_ID",
  "ALIPAY_ENDPOINT",
  "WECHAT_PAY_MCH_ID",
  "WECHAT_PAY_APP_ID",
  "WECHAT_PAY_SERIAL_NO",
  "WECHAT_PAY_PRIVATE_KEY",
  "WECHAT_PAY_API_V3_KEY",
  "WECHAT_PAY_PUBLIC_KEY_ID",
  "WECHAT_PAY_PUBLIC_KEY",
  "WECHAT_PAY_API_BASE_URL",
] as const;

function clearPaymentEnv() {
  for (const name of PAYMENT_ENV) vi.stubEnv(name, "");
}

function rsaPair() {
  return crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

function signAlipayNotification(
  data: Record<string, string>,
  platformPrivateKey: string
): Record<string, string> {
  const signContent = Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join("&");
  return {
    ...data,
    sign: crypto
      .sign("RSA-SHA256", Buffer.from(signContent), platformPrivateKey)
      .toString("base64"),
  };
}

function encryptWechatResource(
  value: Record<string, unknown>,
  apiV3Key: string,
  nonce: string,
  associatedData: string
): string {
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    Buffer.from(apiV3Key),
    Buffer.from(nonce)
  );
  cipher.setAAD(Buffer.from(associatedData));
  return Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
}

function configureAlipay() {
  const merchant = rsaPair();
  const platform = rsaPair();
  vi.stubEnv("ALIPAY_APP_ID", "2026000000000001");
  vi.stubEnv("ALIPAY_PRIVATE_KEY", merchant.privateKey);
  vi.stubEnv("ALIPAY_PUBLIC_KEY", platform.publicKey);
  vi.stubEnv("ALIPAY_KEY_TYPE", "PKCS8");
  vi.stubEnv("ALIPAY_SELLER_ID", "2088000000000001");
  vi.stubEnv("PAYMENT_NOTIFY_BASE_URL", "https://billing.example.com");
  return platform;
}

function configureWechat() {
  const merchant = rsaPair();
  const platform = rsaPair();
  const apiV3Key = "0123456789abcdef0123456789abcdef";
  vi.stubEnv("WECHAT_PAY_MCH_ID", "1900000001");
  vi.stubEnv("WECHAT_PAY_APP_ID", "wx0000000000000001");
  vi.stubEnv("WECHAT_PAY_SERIAL_NO", "MERCHANT_SERIAL");
  vi.stubEnv("WECHAT_PAY_PRIVATE_KEY", merchant.privateKey);
  vi.stubEnv("WECHAT_PAY_API_V3_KEY", apiV3Key);
  vi.stubEnv("WECHAT_PAY_PUBLIC_KEY_ID", "PUB_KEY_ID_0001");
  vi.stubEnv("WECHAT_PAY_PUBLIC_KEY", platform.publicKey);
  vi.stubEnv("PAYMENT_NOTIFY_BASE_URL", "https://billing.example.com");
  return { platform, apiV3Key };
}

describe("payment amount parsing", () => {
  it.each([
    ["0", 0],
    ["1", 100],
    ["12.3", 1230],
    ["12.34", 1234],
    [" 8.05 ", 805],
  ])("converts %s yuan to integer fen", (yuan, fen) => {
    expect(yuanToFen(yuan)).toBe(fen);
  });

  it.each(["-1", "1.234", "1e2", "NaN", ""])(
    "rejects invalid amount %s",
    (value) => {
      expect(() => yuanToFen(value)).toThrow("INVALID_PAYMENT_AMOUNT");
    }
  );

  it("rejects values whose fen amount cannot be represented exactly", () => {
    expect(() => yuanToFen("90071992547410.00")).toThrow(
      "INVALID_PAYMENT_AMOUNT"
    );
  });
});

describe("payment provider configuration", () => {
  beforeEach(clearPaymentEnv);
  afterEach(() => vi.unstubAllEnvs());

  it("does not advertise missing or malformed merchant credentials", () => {
    expect(paymentAvailability()).toEqual({ alipay: false, wechat: false });

    vi.stubEnv("ALIPAY_APP_ID", "app");
    vi.stubEnv("ALIPAY_PRIVATE_KEY", "not-a-private-key");
    vi.stubEnv("ALIPAY_PUBLIC_KEY", "not-a-public-key");
    expect(paymentAvailability().alipay).toBe(false);
  });

  it("advertises providers only after all cryptographic material is valid", () => {
    configureAlipay();
    configureWechat();
    expect(paymentAvailability()).toEqual({ alipay: true, wechat: true });
  });

  it("does not advertise providers with an insecure public callback origin", () => {
    configureAlipay();
    configureWechat();
    vi.stubEnv("PAYMENT_NOTIFY_BASE_URL", "http://billing.example.com");
    expect(paymentAvailability()).toEqual({ alipay: false, wechat: false });
  });
});

describe("Alipay notification verification", () => {
  beforeEach(clearPaymentEnv);
  afterEach(() => vi.unstubAllEnvs());

  it("verifies RSA2 signature and extracts the paid order", () => {
    const platform = configureAlipay();
    const data = signAlipayNotification(
      {
        app_id: "2026000000000001",
        seller_id: "2088000000000001",
        trade_status: "TRADE_SUCCESS",
        out_trade_no: "LCE20260813ABCDEF",
        trade_no: "2026081322000000000001",
        total_amount: "12.34",
        gmt_payment: "2026-08-13 14:30:00",
        sign_type: "RSA2",
      },
      platform.privateKey
    );

    expect(verifyAlipayNotification(data)).toEqual({
      provider: "alipay",
      orderNo: "LCE20260813ABCDEF",
      amountFen: 1234,
      currency: "CNY",
      providerTradeNo: "2026081322000000000001",
      paidAt: new Date("2026-08-13T14:30:00+08:00"),
    });
  });

  it("rejects a notification changed after signing", () => {
    const platform = configureAlipay();
    const signed = signAlipayNotification(
      {
        app_id: "2026000000000001",
        seller_id: "2088000000000001",
        trade_status: "TRADE_SUCCESS",
        out_trade_no: "LCE20260813ABCDEF",
        trade_no: "2026081322000000000001",
        total_amount: "12.34",
        gmt_payment: "2026-08-13 14:30:00",
        sign_type: "RSA2",
      },
      platform.privateKey
    );

    expect(() =>
      verifyAlipayNotification({ ...signed, total_amount: "0.01" })
    ).toThrow("ALIPAY_SIGNATURE_INVALID");
  });

  it("requires an authenticated payment timestamp", () => {
    const platform = configureAlipay();
    const signed = signAlipayNotification(
      {
        app_id: "2026000000000001",
        seller_id: "2088000000000001",
        trade_status: "TRADE_SUCCESS",
        out_trade_no: "LCE20260813ABCDEF",
        trade_no: "2026081322000000000001",
        total_amount: "12.34",
        sign_type: "RSA2",
      },
      platform.privateKey
    );

    expect(() => verifyAlipayNotification(signed)).toThrow(
      "ALIPAY_PAYMENT_TIME_MISSING"
    );
  });
});

describe("WeChat Pay notification verification", () => {
  beforeEach(clearPaymentEnv);
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function createNotification(overrides: Record<string, unknown> = {}) {
    const { platform, apiV3Key } = configureWechat();
    const resourceNonce = "0123456789ab";
    const associatedData = "transaction";
    const payment = {
      trade_state: "SUCCESS",
      mchid: "1900000001",
      appid: "wx0000000000000001",
      out_trade_no: "LCE20260813ABCDEF",
      transaction_id: "4200000000202608130001",
      success_time: "2026-08-13T14:30:00+08:00",
      amount: { total: 1234, currency: "CNY" },
      ...overrides,
    };
    const body = JSON.stringify({
      event_type: "TRANSACTION.SUCCESS",
      resource: {
        algorithm: "AEAD_AES_256_GCM",
        ciphertext: encryptWechatResource(
          payment,
          apiV3Key,
          resourceNonce,
          associatedData
        ),
        nonce: resourceNonce,
        associated_data: associatedData,
      },
    });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const headerNonce = "notification-nonce";
    const signature = crypto
      .sign(
        "RSA-SHA256",
        Buffer.from(`${timestamp}\n${headerNonce}\n${body}\n`),
        platform.privateKey
      )
      .toString("base64");
    const headers = new Headers({
      "wechatpay-timestamp": timestamp,
      "wechatpay-nonce": headerNonce,
      "wechatpay-signature": signature,
      "wechatpay-serial": "PUB_KEY_ID_0001",
    });
    return { body, headers };
  }

  it("verifies the platform signature and AES-GCM resource", () => {
    const { body, headers } = createNotification();
    expect(verifyWechatNotification(body, headers)).toEqual({
      provider: "wechat",
      orderNo: "LCE20260813ABCDEF",
      amountFen: 1234,
      currency: "CNY",
      providerTradeNo: "4200000000202608130001",
      paidAt: new Date("2026-08-13T14:30:00+08:00"),
    });
  });

  it("rejects a body changed after platform signing", () => {
    const { body, headers } = createNotification();
    expect(() => verifyWechatNotification(`${body} `, headers)).toThrow(
      "WECHAT_SIGNATURE_INVALID"
    );
  });

  it("rejects non-integer amounts after authenticated decryption", () => {
    const { body, headers } = createNotification({
      amount: { total: "1234", currency: "CNY" },
    });
    expect(() => verifyWechatNotification(body, headers)).toThrow(
      "WECHAT_PAYMENT_DATA_INVALID"
    );
  });
});

describe("WeChat Pay Native order response verification", () => {
  beforeEach(clearPaymentEnv);
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function signedResponse(
    body: string,
    platformPrivateKey: string,
    mutateSignature = false,
    status = 200
  ) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = "response-nonce";
    const signature = crypto
      .sign(
        "RSA-SHA256",
        Buffer.from(`${timestamp}\n${nonce}\n${body}\n`),
        platformPrivateKey
      )
      .toString("base64");
    return new Response(body, {
      status,
      headers: {
        "Content-Type": "application/json",
        "wechatpay-timestamp": timestamp,
        "wechatpay-nonce": nonce,
        "wechatpay-signature": mutateSignature
          ? `${signature.slice(0, -4)}AAAA`
          : signature,
        "wechatpay-serial": "PUB_KEY_ID_0001",
      },
    });
  }

  const order = {
    id: "order-id",
    orderNo: "LCE20260813ABCDEF",
    userId: "user-1",
    planId: "plan-1",
    provider: "wechat" as const,
    status: "pending" as const,
    fulfillmentStatus: "pending" as const,
    fulfillmentError: null,
    fulfillmentEffectiveAt: null,
    amountFen: 1234,
    currency: "CNY",
    planSnapshot: {
      planId: "plan-1",
      code: "pro-monthly",
      name: "Pro 月付",
      tier: "pro" as const,
      durationDays: 30,
      dailyRequestLimit: 1000,
      dailyIndexBytesLimit: 1024,
      subaccountLimit: 3,
    },
    providerTradeNo: null,
    codeUrl: null,
    expiresAt: new Date("2026-08-13T07:00:00Z"),
    paidAt: null,
    createdAt: new Date("2026-08-13T06:45:00Z"),
    updatedAt: new Date("2026-08-13T06:45:00Z"),
  };

  it("accepts a signed response and returns its code_url", async () => {
    const { platform } = configureWechat();
    const body = JSON.stringify({ code_url: "weixin://wxpay/example" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => signedResponse(body, platform.privateKey))
    );

    await expect(createWechatNativeOrder(order)).resolves.toBe(
      "weixin://wxpay/example"
    );
  });

  it("rejects an unsigned or tampered platform response", async () => {
    const { platform } = configureWechat();
    const body = JSON.stringify({ code_url: "weixin://wxpay/example" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => signedResponse(body, platform.privateKey, true))
    );

    await expect(createWechatNativeOrder(order)).rejects.toThrow(
      "WECHAT_SIGNATURE_INVALID"
    );
  });

  it("rejects a response without WeChat Pay signature headers", async () => {
    configureWechat();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ code_url: "weixin://wxpay/example" }),
            { status: 200 }
          )
      )
    );

    await expect(createWechatNativeOrder(order)).rejects.toThrow(
      "WECHAT_SIGNATURE_HEADERS_MISSING"
    );
  });

  it("classifies a signed business rejection separately from an ambiguous transport failure", async () => {
    const { platform } = configureWechat();
    const body = JSON.stringify({ code: "PARAM_ERROR" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => signedResponse(body, platform.privateKey, false, 400))
    );

    const promise = createWechatNativeOrder(order);
    await expect(promise).rejects.toBeInstanceOf(PaymentOrderRejectedError);
    await expect(createWechatNativeOrder(order)).rejects.toThrow(
      "WECHAT_CREATE_FAILED:PARAM_ERROR"
    );
  });

  it("sends an authenticated close request and accepts WeChat's 204 response", async () => {
    configureWechat();
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(closeWechatPaymentOrder(order.orderNo)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(
      `/v3/pay/transactions/out-trade-no/${order.orderNo}/close`
    );
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toMatch(/^WECHATPAY2-SHA256-RSA2048 /);
  });
});
