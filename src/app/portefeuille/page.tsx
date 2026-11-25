import { RequireLogin } from "@/components/require-login";
import { WalletPanel } from "@/components/wallet/wallet-panel";

export default function WalletPage() {
  return (
    <RequireLogin>
      <WalletPanel />
    </RequireLogin>
  );
}
