import crypto from "crypto";
import { AlipaySdk } from "alipay-sdk";
import type { BillingOrder, PaymentProvider } from "@/lib/billing";
import { paymentRuntimePolicy } from "@/lib/server-runtime-config";

export interface PaymentAvailability {
  alipay: boolean;
  wechat: boolean;
}

export interface VerifiedPayment {
  provider: PaymentProvider;
  orderNo: string;
  amountFen: number;
  currency: string;
  providerTradeNo: string;
  paidAt: Date;
}

function secretValue(name: string): string {
  return (process.env[name] || "").replaceAll("\\n", "\n").trim();
}

function httpsOrLocalUrl(value: string, errorCode: string): URL {
  const url = new URL(value);
  const localHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (
    (url.protocol !== "https:" && !localHttp) ||
    url.username ||
    url.password
  ) {
    throw new Error(errorCode);
  }
  return url;
}

function notifyBaseUrl(): string {
  const raw = (
    process.env.PAYMENT_NOTIFY_BASE_URL ||
    process.env.BETTER_AUTH_URL ||
    ""
  ).trim();
  if (!raw) throw new Error("PAYMENT_NOTIFY_BASE_URL_MISSING");
  return httpsOrLocalUrl(raw, "PAYMENT_NOTIFY_BASE_URL_INVALID").origin;
}

function fenToYuan(fen: number): string {
  if (!Number.isSafeInteger(fen) || fen < 0) {
    throw new Error("INVALID_PAYMENT_AMOUNT");
  }
  return `${Math.floor(fen / 100)}.${String(fen % 100).padStart(2, "0")}`;
}

export function yuanToFen(value: string): number {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error("INVALID_PAYMENT_AMOUNT");
  const fen =
    BigInt(match[1]) * BigInt(100) +
    BigInt((match[2] || "").padEnd(2, "0") || "0");
  if (fen > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("INVALID_PAYMENT_AMOUNT");
  }
  return Number(fen);
}

function alipayConfig() {
  const appId = secretValue("ALIPAY_APP_ID");
  const privateKey = secretValue("ALIPAY_PRIVATE_KEY");
  const alipayPublicKey = secretValue("ALIPAY_PUBLIC_KEY");
  if (!appId || !privateKey || !alipayPublicKey) return null;
  const keyType = process.env.ALIPAY_KEY_TYPE === "PKCS8" ? "PKCS8" : "PKCS1";
  const endpoint = secretValue("ALIPAY_ENDPOINT");
  return {
    appId,
    privateKey,
    alipayPublicKey,
    keyType,
    endpoint: endpoint
      ? httpsOrLocalUrl(endpoint, "ALIPAY_ENDPOINT_INVALID").toString()
      : undefined,
  } as const;
}

function alipaySdk(): AlipaySdk {
  const config = alipayConfig();
  if (!config) throw new Error("ALIPAY_NOT_CONFIGURED");
  return new AlipaySdk({
    ...config,
    signType: "RSA2",
    camelcase: true,
    timeout: paymentRuntimePolicy().providerRequestTimeoutMs,
  });
}

function wechatConfig() {
  const mchId = secretValue("WECHAT_PAY_MCH_ID");
  const appId = secretValue("WECHAT_PAY_APP_ID");
  const serialNo = secretValue("WECHAT_PAY_SERIAL_NO");
  const privateKey = secretValue("WECHAT_PAY_PRIVATE_KEY");
  const apiV3Key = secretValue("WECHAT_PAY_API_V3_KEY");
  const publicKeyId = secretValue("WECHAT_PAY_PUBLIC_KEY_ID");
  const publicKey = secretValue("WECHAT_PAY_PUBLIC_KEY");
  if (
    !mchId ||
    !appId ||
    !serialNo ||
    !privateKey ||
    !apiV3Key ||
    !publicKeyId ||
    !publicKey
  ) {
    return null;
  }
  if (Buffer.byteLength(apiV3Key, "utf8") !== 32) {
    throw new Error("WECHAT_PAY_API_V3_KEY_INVALID");
  }
  return {
    mchId,
    appId,
    serialNo,
    privateKey,
    apiV3Key,
    publicKeyId,
    publicKey,
    apiBase: httpsOrLocalUrl(
      paymentRuntimePolicy().wechatPayApiBaseUrl,
      "WECHAT_PAY_API_BASE_URL_INVALID"
    ).origin,
  };
}

