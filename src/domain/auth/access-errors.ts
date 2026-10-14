// Identity-service outages must not be mistaken for an expired user session.
export class ProfileAccessError extends Error {
  constructor(public code: "NETWORK" | "SCHEMA" | "TEMPORARY") {
    super("Account access could not be checked. Please try again.");
  }
}
