"use client";

import { useEffect, useRef } from "react";

export function SettingsResultStatus({
  message,
  tone,
}: {
  message: string;
  tone: "success" | "error";
}) {
  const status = useRef<HTMLDivElement>(null);

  useEffect(() => {
    status.current?.focus();
  }, [message]);

  return (
    <div
      ref={status}
      className="settings-status"
      data-tone={tone}
      role="status"
      aria-label="Settings update status"
      tabIndex={-1}
    >
      {message}
    </div>
  );
}