export function paymentAvailability(): PaymentAvailability {
  return {
    alipay: (() => {
      try {
        const config = alipayConfig();
        if (!config) return false;
        notifyBaseUrl();
        crypto.createPrivateKey(config.privateKey);
        crypto.createPublicKey(config.alipayPublicKey);
        return true;
      } catch {
        return false;
      }
    })(),
    wechat: (() => {
      try {
        const config = wechatConfig();
        if (!config) return false;
        notifyBaseUrl();
        crypto.createPrivateKey(config.privateKey);
        crypto.createPublicKey(config.publicKey);
        return true;
      } catch {
        return false;
      }
    })(),
  };
}

export async function createAlipayNativeOrder(
  order: BillingOrder
): Promise<string> {
  const result = await alipaySdk().exec("alipay.trade.precreate", {
    notifyUrl: `${notifyBaseUrl()}/api/billing/alipay/notify`,
    bizContent: {
      outTradeNo: order.orderNo,
      totalAmount: fenToYuan(order.amountFen),
      subject: `LCE ${order.planSnapshot.name}`,
      timeoutExpress: `${paymentRuntimePolicy().orderTtlMinutes}m`,
    },
  });
  if (result.code !== "10000") {
    throw new Error(`ALIPAY_CREATE_FAILED:${result.sub_code || result.code}`);
  }
  const codeUrl =
    typeof result.qrCode === "string"
      ? result.qrCode
      : typeof result.qr_code === "string"
        ? result.qr_code
        : "";
  if (!codeUrl) throw new Error("ALIPAY_QR_CODE_MISSING");
  return codeUrl;
}

export function verifyAlipayNotification(
  postData: Record<string, string>
): VerifiedPayment {
  const config = alipayConfig();
  if (!config) throw new Error("ALIPAY_NOT_CONFIGURED");
  if (!alipaySdk().checkNotifySignV2(postData)) {
    throw new Error("ALIPAY_SIGNATURE_INVALID");
  }
  if (postData.app_id !== config.appId) {
    throw new Error("ALIPAY_APP_ID_MISMATCH");
  }
  const sellerId = secretValue("ALIPAY_SELLER_ID");
  if (sellerId && postData.seller_id !== sellerId) {
    throw new Error("ALIPAY_SELLER_ID_MISMATCH");
  }
  if (
    postData.trade_status !== "TRADE_SUCCESS" &&
    postData.trade_status !== "TRADE_FINISHED"
  ) {
    throw new Error("ALIPAY_TRADE_NOT_PAID");
  }
  if (!postData.out_trade_no || !postData.trade_no || !postData.total_amount) {
    throw new Error("ALIPAY_NOTIFICATION_INCOMPLETE");
  }
  if (!postData.gmt_payment) {
    throw new Error("ALIPAY_PAYMENT_TIME_MISSING");
  }
  const paidAt = new Date(postData.gmt_payment.replace(" ", "T") + "+08:00");
  if (Number.isNaN(paidAt.getTime())) {
    throw new Error("ALIPAY_PAYMENT_TIME_INVALID");
  }
  return {
    provider: "alipay",
    orderNo: postData.out_trade_no,
    amountFen: yuanToFen(postData.total_amount),
    currency: "CNY",
    providerTradeNo: postData.trade_no,
    paidAt,
  };
}

