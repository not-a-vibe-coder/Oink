import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";

export default function PrivyProviderImpl({ appId, children }: { appId: string; children: ReactNode }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "twitter"],
        appearance: { theme: "light", showWalletLoginFirst: false },
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
