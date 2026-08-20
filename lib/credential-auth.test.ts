import { describe, expect, it } from "vitest";
import {
  credentialAuthErrorMessage,
  validateCredentialFields,
} from "./credential-auth";

describe("credential auth form", () => {
  it("validates registration-only fields", () => {
    expect(validateCredentialFields({
      mode: "register",
      name: "",
      email: "user@example.com",
      password: "password",
      confirmPassword: "password",
    })).toEqual({ key: "enterDisplayName" });

    expect(validateCredentialFields({
      mode: "register",
      name: "User",
      email: "user@example.com",
      password: "password",
      confirmPassword: "different",
    })).toEqual({ key: "passwordsDoNotMatch" });
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
  });
});
