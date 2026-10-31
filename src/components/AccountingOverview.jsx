import { useEffect } from "react";
import SettlementWorkspace from "./settlements/SettlementWorkspace";
export default function AccountingOverview(props) {
  useEffect(() => {
    // Remove only the retired, browser-local accounting test database.
    globalThis.indexedDB?.deleteDatabase('tfleets-accounting-demo-v1');
    const url = new URL(window.location.href);
    if (url.searchParams.has("accountingDemo")) {
      url.searchParams.delete("accountingDemo");
      window.history.replaceState(window.history.state, "", url);
    }
  }, []);
  return <SettlementWorkspace {...props} />;
}
