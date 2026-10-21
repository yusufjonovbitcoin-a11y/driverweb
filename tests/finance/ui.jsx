import React from "react";
import { createRoot } from "react-dom/client";
import i18n from "../../src/i18n";
import FinanceWorkspace from "../../src/components/finance/FinanceWorkspace";
await i18n.changeLanguage("ru");
createRoot(document.getElementById("root")).render(
  <div style={{ padding: 24, fontFamily: "Arial,sans-serif", background: "#f4f7fb", minHeight: "100vh" }}>
    <p style={{ fontSize: 12, color: "#9c6a18", marginBottom: 20 }}>
      SYNTHETIC FINANCE QA — isolated local test database; no real money or production data
    </p>
    <FinanceWorkspace canManageAccounting drivers={[{ id: "20000000-0000-0000-0000-000000000002", name: "Synthetic Driver" }]} loads={[]} onOpenLoad={() => {}} />
  </div>,
);
