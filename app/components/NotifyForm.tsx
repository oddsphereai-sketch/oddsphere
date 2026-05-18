"use client";

import { useState } from "react";

// Email capture for The Lab launch. Non-functional placeholder for now —
// wire to a real notification service (e.g. Resend, Mailchimp, or a
// `/api/notify` route) before the marketing push.

export default function NotifyForm({ context = "The Lab" }: { context?: string }) {
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <p className="text-violet-300 text-sm font-medium">
        ✅ You're on the list. We'll email you when {context} launches.
      </p>
    );
  }

  return (
    <form
      action="#"
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
      }}
      className="flex flex-col sm:flex-row gap-2 max-w-md mx-auto"
    >
      <input
        type="email"
        required
        placeholder="you@example.com"
        className="flex-1 bg-gray-900 border border-gray-700 rounded-md px-4 py-3 text-sm text-white placeholder:text-gray-400 focus:outline-none focus:border-violet-500"
      />
      <button
        type="submit"
        className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-6 py-3 rounded-md transition-colors whitespace-nowrap"
      >
        Notify me →
      </button>
    </form>
  );
}
