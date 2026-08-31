import { describe, expect, it, vi } from "vitest";

const mailMocks = vi.hoisted(() => {
  const transports: Array<{
    close: ReturnType<typeof vi.fn>;
    sendMail: ReturnType<typeof vi.fn>;
  }> = [];
  const createTransport = vi.fn(() => {
    const transport = {
      close: vi.fn(),
      sendMail: vi.fn().mockResolvedValue({ messageId: "test-message" }),
    };
    transports.push(transport);
    return transport;
  });
  return { createTransport, transports };
});

vi.mock("nodemailer", () => ({
  default: { createTransport: mailMocks.createTransport },
}));

import {
  isEmailVerificationConfigured,
  sendAccountVerificationEmail,
  smtpConfigFromEnv,
} from "./email-verification";

describe("email verification SMTP configuration", () => {
  it("stays disabled until host and sender are both configured", () => {
    expect(isEmailVerificationConfigured({})).toBe(false);
    expect(isEmailVerificationConfigured({ SMTP_HOST: "smtp.example.com" })).toBe(false);
    expect(isEmailVerificationConfigured({ SMTP_FROM: "LCE <noreply@example.com>" })).toBe(false);
  });

  it("uses safe submission defaults and optional authentication", () => {
    expect(smtpConfigFromEnv({
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM: "LCE <noreply@example.com>",
      SMTP_USER: "mailer",
      SMTP_PASSWORD: "secret",
    })).toEqual({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      user: "mailer",
      password: "secret",
      from: "LCE <noreply@example.com>",
    });
  });

  it("rejects partial credentials and invalid transport values", () => {
    expect(smtpConfigFromEnv({
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM: "noreply@example.com",
      SMTP_USER: "mailer",
    })).toBeNull();
    expect(smtpConfigFromEnv({
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM: "noreply@example.com",
      SMTP_PORT: "70000",
    })).toBeNull();
    expect(smtpConfigFromEnv({
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM: "noreply@example.com",
      SMTP_SECURE: "sometimes",
    })).toBeNull();
  });

  it("sends a verification link through SMTP and rebuilds the pool after credential rotation", async () => {
    const env = {
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM: "noreply@example.com",
      SMTP_USER: "mailer",
      SMTP_PASSWORD: "first-secret",
    };
    await sendAccountVerificationEmail({
      email: "user@example.com",
      name: "<LCE User>",
      verificationUrl: "https://console.example.test/api/auth/verify-email?token=test&callbackURL=%2Fconsole",
    }, env);

    const firstTransport = mailMocks.transports.at(-1)!;
    expect(firstTransport.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: "noreply@example.com",
      to: "user@example.com",
      subject: expect.stringContaining("LCE"),
      text: expect.stringContaining("https://console.example.test/api/auth/verify-email"),
      html: expect.stringContaining("&lt;LCE User&gt;"),
    }));

    await sendAccountVerificationEmail({
      email: "user@example.com",
      verificationUrl: "https://console.example.test/api/auth/verify-email?token=rotated",
    }, { ...env, SMTP_PASSWORD: "rotated-secret" });

    expect(firstTransport.close).toHaveBeenCalledOnce();
    expect(mailMocks.createTransport).toHaveBeenLastCalledWith(expect.objectContaining({
      auth: { user: "mailer", pass: "rotated-secret" },
      pool: true,
    }));
  });
});
