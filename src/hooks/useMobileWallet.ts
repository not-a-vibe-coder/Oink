import { useEffect, useState } from "react";
import { mwaSupported, registerMobileWallet } from "@/lib/mwa/mwa";

/** Renders only after mount in Android Chrome, so SSR and other browsers never see MWA. */
export function useMobileWalletAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!mwaSupported()) return;
    setAvailable(true);
    void registerMobileWallet();
  }, []);
  return available;
}
