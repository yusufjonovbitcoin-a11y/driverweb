import { useEffect } from "react";
import SettlementWorkspace from "./settlements/SettlementWorkspace";
export default function AccountingOverview(props) {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("accountingDemo")) {
      url.searchParams.delete("accountingDemo");
      window.history.replaceState(window.history.state, "", url);
    }
  }, []);
  return <SettlementWorkspace {...props} />;
}
