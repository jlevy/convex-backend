/**
 * Convex client wrapper for testing.
 *
 * Provides a convenient interface for interacting with Convex during tests.
 */

import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference, FunctionArgs, FunctionReturnType } from "convex/server";

// Default to local development server
const DEFAULT_CONVEX_URL = "http://127.0.0.1:3210";

/**
 * Creates a Convex client connected to the test deployment.
 */
export function createTestClient(): ConvexHttpClient {
  const url = process.env.CONVEX_URL || DEFAULT_CONVEX_URL;
  console.log(`[convex] Connecting to ${url}`);
  return new ConvexHttpClient(url);
}

/**
 * Wrapper around a Convex client with convenience methods for testing.
 */
export class TestConvexClient {
  private client: ConvexHttpClient;

  constructor(url?: string) {
    this.client = new ConvexHttpClient(url || process.env.CONVEX_URL || DEFAULT_CONVEX_URL);
  }

  /**
   * Runs a query function.
   */
  async query<Query extends FunctionReference<"query">>(
    query: Query,
    args: FunctionArgs<Query>
  ): Promise<FunctionReturnType<Query>> {
    return this.client.query(query, args);
  }

  /**
   * Runs a mutation function.
   */
  async mutation<Mutation extends FunctionReference<"mutation">>(
    mutation: Mutation,
    args: FunctionArgs<Mutation>
  ): Promise<FunctionReturnType<Mutation>> {
    return this.client.mutation(mutation, args);
  }

  /**
   * Runs an action function.
   */
  async action<Action extends FunctionReference<"action">>(
    action: Action,
    args: FunctionArgs<Action>
  ): Promise<FunctionReturnType<Action>> {
    return this.client.action(action, args);
  }

  /**
   * Gets the underlying HTTP client.
   */
  getClient(): ConvexHttpClient {
    return this.client;
  }
}

/**
 * Global test client instance.
 */
let globalClient: TestConvexClient | null = null;

/**
 * Gets or creates the global test client.
 */
export function getTestClient(): TestConvexClient {
  if (!globalClient) {
    globalClient = new TestConvexClient();
  }
  return globalClient;
}

/**
 * Resets the global test client (useful between test runs).
 */
export function resetTestClient(): void {
  globalClient = null;
}