function wechatAuthorization(
  method: string,
  path: string,
  body: string,
  config: NonNullable<ReturnType<typeof wechatConfig>>
): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const canonical = `${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = crypto
    .sign("RSA-SHA256", Buffer.from(canonical), config.privateKey)
    .toString("base64");
  return (
    'WECHATPAY2-SHA256-RSA2048 ' +
    `mchid="${config.mchId}",` +
    `nonce_str="${nonce}",` +
    `signature="${signature}",` +
    `timestamp="${timestamp}",` +
    `serial_no="${config.serialNo}"`
  );
}

function verifyWechatSignature(
  body: string,
  headers: Headers,
  config: NonNullable<ReturnType<typeof wechatConfig>>
): void {
  const timestamp = headers.get("wechatpay-timestamp") || "";
  const nonce = headers.get("wechatpay-nonce") || "";
  const signature = headers.get("wechatpay-signature") || "";
  const serial = headers.get("wechatpay-serial") || "";
  if (!timestamp || !nonce || !signature || !serial) {
    throw new Error("WECHAT_SIGNATURE_HEADERS_MISSING");
  }
  if (serial !== config.publicKeyId) {
    throw new Error("WECHAT_PUBLIC_KEY_ID_MISMATCH");
  }
  const timestampSeconds = Number(timestamp);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(Date.now() / 1000 - timestampSeconds) >
      paymentRuntimePolicy().webhookMaxAgeSeconds
  ) {
    throw new Error("WECHAT_TIMESTAMP_INVALID");
  }
  const canonical = `${timestamp}\n${nonce}\n${body}\n`;
  if (
    !crypto.verify(
      "RSA-SHA256",
      Buffer.from(canonical),
      config.publicKey,
      Buffer.from(signature, "base64")
    )
  ) {
    throw new Error("WECHAT_SIGNATURE_INVALID");
  }
}

export async function createWechatNativeOrder(
  order: BillingOrder
): Promise<string> {
  const config = wechatConfig();
  if (!config) throw new Error("WECHAT_PAY_NOT_CONFIGURED");
  const path = "/v3/pay/transactions/native";
  const body = JSON.stringify({
    appid: config.appId,
    mchid: config.mchId,
    description: `LCE ${order.planSnapshot.name}`,
    out_trade_no: order.orderNo,
    time_expire: order.expiresAt.toISOString(),
    notify_url: `${notifyBaseUrl()}/api/billing/wechat/notify`,
    amount: {
      total: order.amountFen,
      currency: order.currency,
    },
  });
  const response = await fetch(`${config.apiBase}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: wechatAuthorization("POST", path, body, config),
      "User-Agent": "LCE-Billing/1.0",
    },
    body,
    signal: AbortSignal.timeout(paymentRuntimePolicy().providerRequestTimeoutMs),
  });
  const responseBody = await response.text();
  verifyWechatSignature(responseBody, response.headers, config);
  const payload = (() => {
    try {
      return JSON.parse(responseBody) as {
        code_url?: string;
        code?: string;
      };
    } catch {
      return {};
    }
  })();
  if (!response.ok || !payload.code_url) {
    throw new Error(
      `WECHAT_CREATE_FAILED:${payload.code || response.status}`
    );
  }
  return payload.code_url;
}

function decryptWechatResource(
  resource: {
    ciphertext?: string;
    nonce?: string;
    associated_data?: string;
  },
  apiV3Key: string
): Record<string, unknown> {
  if (!resource.ciphertext || !resource.nonce) {
    throw new Error("WECHAT_RESOURCE_INCOMPLETE");
  }
  const encrypted = Buffer.from(resource.ciphertext, "base64");
  if (encrypted.length <= 16) throw new Error("WECHAT_CIPHERTEXT_INVALID");
  const ciphertext = encrypted.subarray(0, -16);
  const authTag = encrypted.subarray(-16);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(apiV3Key, "utf8"),
    Buffer.from(resource.nonce, "utf8")
  );
  decipher.setAAD(Buffer.from(resource.associated_data || "", "utf8"));
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as Record<string, unknown>;
}

export function verifyWechatNotification(
  rawBody: string,
  headers: Headers
): VerifiedPayment {
  const config = wechatConfig();
  if (!config) throw new Error("WECHAT_PAY_NOT_CONFIGURED");
  verifyWechatSignature(rawBody, headers, config);

  const envelope = JSON.parse(rawBody) as {
    event_type?: string;
    resource?: {
      algorithm?: string;
      ciphertext?: string;
      nonce?: string;
      associated_data?: string;
    };
  };
  if (
    envelope.event_type !== "TRANSACTION.SUCCESS" ||
    envelope.resource?.algorithm !== "AEAD_AES_256_GCM"
  ) {
    throw new Error("WECHAT_TRADE_NOT_PAID");
  }
  const payment = decryptWechatResource(envelope.resource, config.apiV3Key);
  const amount = payment.amount as
    | { total?: unknown; currency?: unknown }
    | undefined;
  if (
    payment.trade_state !== "SUCCESS" ||
    payment.mchid !== config.mchId ||
    payment.appid !== config.appId ||
    typeof payment.out_trade_no !== "string" ||
    payment.out_trade_no.length === 0 ||
    typeof payment.transaction_id !== "string" ||
    payment.transaction_id.length === 0 ||
    !amount ||
    typeof amount.total !== "number" ||
    !Number.isSafeInteger(amount.total) ||
    amount.total < 0 ||
    typeof amount.currency !== "string" ||
    amount.currency.length === 0 ||
    typeof payment.success_time !== "string" ||
    payment.success_time.length === 0
  ) {
    throw new Error("WECHAT_PAYMENT_DATA_INVALID");
  }
  const paidAt = new Date(payment.success_time);
  if (Number.isNaN(paidAt.getTime())) {
    throw new Error("WECHAT_PAYMENT_TIME_INVALID");
  }
  return {
    provider: "wechat",
    orderNo: payment.out_trade_no,
    amountFen: amount.total,
    currency: amount.currency,
    providerTradeNo: payment.transaction_id,
    paidAt,
  };
}
