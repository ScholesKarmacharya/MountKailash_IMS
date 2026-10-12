"use client";
import { useEffect, useState } from "react";
import { Message } from "./localization";
export function OperationFeedback() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const clear = () => {
      clearTimeout(timer);
      setMessage(null);
    };
    const receive = () => {
      setMessage("Saved to the database.");
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 8000);
    };
    window.addEventListener("operation-saved", receive);
    window.addEventListener("operation-saving", clear);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("operation-saved", receive);
      window.removeEventListener("operation-saving", clear);
    };
  }, []);
  return message ? (
    <div
      role="status"
      className="fixed right-4 top-4 z-50 max-w-[calc(100vw-2rem)] rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm font-semibold text-teal-900 shadow-lg"
    >
      <Message value={message} />
    </div>
  ) : null;
}
