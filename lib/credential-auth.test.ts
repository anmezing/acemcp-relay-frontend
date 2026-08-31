import { describe, expect, it } from "vitest";
import {
  credentialAuthErrorMessage,
  emailRegistrationEnabledFromResponse,
  oauthAuthErrorMessage,
  passwordPolicyFromResponse,
  registrationAvailabilityFromResponse,
  validateCredentialFields,
} from "./credential-auth";

describe("credential auth form", () => {
  it("fails registration availability closed when the status response is unusable", () => {
    expect(registrationAvailabilityFromResponse(false, { enabled: true })).toBe("unavailable");
    expect(registrationAvailabilityFromResponse(true, {})).toBe("unavailable");
    expect(registrationAvailabilityFromResponse(true, { enabled: "false" })).toBe("unavailable");
    expect(registrationAvailabilityFromResponse(true, null)).toBe("unavailable");
  });

  it("maps a valid registration status response", () => {
    expect(registrationAvailabilityFromResponse(true, { enabled: true })).toBe("open");
    expect(registrationAvailabilityFromResponse(true, { enabled: false })).toBe("closed");
  });

  it("fails email registration closed unless the server explicitly confirms SMTP readiness", () => {
    expect(emailRegistrationEnabledFromResponse(true, { emailRegistrationEnabled: true })).toBe(true);
    expect(emailRegistrationEnabledFromResponse(true, { emailRegistrationEnabled: false })).toBe(false);
    expect(emailRegistrationEnabledFromResponse(true, {})).toBe(false);
    expect(emailRegistrationEnabledFromResponse(false, { emailRegistrationEnabled: true })).toBe(false);
  });

  it("accepts only a coherent server password policy", () => {
    expect(passwordPolicyFromResponse(true, {
      passwordPolicy: { minLength: 12, maxLength: 64 },
    })).toEqual({ minLength: 12, maxLength: 64 });
    expect(passwordPolicyFromResponse(true, {
      passwordPolicy: { minLength: 64, maxLength: 12 },
    })).toBeNull();
    expect(passwordPolicyFromResponse(false, {
      passwordPolicy: { minLength: 12, maxLength: 64 },
    })).toBeNull();
  });

  it("validates registration-only fields against the server policy", () => {
    const policy = { minLength: 12, maxLength: 64 };
    expect(validateCredentialFields({
      mode: "register",
      name: "",
      email: "user@example.com",
      password: "password",
      confirmPassword: "password",
    }, policy)).toEqual({ key: "enterDisplayName" });

    expect(validateCredentialFields({
      mode: "register",
      name: "User",
      email: "user@example.com",
      password: "password",
      confirmPassword: "different",
    }, policy)).toEqual({ key: "passwordMinimum", values: { count: 12 } });

    expect(validateCredentialFields({
      mode: "register",
      name: "User",
      email: "user@example.com",
      password: "a".repeat(65),
      confirmPassword: "a".repeat(65),
    }, policy)).toEqual({ key: "passwordMaximum", values: { count: 64 } });

    expect(validateCredentialFields({
      mode: "register",
      name: "User",
      email: "user@example.com",
      password: "long-enough-password",
      confirmPassword: "different-password",
    }, policy)).toEqual({ key: "passwordsDoNotMatch" });

    expect(validateCredentialFields({
      mode: "register",
      name: "User",
      email: "user@example.com",
      password: "long-enough-password",
      confirmPassword: "long-enough-password",
    })).toEqual({ key: "registrationStatusUnavailable" });
  });

  it("does not require registration fields when logging in", () => {
    expect(validateCredentialFields({
      mode: "login",
      name: "",
      email: "user@example.com",
      password: "short",
      confirmPassword: "",
    })).toBeNull();
  });

  it("maps OAuth registration gate errors to specific messages", () => {
    expect(oauthAuthErrorMessage("REGISTRATION_DISABLED")).toEqual({
      key: "registrationClosedExistingUsers",
    });
    expect(oauthAuthErrorMessage("REGISTRATION_LIMIT_REACHED")).toEqual({
      key: "registrationCapacityReached",
    });
    expect(oauthAuthErrorMessage("GITHUB_ACCOUNT_TOO_YOUNG:365:12")).toEqual({
      key: "githubAccountTooYoung",
      values: { required: "365", actual: "12" },
    });
  });

  it("maps Better Auth errors to translation keys", () => {
    expect(credentialAuthErrorMessage(
      { code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" },
      "register"
    )).toEqual({ key: "emailAlreadyRegistered" });
    expect(credentialAuthErrorMessage(
      { message: "REGISTRATION_DISABLED" },
      "register"
    )).toEqual({ key: "registrationClosed" });
    expect(credentialAuthErrorMessage(
      { code: "INVALID_EMAIL_OR_PASSWORD" },
      "login"
    )).toEqual({ key: "incorrectEmailOrPassword" });
    expect(credentialAuthErrorMessage(
      { code: "EMAIL_NOT_VERIFIED" },
      "login"
    )).toEqual({ key: "emailNotVerified" });
    expect(credentialAuthErrorMessage(
      { message: "EMAIL_VERIFICATION_UNAVAILABLE" },
      "register"
    )).toEqual({ key: "emailVerificationUnavailable" });
    expect(credentialAuthErrorMessage(
      { code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" },
      "register"
    )).toEqual({ key: "emailVerificationUnavailable" });
    expect(credentialAuthErrorMessage(
      { code: "PASSWORD_TOO_SHORT" },
      "register",
      { minLength: 12, maxLength: 64 },
    )).toEqual({ key: "passwordMinimum", values: { count: 12 } });
    expect(credentialAuthErrorMessage(
      { code: "PASSWORD_TOO_LONG" },
      "register",
      { minLength: 12, maxLength: 64 },
    )).toEqual({ key: "passwordMaximum", values: { count: 64 } });
  });
});
