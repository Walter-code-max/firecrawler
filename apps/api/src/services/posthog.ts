import { PostHog } from 'posthog-node';
import "dotenv/config";

export default function PostHogClient() {
  const posthogClient = new PostHog(process.env.POSTHOG_API_KEY, {
    host: process.env.POSTHOG_HOST,
    flushAt: 1,
    flushInterval: 0
  });
  return posthogClient;
}

class MockPostHog {
  capture() {}
}

// Using the actual PostHog class if POSTHOG_API_KEY exists, otherwise using the mock class
// Additionally, print a warning to the terminal if POSTHOG_API_KEY is not provided
export const posthog = process.env.POSTHOG_API_KEY
  ? PostHogClient()
  : (() => {
      console.warn(
        "POSTHOG_API_KEY is not provided - your events will not be logged. Using MockPostHog as a fallback. See posthog.ts for more."
      );
      return new MockPostHog();
    })();