"use client";

import dynamic from "next/dynamic";

// Everything lives in localStorage / IndexedDB, so the chat renders only in the browser.
const Chat = dynamic(() => import("./Chat"), {
  ssr: false,
  loading: () => <div className="h-dvh bg-[#0b0b0c]" />,
});

export function ClientApp() {
  return <Chat />;
}
